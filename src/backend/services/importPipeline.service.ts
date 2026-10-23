import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/backend/supabase/clients";
import type { Logger } from "@/backend/logger/logger";
import { AppError } from "@/backend/errors/AppError";
import { JOBS, MATCHING, STATEMENT_TABLE } from "@/backend/constants/app.constants";
import type { ImportStatus, SourceApp, SourceKind } from "@/backend/constants/enums.constants";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import { ImportsRepository } from "@/backend/repositories/imports.repository";
import { ImportLayoutsRepository } from "@/backend/repositories/importLayouts.repository";
import { RawEventsRepository } from "@/backend/repositories/rawEvents.repository";
import { TransactionsRepository, TransactionSourcesRepository, type CandidateRow } from "@/backend/repositories/transactions.repository";
import { ReviewItemsRepository, type NewReviewItem } from "@/backend/repositories/reviewItems.repository";
import { AccountsRepository } from "@/backend/repositories/accounts.repository";
import { UploadedFilesRepository } from "@/backend/repositories/uploadedFiles.repository";
import type { ImportLayoutRow, ImportRow, RawEventRow, TransactionRow, TransactionSourceRow } from "@/backend/repositories/types";
import { detectFormat, READER_LABELS, readerFor, readFile } from "@/backend/import/readers";
import { splitSections } from "@/backend/import/sections";
import { assertLooksLikeStatement } from "@/backend/import/statementCheck";
import { detectSource, type Source } from "@/backend/import/detectSource";
import { mapColumnsLocally } from "@/backend/import/headerMapping";
import { configFromMapping } from "@/backend/import/mapping";
import { proveMapping } from "@/backend/import/proveMapping";
import { parseTextRecords } from "@/backend/import/textRecords";
import { detectConfig, extract, findHeaderRow } from "@/backend/import/engine";
import { istDate } from "@/backend/import/dates";
import { headerSignature } from "@/backend/import/text";
import type { ExtractedRow, ExtractResult, ImportConfig, ParsedEvent, ReaderId, TableRead } from "@/backend/import/types";
import { fingerprintAll, sha256Hex } from "@/backend/domain/fingerprint";
import { matchIncoming, type ExistingTransaction } from "@/backend/domain/matcher";
import { inferKind, paymentRail } from "@/backend/domain/inferKind";
import { displayMerchant } from "@/backend/domain/merchant";
import { mapColumnsWithLlm } from "@/backend/llm/columnMapping";
import { statementStorage } from "./storage";

/** Statuses from which the extract stage may (re)run (`parsing`: interrupted, or left by the retired AI reader). */
const EXTRACTABLE = new Set<ImportStatus>(["queued", "parsing", "needs_password"]);
const HOUR_MS = 3_600_000;
const TEXT_LIMIT = 500;

type Detected = Source & { layoutId: string | null; label: string; readByAi: boolean; configId: string };

/** Share of dated records a text statement must read cleanly before its rows are trusted. */
const TEXT_RECORDS_MIN_SHARE = 0.8;

/** Rows plus the statement period they cover. */
const withPeriod = (rows: ExtractedRow[]): ExtractResult => {
  const days = rows.flatMap((r) => (r.parsed ? [istDate(r.parsed.occurredAt)] : [])).sort();
  return { rows, periodStart: days[0] ?? null, periodEnd: days.at(-1) ?? null };
};

/** The source read from the file itself wins over a stored layout's or the AI's guess. */
const withSource = (d: Detected, source: Source | null, formatLabel: string): Detected =>
  source && (source.sourceApp !== d.sourceApp || source.sourceKind !== d.sourceKind)
    ? { ...d, ...source, label: `${SOURCE_APP_LABELS[source.sourceApp]} statement (${formatLabel})` }
    : d;

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

  /** The stored (previously learned) layout that recognises this table, if any. */
  async function matchLayout(read: TableRead): Promise<{ layout: ImportLayoutRow; config: ImportConfig } | null> {
    const parsers = await layouts.parsers();
    const config = detectConfig(read, parsers.map((p) => p.config));
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
    if (parsed.length === 0) throw new AppError("NOT_A_STATEMENT");
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
   * Each table in the file (every sheet and section; PDF pages rebuilt as a table) is read with its
   * own column mapping, one per distinct header. Returns null when no section could be mapped.
   */
  async function readTableSections(
    userId: string,
    row: ImportRow,
    table: TableRead,
    formatLabel: string,
    source: Source | null,
  ): Promise<{ result: ExtractResult; detected: Detected } | null> {
    type Mapping = { config: ImportConfig; detected: Detected };
    const mappings = new Map<string, Mapping | null>();
    const rows: ExtractedRow[] = [];
    let first: Detected | null = null;
    let usedAi = false;

    for (const section of splitSections(table)) {
      const key = section.signature || "__whole__";
      if (!mappings.has(key)) mappings.set(key, await mapSection(userId, row, section.read, formatLabel, source));
      const mapping = mappings.get(key);
      if (!mapping) continue;
      first ??= mapping.detected;
      usedAi ||= mapping.detected.readByAi;
      // Row numbers point back at the original file, so they stay unique across sections.
      for (const r of extract(section.read, mapping.config).rows) rows.push({ ...r, rowIndex: section.rowIndexes[r.rowIndex] ?? r.rowIndex });
    }
    if (!first) return null;
    log.info({ importId: row.id, sections: mappings.size, rows: rows.length, ai: usedAi }, "table sections read");
    return { result: withPeriod(rows), detected: { ...first, readByAi: usedAi } };
  }

  /**
   * How to read one table, each answer proved on the file (rows parse, balances reconcile):
   * a stored layout for this header; else a mapping worked out locally from the header names;
   * else, only as a last resort, the LLM given the header and at most 5 redacted rows.
   */
  async function mapSection(
    userId: string,
    row: ImportRow,
    read: TableRead,
    formatLabel: string,
    source: Source | null,
  ): Promise<{ config: ImportConfig; detected: Detected } | null> {
    const match = await matchLayout(read);
    const stored = match ? proveMapping(read, match.config) : null;
    if (match && stored?.ok) {
      await layouts.touch(match.layout);
      const layoutSource = { sourceKind: match.layout.source_kind, sourceApp: match.layout.source_app as SourceApp };
      return { config: stored.config, detected: { ...layoutSource, layoutId: match.layout.id, label: match.layout.label, readByAi: false, configId: match.config.id } };
    }

    const local = mapColumnsLocally(read);
    if (local) {
      const header = read.rows[local.headerRowIndex];
      const known = source ?? fallbackSource(null);
      const config = configFromMapping(local, header, { ...known, label: `${SOURCE_APP_LABELS[known.sourceApp]} statement (${formatLabel})` });
      const proof = proveMapping(read, config);
      if (proof.ok) {
        const saved = await layouts.save(
          { kind: "table", signature: headerSignature(header), label: config.label, source_kind: known.sourceKind, source_app: known.sourceApp, config: proof.config },
          "manual",
        );
        return { config: proof.config, detected: { ...known, layoutId: saved.id, label: config.label, readByAi: false, configId: config.id } };
      }
      log.info({ importId: row.id, reason: proof.problems }, "local mapping not proved; asking the AI");
    }

    try {
      const mapped = await mapColumnsWithLlm(userId, row.file_name, read, formatLabel);
      const headerIdx = findHeaderRow(read.rows, mapped.config.table);
      const learned = await layouts.save({
        kind: "table",
        signature: headerSignature(read.rows[headerIdx] ?? []),
        label: mapped.config.label,
        source_kind: mapped.sourceKind,
        source_app: mapped.sourceApp,
        config: mapped.config,
      });
      return {
        config: mapped.config,
        detected: { sourceKind: mapped.sourceKind, sourceApp: mapped.sourceApp, layoutId: learned.id, label: mapped.config.label, readByAi: true, configId: mapped.config.id },
      };
    } catch (err) {
      // This table's columns couldn't be proved; other sections may still work.
      if (err instanceof AppError && err.code === "IMPORT_UNREADABLE") return null;
      throw err;
    }
  }

  async function extractStage(userId: string, importId: string, opts: { password?: string } = {}): Promise<ImportStatus> {
    let row = await imports.findById(userId, importId);
    if (!EXTRACTABLE.has(row.status)) return row.status;
    // `extracted_text` belonged to the retired AI reader; such imports are simply read again locally.
    row = await imports.update(userId, importId, { status: "parsing", error_code: null, error_message: null, extracted_text: null });
    await files.setStatus(userId, row.file_path, "processing");

    try {
      const { buffer, reader } = await loadFile(row);
      const read = await readFile(reader, buffer, opts.password);
      // Cheap gate: a statement has rows with dates and amounts.
      assertLooksLikeStatement(read);
      const formatLabel = READER_LABELS[reader];
      const table = read.kind === "table" ? read : read.table;
      // Whose statement it is, from its own header (IFSC, bank/app name) or the file name.
      const firstLines = read.kind === "text" ? read.lines : (table?.rows ?? []).map((r) => r.filter(Boolean).join(" "));
      const source = detectSource(row.file_name, firstLines);

      // Tables (CSV/Excel, HTML tables, JSON records, PDFs laid out as tables): every section.
      if (table) {
        const sections = await readTableSections(userId, row, table, formatLabel, source);
        if (sections) return await saveExtracted(row, sections.result, withSource(sections.detected, source, formatLabel));
      }
      if (read.kind === "table") {
        throw new AppError("IMPORT_UNREADABLE", { message: "We couldn't work out this file's columns. Try exporting it again, or as a different format." });
      }

      // Statements that aren't tables (UPI-app PDFs, activity pages, JSON lines): read locally.
      const records = parseTextRecords(read.lines);
      const parsed = records.filter((r) => r.parsed).length;
      if (parsed < STATEMENT_TABLE.MIN_TRANSACTION_ROWS || parsed / records.length < TEXT_RECORDS_MIN_SHARE) {
        throw new AppError("IMPORT_UNREADABLE", {
          message: "We couldn't read the transactions in this file. Download the statement as Excel or CSV if your app offers it.",
        });
      }
      // UPI-app statements often name the app only in their footer.
      const known = source ?? detectSource(row.file_name, read.lines, "document") ?? fallbackSource("upi_app");
      return await saveExtracted(row, withPeriod(records), {
        ...known,
        layoutId: null,
        label: `${SOURCE_APP_LABELS[known.sourceApp]} statement (${formatLabel})`,
        readByAi: false,
        configId: "text_records",
      });
    } catch (err) {
      if (err instanceof AppError && err.code === "PASSWORD_REQUIRED") {
        return setStatus(row, "needs_password", opts.password ? err.message : null, err.code);
      }
      if (err instanceof AppError && err.status < 500) return setStatus(row, "failed", err.message, err.code);
      // Transient failure (e.g. the AI fallback timed out): stay resumable for the job retry.
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
      payment_rail: paymentRail(e, row.source_kind ?? "bank"),
      reference_id: e.referenceId,
      app_transaction_id: e.appTransactionId,
      source_app: row.source_app ?? "other_bank",
      review_status: flagged ? "needs_review" : "ok",
    };
  }

  const toCandidate = (t: CandidateRow): ExistingTransaction => ({
    id: t.id,
    amountMinor: t.amount_minor,
    direction: t.direction,
    occurredAt: t.occurred_at,
    referenceId: t.reference_id,
    counterpartyVpa: t.counterparty_vpa,
    counterpartyName: t.merchant_normalized ?? t.merchant_raw,
    narration: t.narration,
    sourceKinds: t.transaction_sources.map((s) => s.source_kind),
    sourceApps: t.transaction_sources.map((s) => s.source_app),
    importIds: t.transaction_sources.map((s) => s.import_id),
    balances: t.transaction_sources.flatMap((s) => (typeof s.raw_events?.parsed?.balanceMinor === "number" ? [s.raw_events.parsed.balanceMinor] : [])),
  });

  /** Details the other statement adds to a linked transaction, filling only what's missing. */
  function enrichment(existing: ExistingTransaction, e: ParsedEvent, sourceKind: string): Partial<TransactionRow> {
    const appName = sourceKind === "upi_app" ? displayMerchant(e.counterpartyName, e.counterpartyVpa) : null;
    return {
      ...(!existing.referenceId && e.referenceId && { reference_id: e.referenceId }),
      ...(!existing.counterpartyVpa && e.counterpartyVpa && { counterparty_vpa: e.counterpartyVpa.toLowerCase() }),
      ...(e.appTransactionId && { app_transaction_id: e.appTransactionId }),
      // The app's clean payee name reads better than a bank narration ("UPI-SWIGGY-…").
      ...(appName && { merchant_normalized: appName }),
    };
  }

  async function processBatch(row: ImportRow, pending: RawEventRow[]): Promise<void> {
    const userId = row.user_id;
    const events = pending.map((raw) => ({ raw, e: raw.parsed as ParsedEvent }));
    const windowMs = Math.max(MATCHING.DUPLICATE_WINDOW_HOURS * HOUR_MS, (MATCHING.CROSS_SOURCE_DAYS_AFTER + 1) * 24 * HOUR_MS);
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

    const sourceKind = row.source_kind ?? "bank";
    const sourceApp = row.source_app ?? "other_bank";
    const enrichments = new Map<string, Partial<TransactionRow>>();
    const window = { daysBefore: MATCHING.CROSS_SOURCE_DAYS_BEFORE, daysAfter: MATCHING.CROSS_SOURCE_DAYS_AFTER, minutes: MATCHING.SAME_TIME_MINUTES };

    for (const { raw, e } of events) {
      if (known.has(raw.fingerprint)) {
        outcomes.push({ ...raw, status: "duplicate" });
        counts.duplicate_count += 1;
        continue;
      }
      const decision = matchIncoming(
        {
          amountMinor: e.amountMinor,
          direction: e.direction,
          occurredAt: e.occurredAt,
          referenceId: e.referenceId,
          sourceKind,
          sourceApp,
          importId: row.id,
          counterpartyVpa: e.counterpartyVpa,
          counterpartyName: e.counterpartyName,
          narration: e.narration,
          balanceMinor: e.balanceMinor,
        },
        candidates,
        window,
      );
      if (decision.kind === "same_row") {
        // Already imported from another copy of this statement.
        outcomes.push({ ...raw, status: "duplicate", transaction_id: decision.transactionId });
        counts.duplicate_count += 1;
        continue;
      }
      if (decision.kind === "same_reference" || decision.kind === "cross_source") {
        newSources.push(source(decision.transactionId, raw));
        outcomes.push({ ...raw, status: "linked", transaction_id: decision.transactionId });
        linkedIds.add(decision.transactionId);
        counts.linked_count += 1;
        const existing = candidates.find((c) => c.id === decision.transactionId)!;
        enrichments.set(existing.id, { ...enrichments.get(existing.id), ...enrichment(existing, e, sourceKind) });
        // It now has a row from this side too, so it can't be paired again.
        existing.sourceKinds.push(sourceKind);
        existing.sourceApps.push(sourceApp);
        if (!existing.referenceId && e.referenceId) existing.referenceId = e.referenceId;
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
      // Part of this import: later imports can match it, rows of this file never do.
      candidates.push({
        id,
        amountMinor: e.amountMinor,
        direction: e.direction,
        occurredAt: e.occurredAt,
        referenceId: e.referenceId,
        counterpartyVpa: e.counterpartyVpa,
        counterpartyName: e.counterpartyName,
        narration: e.narration,
        sourceKinds: [sourceKind],
        sourceApps: [sourceApp],
        importIds: [row.id],
        balances: e.balanceMinor === null ? [] : [e.balanceMinor],
      });
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
    for (const [id, patch] of enrichments) await transactions.enrich(userId, id, patch);
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

  /** Gives up on an import that is still in progress (its background job ran out of retries). */
  async function markFailed(userId: string, importId: string, message: string): Promise<void> {
    const row = await imports.findById(userId, importId);
    if (row.status === "completed" || row.status === "failed") return;
    await imports.update(userId, importId, { extracted_text: null });
    await setStatus(row, "failed", message, "IMPORT_INTERRUPTED");
  }

  return { extractStage, processStep, markFailed };
}
