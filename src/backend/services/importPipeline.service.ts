import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/backend/supabase/clients";
import type { Logger } from "@/backend/logger/logger";
import { AppError } from "@/backend/errors/AppError";
import { JOBS, MATCHING } from "@/backend/constants/app.constants";
import type { ImportStatus } from "@/backend/constants/enums.constants";
import { SOURCE_CONFIG } from "@/shared/constants/sources";
import { ImportsRepository, ImportTemplatesRepository } from "@/backend/repositories/imports.repository";
import { RawEventsRepository } from "@/backend/repositories/rawEvents.repository";
import { TransactionsRepository, TransactionSourcesRepository } from "@/backend/repositories/transactions.repository";
import { ReviewItemsRepository, type NewReviewItem } from "@/backend/repositories/reviewItems.repository";
import { AccountsRepository } from "@/backend/repositories/accounts.repository";
import type { ImportRow, RawEventRow, TransactionRow, TransactionSourceRow } from "@/backend/repositories/types";
import { detectFormat, readerFor, readFile } from "@/backend/import/readers";
import { detectConfig, extract } from "@/backend/import/engine";
import { headerSignatures } from "@/backend/import/mapping";
import { PRESETS } from "@/backend/import/presets";
import type { ImportConfig, ParsedEvent, ReaderId, ReadResult } from "@/backend/import/types";
import { fingerprintAll, sha256Hex } from "@/backend/domain/fingerprint";
import { matchIncoming, type MatchCandidate } from "@/backend/domain/matcher";
import { inferKind, paymentRail } from "@/backend/domain/inferKind";
import { displayMerchant } from "@/backend/domain/merchant";
import { statementStorage } from "./storage";

/** Statuses from which the extract stage may (re)run. */
const EXTRACTABLE = new Set<ImportStatus>(["queued", "parsing", "needs_password"]);
const HOUR_MS = 3_600_000;
const TEXT_LIMIT = 500;

/**
 * Two-stage import pipeline:
 *  1. extract — read the file, pick a preset/template, store every row as a raw event (provenance).
 *  2. process — in resumable chunks, match raw events against existing transactions (UTR first,
 *     then amount+time as a review candidate) and create/link transactions.
 * Works with either the user's client (inline, RLS-scoped) or the worker's service client.
 */
export function importPipeline(db: Db, log: Logger) {
  const imports = new ImportsRepository(db);
  const templates = new ImportTemplatesRepository(db);
  const rawEvents = new RawEventsRepository(db);
  const transactions = new TransactionsRepository(db);
  const sources = new TransactionSourcesRepository(db);
  const reviews = new ReviewItemsRepository(db);
  const accounts = new AccountsRepository(db);

  async function loadFile(row: ImportRow): Promise<{ buffer: Buffer; reader: ReaderId }> {
    const buffer = await statementStorage.download(db, row.file_path);
    if (sha256Hex(buffer) !== row.file_sha256) {
      throw new AppError("IMPORT_UNREADABLE", { message: "The uploaded file doesn't match what was registered. Please upload it again." });
    }
    const format = detectFormat(row.file_name, buffer);
    if (!SOURCE_CONFIG[row.source_app as keyof typeof SOURCE_CONFIG].formats.includes(format)) throw new AppError("UNSUPPORTED_FILE");
    return { buffer, reader: readerFor(format) };
  }

  async function resolveConfig(row: ImportRow, read: ReadResult, reader: ReaderId): Promise<{ config: ImportConfig; templateId: string | null } | null> {
    if (row.config) return { config: row.config as ImportConfig, templateId: row.template_id };
    if (read.kind === "table") {
      const [template] = await templates.findBySignatures(row.user_id, headerSignatures(read.rows));
      if (template) return { config: template.config as ImportConfig, templateId: template.id };
    }
    const preset = detectConfig(read, reader, [...PRESETS], row.source_app);
    return preset ? { config: preset, templateId: null } : null;
  }

  const setStatus = (row: ImportRow, status: ImportStatus, message: string | null = null, code: string | null = null) =>
    imports.update(row.user_id, row.id, { status, error_message: message, error_code: code }).then(() => status);

  async function extractStage(userId: string, importId: string, opts: { password?: string } = {}): Promise<ImportStatus> {
    let row = await imports.findById(userId, importId);
    if (!EXTRACTABLE.has(row.status)) return row.status;
    row = await imports.update(userId, importId, { status: "parsing", error_code: null, error_message: null });

    try {
      const { buffer, reader } = await loadFile(row);
      const read = await readFile(reader, buffer, opts.password);
      const resolved = await resolveConfig(row, read, reader);
      if (!resolved) {
        return read.kind === "table"
          ? setStatus(row, "needs_mapping", "We don't recognise this layout yet. Tell us which column is which.")
          : setStatus(row, "failed", "We couldn't find transactions in this PDF.", "IMPORT_UNREADABLE");
      }

      const result = extract(read, resolved.config);
      const parsed = result.rows.filter((r) => r.parsed);
      if (parsed.length === 0) {
        return read.kind === "table" && !row.config
          ? setStatus(row, "needs_mapping", "The file opened, but no transactions matched the expected layout. Map the columns to continue.")
          : setStatus(row, "failed", "No transactions were found in this file.", "IMPORT_UNREADABLE");
      }

      const fingerprints = fingerprintAll(row.source_app, parsed.map((r) => r.parsed!));
      let next = 0;
      const rawRows = result.rows.map((r) => ({
        import_id: importId,
        row_index: r.rowIndex,
        raw: r.raw,
        parsed: r.parsed,
        fingerprint: r.parsed ? fingerprints[next++] : sha256Hex(`${importId}|${r.rowIndex}`),
        status: (r.parsed ? "pending" : "rejected") as RawEventRow["status"],
        error: r.error,
        transaction_id: null,
      }));
      await rawEvents.replaceForImport(userId, importId, rawRows);
      await imports.update(userId, importId, {
        status: "processing",
        preset_id: resolved.config.id,
        template_id: resolved.templateId,
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
      log.info({ importId, preset: resolved.config.id, rows: rawRows.length }, "import extracted");
      return "processing";
    } catch (err) {
      if (err instanceof AppError && err.code === "PASSWORD_REQUIRED") {
        return setStatus(row, "needs_password", opts.password ? err.message : null, err.code);
      }
      if (err instanceof AppError && err.status < 500) return setStatus(row, "failed", err.message, err.code);
      // Transient failure: leave it resumable for the job retry.
      await setStatus(row, "queued");
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
      payment_rail: paymentRail(e, row.source_kind),
      reference_id: e.referenceId,
      app_transaction_id: e.appTransactionId,
      source_app: row.source_app,
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
      source_kind: row.source_kind,
      source_app: row.source_app,
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
    await statementStorage.remove(db, row.file_path);
    log.info({ importId }, "import completed");
    return { done: true };
  }

  return { extractStage, processStep };
}
