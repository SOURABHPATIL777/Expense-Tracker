import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/backend/supabase/clients";
import type { Logger } from "@/backend/logger/logger";
import { AppError } from "@/backend/errors/AppError";
import { JOBS, MATCHING } from "@/backend/constants/app.constants";
import { PDF_LLM } from "@/backend/constants/llm.constants";
import type { ImportStatus, SourceApp, SourceKind } from "@/backend/constants/enums.constants";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import { ImportsRepository } from "@/backend/repositories/imports.repository";
import { ImportLayoutsRepository } from "@/backend/repositories/importLayouts.repository";
import { RawEventsRepository } from "@/backend/repositories/rawEvents.repository";
import { TransactionsRepository, TransactionSourcesRepository } from "@/backend/repositories/transactions.repository";
import { ReviewItemsRepository, type NewReviewItem } from "@/backend/repositories/reviewItems.repository";
import { AccountsRepository } from "@/backend/repositories/accounts.repository";
import { UploadedFilesRepository } from "@/backend/repositories/uploadedFiles.repository";
import type { ImportLayoutRow, ImportRow, RawEventRow, TransactionRow, TransactionSourceRow } from "@/backend/repositories/types";
import { detectFormat, readerFor, readFile } from "@/backend/import/readers";
import { detectConfig, extract, findHeaderRow } from "@/backend/import/engine";
import { istDate } from "@/backend/import/dates";
import { headerSignature, textLayoutFingerprint } from "@/backend/import/text";
import type { ExtractResult, ImportConfig, ParsedEvent, ReaderId, ReadResult } from "@/backend/import/types";
import { fingerprintAll, sha256Hex } from "@/backend/domain/fingerprint";
import { matchIncoming, type MatchCandidate } from "@/backend/domain/matcher";
import { inferKind, paymentRail } from "@/backend/domain/inferKind";
import { displayMerchant } from "@/backend/domain/merchant";
import { mapColumnsWithLlm } from "@/backend/llm/columnMapping";
import { chunkLines, readPdfChunkWithLlm } from "@/backend/llm/pdfExtraction";
import { statementStorage } from "./storage";

/** Statuses from which the extract stage may (re)run; `parsing` also resumes an AI read of a PDF. */
const EXTRACTABLE = new Set<ImportStatus>(["queued", "parsing", "needs_password"]);
const HOUR_MS = 3_600_000;
const TEXT_LIMIT = 500;

type Source = { sourceKind: SourceKind; sourceApp: SourceApp };
type Detected = Source & { layoutId: string | null; label: string; readByAi: boolean; configId: string };

const fallbackSource = (kind: SourceKind | null): Source =>
  kind === "upi_app" ? { sourceKind: "upi_app", sourceApp: "other_upi" } : { sourceKind: "bank", sourceApp: "other_bank" };

/**
 * Two-stage import pipeline:
 *  1. extract: read the file and work out its layout and source. Order: stored layouts (shared by
 *     all users), then for CSV/Excel an LLM column mapping (proved on the file, then stored), and
 *     for PDFs an LLM reading the rows chunk by chunk (each row verified against the text).
 *  2. process: in resumable chunks, match raw events against existing transactions (UTR first,
 *     then amount+time as a review candidate) and create/link transactions.
 * Works with either the user's client (inline, RLS-scoped) or the worker's service client.
 */
export function importPipeline(db: Db, log: Logger) {
  const imports = new ImportsRepository(db);
  const layouts = new ImportLayoutsRepository();
  const rawEvents = new RawEventsRepository(db);
  const transactions = new TransactionsRepository(db);
  const sources = new TransactionSourcesRepository(db);
  const reviews = new ReviewItemsRepository(db);
  const accounts = new AccountsRepository(db);
  const files = new UploadedFilesRepository();

  async function loadFile(row: ImportRow): Promise<{ buffer: Buffer; reader: ReaderId }> {
    const buffer = await statementStorage.download(row.file_path);
    if (sha256Hex(buffer) !== row.file_sha256) {
      throw new AppError("IMPORT_UNREADABLE", { message: "The uploaded file doesn't match what was registered. Please upload it again." });
    }
    return { buffer, reader: readerFor(detectFormat(row.file_name, buffer)) };
  }

  /** The stored layout that recognises this file, if any. */
  async function matchLayout(read: ReadResult, reader: ReaderId): Promise<{ layout: ImportLayoutRow; config: ImportConfig } | null> {
    const parsers = await layouts.parsers();
    const config = detectConfig(read, reader, parsers.map((p) => p.config));
    return parsers.find((p) => p.config === config) ?? null;
  }

  /** Links the import to the user's account for this bank/app when there is exactly one. */
  async function autoAccount(row: ImportRow, sourceApp: SourceApp): Promise<string | null> {
    if (row.account_id) return row.account_id;
    const matches = await accounts.listAll(row.user_id, (q) => q.eq("source_app", sourceApp));
    return matches.length === 1 ? matches[0].id : null;
  }

  /** Any status other than `processing`/`parsing` means the file is back at rest in R2. */
  const setStatus = async (row: ImportRow, status: ImportStatus, message: string | null = null, code: string | null = null) => {
    await imports.update(row.user_id, row.id, { status, error_message: message, error_code: code });
    if (status !== "processing" && status !== "parsing") await files.setStatus(row.user_id, row.file_path, "uploaded");
    return status;
  };

  /** Stores every extracted row as a raw event and moves the import on to processing. */
  async function saveExtracted(row: ImportRow, result: ExtractResult, d: Detected): Promise<ImportStatus> {
    const parsed = result.rows.filter((r) => r.parsed);
    if (parsed.length === 0) return setStatus(row, "failed", "No transactions were found in this file.", "IMPORT_UNREADABLE");
    const fingerprints = fingerprintAll(d.sourceApp, parsed.map((r) => r.parsed!));
    let next = 0;
    const rawRows = result.rows.map((r) => ({
      import_id: row.id,
      row_index: r.rowIndex,
      raw: r.raw,
      parsed: r.parsed,
      fingerprint: r.parsed ? fingerprints[next++] : sha256Hex(`${row.id}|${r.rowIndex}`),
      status: (r.parsed ? "pending" : "rejected") as RawEventRow["status"],
      error: r.error,
      transaction_id: null,
    }));
    await rawEvents.replaceForImport(row.user_id, row.id, rawRows);
    await imports.update(row.user_id, row.id, {
      status: "processing",
      source_kind: d.sourceKind,
      source_app: d.sourceApp,
      layout_id: d.layoutId,
      detected_label: d.label,
      read_by_ai: d.readByAi,
      preset_id: d.configId,
      account_id: await autoAccount(row, d.sourceApp),
      row_count: rawRows.length,
      skipped_count: rawRows.length - parsed.length,
      imported_count: 0,
      linked_count: 0,
      duplicate_count: 0,
      review_count: 0,
      cursor: 0,
      period_start: result.periodStart,
      period_end: result.periodEnd,
    });
    log.info({ importId: row.id, layout: d.configId, rows: rawRows.length, ai: d.readByAi }, "import extracted");
    return "processing";
  }

  /**
   * Reads up to `maxChunks` chunks of a PDF's text with the LLM (one job step), appending verified
   * rows. Returns `parsing` while chunks remain, `processing` once the whole file is read.
   */
  async function continuePdfRead(row: ImportRow, maxChunks: number): Promise<ImportStatus> {
    const lines = row.extracted_text ?? [];
    const chunks = chunkLines(lines);
    let { cursor, row_count: total, skipped_count: skipped, period_start: periodStart, period_end: periodEnd } = row;
    let source: Source | null = row.source_app ? { sourceKind: row.source_kind!, sourceApp: row.source_app as SourceApp } : null;
    const until = Math.min(chunks.length, cursor + maxChunks);

    for (; cursor < until; cursor++) {
      const chunk = await readPdfChunkWithLlm(row.user_id, chunks[cursor], cursor === 0);
      if (!source && chunk.source) source = chunk.source;
      const app = source?.sourceApp ?? "other_bank";
      const fps = fingerprintAll(app, chunk.events);
      const parsedSoFar = total - skipped;
      await rawEvents.appendForImport(
        row.user_id,
        chunk.events.map((e, i) => ({
          import_id: row.id,
          row_index: parsedSoFar + i,
          raw: { chunk: cursor },
          parsed: e,
          fingerprint: fps[i],
          status: "pending" as const,
          error: null,
          transaction_id: null,
        })),
      );
      for (const e of chunk.events) {
        const day = istDate(e.occurredAt);
        if (!periodStart || day < periodStart) periodStart = day;
        if (!periodEnd || day > periodEnd) periodEnd = day;
      }
      total += chunk.events.length + chunk.dropped;
      skipped += chunk.dropped;
      row = await imports.update(row.user_id, row.id, {
        cursor: cursor + 1,
        row_count: total,
        skipped_count: skipped,
        period_start: periodStart,
        period_end: periodEnd,
        ...(source && { source_kind: source.sourceKind, source_app: source.sourceApp }),
      });
    }
    if (cursor < chunks.length) return "parsing";

    if (total - skipped === 0) {
      await imports.update(row.user_id, row.id, { extracted_text: null });
      return setStatus(row, "failed", "No transactions could be read from this PDF.", "IMPORT_UNREADABLE");
    }
    const final = source ?? fallbackSource(row.source_kind);
    const label = `${SOURCE_APP_LABELS[final.sourceApp]} statement (read by AI)`;
    // Remember this statement layout's source (hash of its header lines only, never the text).
    const layout = await layouts.save({
      kind: "llm_extract",
      signature: textLayoutFingerprint(lines),
      label,
      source_kind: final.sourceKind,
      source_app: final.sourceApp,
      config: {},
    });
    await imports.update(row.user_id, row.id, {
      status: "processing",
      extracted_text: null,
      cursor: 0,
      source_kind: final.sourceKind,
      source_app: final.sourceApp,
      layout_id: layout.id,
      detected_label: label,
      account_id: await autoAccount(row, final.sourceApp),
    });
    log.info({ importId: row.id, rows: total - skipped, dropped: skipped }, "pdf read by AI");
    return "processing";
  }

  async function extractStage(userId: string, importId: string, opts: { password?: string; maxPdfChunks?: number } = {}): Promise<ImportStatus> {
    const maxChunks = opts.maxPdfChunks ?? PDF_LLM.CHUNKS_PER_STEP;
    let row = await imports.findById(userId, importId);
    if (!EXTRACTABLE.has(row.status)) return row.status;
    row = await imports.update(userId, importId, { status: "parsing", error_code: null, error_message: null });
    await files.setStatus(userId, row.file_path, "processing");

    try {
      // An AI read already in progress: carry on from the saved text.
      if (row.extracted_text) return await continuePdfRead(row, maxChunks);

      const { buffer, reader } = await loadFile(row);
      const read = await readFile(reader, buffer, opts.password);

      const match = await matchLayout(read, reader);
      if (match) {
        const result = extract(read, match.config);
        if (result.rows.some((r) => r.parsed)) {
          await layouts.touch(match.layout);
          return await saveExtracted(row, result, {
            sourceKind: match.layout.source_kind,
            sourceApp: match.layout.source_app as SourceApp,
            layoutId: match.layout.id,
            label: match.layout.label,
            readByAi: match.layout.origin === "llm",
            configId: match.config.id,
          });
        }
        // The header matched but nothing parsed: let the LLM look at it fresh.
      }

      if (read.kind === "table") {
        const mapped = await mapColumnsWithLlm(userId, row.file_name, read);
        const headerIdx = findHeaderRow(read.rows, mapped.config.table!);
        const learned = await layouts.save({
          kind: "table",
          signature: headerSignature(read.rows[headerIdx] ?? []),
          label: mapped.config.label,
          source_kind: mapped.sourceKind,
          source_app: mapped.sourceApp,
          config: mapped.config,
        });
        return await saveExtracted(row, extract(read, mapped.config), {
          sourceKind: mapped.sourceKind,
          sourceApp: mapped.sourceApp,
          layoutId: learned.id,
          label: mapped.config.label,
          readByAi: true,
          configId: mapped.config.id,
        });
      }

      // Unknown PDF layout: keep its text for the duration of the AI read, then go chunk by chunk.
      const known = await layouts.find("llm_extract", textLayoutFingerprint(read.lines));
      await rawEvents.replaceForImport(userId, importId, []);
      row = await imports.update(userId, importId, {
        extracted_text: read.lines,
        cursor: 0,
        row_count: 0,
        skipped_count: 0,
        period_start: null,
        period_end: null,
        read_by_ai: true,
        detected_label: known?.label ?? "Reading with AI",
        source_kind: known?.source_kind ?? null,
        source_app: known?.source_app ?? null,
        preset_id: "llm_extract",
      });
      return await continuePdfRead(row, maxChunks);
    } catch (err) {
      if (err instanceof AppError && err.code === "PASSWORD_REQUIRED") {
        return setStatus(row, "needs_password", opts.password ? err.message : null, err.code);
      }
      if (err instanceof AppError && err.status < 500) {
        await imports.update(userId, importId, { extracted_text: null });
        return setStatus(row, "failed", err.message, err.code);
      }
      // Transient failure (e.g. the LLM timed out): stay resumable for the job retry.
      await setStatus(row, row.extracted_text ? "parsing" : "queued");
      throw err;
    }
  }

  function buildTransaction(id: string, row: ImportRow, e: ParsedEvent, ownVpas: ReadonlySet<string>, flagged: boolean): Partial<TransactionRow> {
    return {
      id,
      account_id: row.account_id,
      amount_minor: e.amountMinor,
      direction: e.direction,
      transaction_kind: inferKind(e, ownVpas),
      status: e.status,
      occurred_at: e.occurredAt,
      merchant_raw: (e.counterpartyName ?? e.narration)?.slice(0, TEXT_LIMIT) ?? null,
      merchant_normalized: displayMerchant(e.counterpartyName, e.counterpartyVpa),
      counterparty_vpa: e.counterpartyVpa,
      narration: e.narration?.slice(0, TEXT_LIMIT) ?? null,
      note: e.note?.slice(0, TEXT_LIMIT) ?? null,
      payment_rail: paymentRail(e, row.source_kind ?? "bank"),
      reference_id: e.referenceId,
      app_transaction_id: e.appTransactionId,
      source_app: row.source_app ?? "other_bank",
      review_status: flagged ? "needs_review" : "ok",
    };
  }

  const toCandidate = (t: TransactionRow): MatchCandidate => ({
    id: t.id,
    amountMinor: t.amount_minor,
    direction: t.direction,
    occurredAt: t.occurred_at,
    referenceId: t.reference_id,
  });

  async function processBatch(row: ImportRow, pending: RawEventRow[]): Promise<void> {
    const userId = row.user_id;
    const events = pending.map((raw) => ({ raw, e: raw.parsed as ParsedEvent }));
    const windowMs = MATCHING.DUPLICATE_WINDOW_HOURS * HOUR_MS;
    const times = events.map((x) => Date.parse(x.e.occurredAt));

    const [known, ownVpas, existing] = await Promise.all([
      rawEvents.knownFingerprints(userId, row.id, pending.map((r) => r.fingerprint)),
      accounts.ownVpas(userId),
      transactions.findCandidates(userId, {
        references: [...new Set(events.flatMap((x) => (x.e.referenceId ? [x.e.referenceId] : [])))],
        amounts: [...new Set(events.map((x) => x.e.amountMinor))],
        from: new Date(Math.min(...times) - windowMs).toISOString(),
        to: new Date(Math.max(...times) + windowMs).toISOString(),
      }),
    ]);
    const candidates = existing.map(toCandidate);

    const newTx: Array<Partial<TransactionRow>> = [];
    const newSources: Array<Omit<TransactionSourceRow, "id" | "user_id" | "created_at">> = [];
    const outcomes: RawEventRow[] = [];
    const reviewItems: NewReviewItem[] = [];
    const linkedIds = new Set<string>();
    const counts = { imported_count: 0, linked_count: 0, duplicate_count: 0, review_count: 0 };
    const source = (transactionId: string, raw: RawEventRow) => ({
      transaction_id: transactionId,
      raw_event_id: raw.id,
      import_id: row.id,
      // Set during extraction; processing never starts before the source is known.
      source_kind: row.source_kind ?? "bank",
      source_app: row.source_app ?? "other_bank",
    });

    for (const { raw, e } of events) {
      if (known.has(raw.fingerprint)) {
        outcomes.push({ ...raw, status: "duplicate" });
        counts.duplicate_count += 1;
        continue;
      }
      const decision = matchIncoming(
        { amountMinor: e.amountMinor, direction: e.direction, occurredAt: e.occurredAt, referenceId: e.referenceId },
        candidates,
        MATCHING.DUPLICATE_WINDOW_HOURS,
      );
      if (decision.kind === "same_reference") {
        newSources.push(source(decision.transactionId, raw));
        outcomes.push({ ...raw, status: "linked", transaction_id: decision.transactionId });
        linkedIds.add(decision.transactionId);
        counts.linked_count += 1;
        continue;
      }
      const id = randomUUID();
      const flagged = decision.kind === "possible_duplicate";
      newTx.push(buildTransaction(id, row, e, ownVpas, flagged));
      newSources.push(source(id, raw));
      outcomes.push({ ...raw, status: "accepted", transaction_id: id });
      counts.imported_count += 1;
      if (flagged) {
        reviewItems.push({
          kind: "duplicate_candidate",
          transaction_id: id,
          related_transaction_id: decision.transactionIds[0],
          raw_event_id: raw.id,
          payload: { candidates: decision.transactionIds },
        });
      }
      candidates.push({ id, amountMinor: e.amountMinor, direction: e.direction, occurredAt: e.occurredAt, referenceId: e.referenceId });
    }

    if (!(await transactions.tryInsertMany(userId, newTx))) {
      // A concurrent import created one of these UTRs first: insert one by one and link the clashes.
      for (const tx of newTx) {
        if (await transactions.tryInsertMany(userId, [tx])) continue;
        const winner = await transactions.findByReference(userId, tx.reference_id!, tx.direction!);
        if (!winner) throw new AppError("INTERNAL", { internal: { reason: "unique conflict without winner" } });
        for (const s of newSources) if (s.transaction_id === tx.id) s.transaction_id = winner.id;
        for (const o of outcomes) if (o.transaction_id === tx.id) Object.assign(o, { status: "linked", transaction_id: winner.id });
        for (const r of reviewItems) if (r.transaction_id === tx.id) r.transaction_id = winner.id;
        linkedIds.add(winner.id);
        counts.imported_count -= 1;
        counts.linked_count += 1;
      }
    }

    await sources.insertManyRows(userId, newSources);
    await rawEvents.saveOutcomes(userId, outcomes);

    const kinds = await sources.sourceKindsFor(userId, [...linkedIds]);
    await transactions.updateMany(
      userId,
      [...kinds].filter(([, k]) => k.size > 1).map(([id]) => id),
      { reconciliation: "reconciled" },
    );
    counts.review_count = await reviews.openMany(userId, reviewItems);
    await imports.addCounts(userId, await imports.findById(userId, row.id), counts);
  }

  /** Processes one chunk of pending rows. `done` once nothing is left; the caller schedules follow-ups. */
  async function processStep(userId: string, importId: string): Promise<{ done: boolean }> {
    const row = await imports.findById(userId, importId);
    if (row.status !== "processing") return { done: true };
    const pending = await rawEvents.listPending(userId, importId, JOBS.IMPORT_ROWS_PER_STEP);
    if (pending.length > 0) await processBatch(row, pending);
    if (pending.length === JOBS.IMPORT_ROWS_PER_STEP) return { done: false };

    await imports.update(userId, importId, { status: "completed", completed_at: new Date().toISOString() });
    // Raw rows are kept as provenance; the original file is no longer needed.
    await statementStorage.remove(row.file_path);
    await files.setStatus(userId, row.file_path, "deleted");
    log.info({ importId }, "import completed");
    return { done: true };
  }

  return { extractStage, processStep };
}
