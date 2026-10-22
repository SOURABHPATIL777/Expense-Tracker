import "server-only";
import { parseAmountToMinor } from "@/shared/utils/money";
import type { Direction, TransactionStatus } from "@/backend/constants/enums.constants";
import { parseUpiNarration } from "@/backend/domain/upiParse";
import { istDate, parseStatementDate } from "./dates";
import { nullIfEmpty, normalizeHeader } from "./text";
import type { ExtractedRow, ExtractResult, ImportConfig, ParsedEvent, ReaderId, ReadResult, TableRead, TableSpec, TextRead, TextSpec } from "./types";

const HEADER_SCAN_ROWS = 40;
const DETECT_TEXT_CHARS = 20_000;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Index of the header row within the first rows of a table, or -1. Statements often have a preamble. */
export function findHeaderRow(rows: string[][], spec: Pick<TableSpec, "headerMatch">): number {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].map(normalizeHeader);
    if (spec.headerMatch.every((token) => cells.some((c) => c === token || c.startsWith(`${token} `)))) return i;
  }
  return -1;
}

const textOf = (read: TextRead, withinLines?: number) =>
  (withinLines ? read.lines.slice(0, withinLines) : read.lines).join("\n").slice(0, DETECT_TEXT_CHARS);

export function matchesConfig(read: ReadResult, config: ImportConfig, reader: ReaderId): boolean {
  if (read.kind === "table") return config.reader === "table" && Boolean(config.table) && findHeaderRow(read.rows, config.table!) >= 0;
  if (config.reader !== reader || !config.text) return false;
  const text = textOf(read, config.text.detectWithinLines);
  return config.text.detect.every((p) => new RegExp(p, "im").test(text));
}

/** Prefers configs for the app/bank the user picked, then any config that matches the file. */
export function detectConfig(read: ReadResult, reader: ReaderId, configs: ImportConfig[], preferredApp?: string): ImportConfig | null {
  // Most specific signature first, so a subset signature (e.g. a generic bank) never shadows a fuller one.
  const candidates = configs
    .filter((c) => matchesConfig(read, c, reader))
    .sort((a, b) => (b.table?.headerMatch.length ?? b.text?.detect.length ?? 0) - (a.table?.headerMatch.length ?? a.text?.detect.length ?? 0));
  return candidates.find((c) => c.sourceApp === preferredApp) ?? candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export function extract(read: ReadResult, config: ImportConfig): ExtractResult {
  const rows = read.kind === "table" ? extractTable(read, config.table!) : extractText(read, config.text!);
  const dates = rows.flatMap((r) => (r.parsed ? [istDate(r.parsed.occurredAt)] : [])).sort();
  return { rows, periodStart: dates[0] ?? null, periodEnd: dates.at(-1) ?? null };
}

function columnIndex(header: string[], aliases: string[] | undefined): number {
  if (!aliases?.length) return -1;
  for (const alias of aliases) {
    const exact = header.indexOf(alias);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const prefix = header.findIndex((h) => h.startsWith(alias));
    if (prefix >= 0) return prefix;
  }
  return -1;
}

type Resolved = { amountMinor: number; direction: Direction } | null;

function resolveAmount(cell: (aliases?: string[]) => string, spec: TableSpec): Resolved {
  const a = spec.amount;
  if (a.mode === "split") {
    const debit = parseAmountToMinor(cell(a.debit)) ?? 0;
    const credit = parseAmountToMinor(cell(a.credit)) ?? 0;
    if (Math.abs(debit) > 0) return { amountMinor: Math.abs(debit), direction: "debit" };
    if (Math.abs(credit) > 0) return { amountMinor: Math.abs(credit), direction: "credit" };
    return null;
  }
  if (a.mode === "signed") {
    const raw = cell(a.amount);
    const value = parseAmountToMinor(raw);
    if (!value) return null;
    const direction: Direction = /\bdr\b/i.test(raw) ? "debit" : /\bcr\b/i.test(raw) ? "credit" : value < 0 ? "debit" : "credit";
    return { amountMinor: Math.abs(value), direction };
  }
  const value = parseAmountToMinor(cell(a.amount));
  if (!value) return null;
  const type = normalizeHeader(cell(a.type));
  if (a.debitValues.some((v) => type === normalizeHeader(v))) return { amountMinor: Math.abs(value), direction: "debit" };
  if (a.creditValues.some((v) => type === normalizeHeader(v))) return { amountMinor: Math.abs(value), direction: "credit" };
  return null;
}

function mapStatus(value: string, map: Record<string, TransactionStatus> | undefined): TransactionStatus {
  if (!map) return "success";
  const key = normalizeHeader(value);
  return map[key] ?? "success";
}

function buildEvent(fields: {
  occurredAt: string;
  amount: NonNullable<Resolved>;
  status: TransactionStatus;
  narration: string | null;
  counterparty: string | null;
  vpa: string | null;
  reference: string | null;
  appTransactionId: string | null;
  balance: string | null;
  note: string | null;
}): ParsedEvent {
  const upi = parseUpiNarration(fields.narration);
  return {
    occurredAt: fields.occurredAt,
    amountMinor: fields.amount.amountMinor,
    direction: fields.amount.direction,
    status: fields.status,
    counterpartyName: fields.counterparty ?? upi.name,
    counterpartyVpa: (fields.vpa ?? upi.vpa)?.toLowerCase() ?? null,
    narration: fields.narration,
    // The UPI UTR is the cross-source key (app ↔ bank), so it wins over a bank's own reference column.
    referenceId: upi.utr ?? normaliseRef(fields.reference),
    appTransactionId: fields.appTransactionId,
    balanceMinor: fields.balance ? parseAmountToMinor(fields.balance) : null,
    note: fields.note,
  };
}

/** Bank reference columns often hold cheque numbers or zeros; keep only plausible UTR/RRNs. */
function normaliseRef(ref: string | null): string | null {
  const v = ref?.replace(/\s/g, "");
  if (!v || /^0+$/.test(v) || v.length < 6) return null;
  return v;
}

function extractTable(read: TableRead, spec: TableSpec): ExtractedRow[] {
  const headerIdx = findHeaderRow(read.rows, spec);
  if (headerIdx < 0) return [];
  const header = read.rows[headerIdx].map(normalizeHeader);
  const idx = (aliases?: string[]) => columnIndex(header, aliases);
  const out: ExtractedRow[] = [];

  for (let r = headerIdx + 1; r < read.rows.length; r++) {
    const row = read.rows[r];
    const cell = (aliases?: string[]) => {
      const i = idx(aliases);
      return i >= 0 ? (row[i] ?? "") : "";
    };
    if (row.every((c) => !c)) continue;

    const amount = resolveAmount(cell, spec);
    const occurredAt = parseStatementDate(cell(spec.columns.date), spec.dateFormats, nullIfEmpty(cell(spec.columns.time)));
    // Opening/closing balance lines, totals and footers have neither a date nor an amount.
    if (!amount && !occurredAt) continue;
    const base = { rowIndex: r, raw: row };
    if (!occurredAt) {
      out.push({ ...base, parsed: null, error: "Unrecognised date" });
      continue;
    }
    if (!amount) {
      out.push({ ...base, parsed: null, error: "No debit or credit amount" });
      continue;
    }
    out.push({
      ...base,
      error: null,
      parsed: buildEvent({
        occurredAt,
        amount,
        status: mapStatus(cell(spec.status?.column), spec.status?.map),
        narration: nullIfEmpty(cell(spec.columns.narration)),
        counterparty: nullIfEmpty(cell(spec.columns.counterparty)),
        vpa: nullIfEmpty(cell(spec.columns.vpa)),
        reference: nullIfEmpty(cell(spec.columns.reference)),
        appTransactionId: nullIfEmpty(cell(spec.columns.appTransactionId)),
        balance: nullIfEmpty(cell(spec.columns.balance)),
        note: nullIfEmpty(cell(spec.columns.note)),
      }),
    });
  }
  return out;
}

/** Splits a PDF line stream into records at each `recordStart` match. */
export function splitRecords(lines: string[], spec: TextSpec): string[] {
  const ignore = (spec.ignoreLines ?? []).map((p) => new RegExp(p, "i"));
  const start = new RegExp(spec.recordStart, "i");
  const records: string[][] = [];
  for (const line of lines) {
    if (ignore.some((re) => re.test(line))) continue;
    if (start.test(line)) records.push([line]);
    else records.at(-1)?.push(line);
  }
  return records.map((r) => r.join("\n"));
}

function extractText(read: TextRead, spec: TextSpec): ExtractedRow[] {
  const records = splitRecords(read.lines, spec);
  const re = (p?: string) => (p ? new RegExp(p, "im") : null);
  const f = spec.fields;
  const [dateRe, amountRe, debitRe, creditRe] = [re(f.date)!, re(f.amount)!, re(f.debitWhen)!, re(f.creditWhen)!];
  const group = (pattern: string | undefined, text: string, name: string) => nullIfEmpty(re(pattern)?.exec(text)?.groups?.[name]);
  const out: ExtractedRow[] = [];
  let previousBalance: number | null = null;

  records.forEach((text, rowIndex) => {
    const base = { rowIndex, raw: text };
    const dateMatch = dateRe.exec(text)?.groups;
    const timeText = dateMatch?.time ?? group(f.time, text, "time");
    const occurredAt = dateMatch?.date ? parseStatementDate(dateMatch.date, spec.dateFormats, timeText) : null;
    const amountGroups = amountRe.exec(text)?.groups;
    const amountMinor = parseAmountToMinor(amountGroups?.amount ?? null);
    const balance = parseAmountToMinor(amountGroups?.balance ?? null);
    const byKeyword: Direction | null = debitRe.test(text) ? "debit" : creditRe.test(text) ? "credit" : null;
    const byBalance: Direction | null =
      spec.directionFromBalance && balance !== null && previousBalance !== null && balance !== previousBalance
        ? balance < previousBalance ? "debit" : "credit"
        : null;
    const direction = byBalance ?? byKeyword;
    if (balance !== null) previousBalance = balance;

    // Statement periods, headers and summaries can start with a date but carry no amount.
    if (!amountMinor) return;
    if (!occurredAt || !direction) {
      out.push({ ...base, parsed: null, error: !occurredAt ? "Unrecognised date" : "Could not tell debit from credit" });
      return;
    }
    const status = spec.status?.find((s) => new RegExp(s.when, "i").test(text))?.status ?? "success";
    out.push({
      ...base,
      error: null,
      parsed: buildEvent({
        occurredAt,
        amount: { amountMinor: Math.abs(amountMinor), direction },
        status,
        narration: group(f.narration, text, "narration") ?? text.split("\n")[0] ?? null,
        counterparty: group(f.counterparty, text, "counterparty"),
        vpa: group(f.vpa, text, "vpa"),
        reference: group(f.reference, text, "reference"),
        appTransactionId: group(f.appTransactionId, text, "appTransactionId"),
        balance: amountGroups?.balance ?? null,
        note: null,
      }),
    });
  });
  return out;
}
