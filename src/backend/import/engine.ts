import "server-only";
import { parseAmountToMinor } from "@/shared/utils/money";
import type { Direction, TransactionStatus } from "@/backend/constants/enums.constants";
import { parseUpiNarration } from "@/backend/domain/upiParse";
import { istDate, parseStatementDate } from "./dates";
import { nullIfEmpty, normalizeHeader } from "./text";
import type { ExtractedRow, ExtractResult, ImportConfig, ParsedEvent, TableRead, TableSpec } from "./types";

const HEADER_SCAN_ROWS = 40;

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

/** The stored layout whose header appears in this table, if any. */
export function detectConfig(read: TableRead, configs: readonly ImportConfig[]): ImportConfig | null {
  // Most specific header first, so a subset header never shadows a fuller one.
  const candidates = configs.filter((c) => findHeaderRow(read.rows, c.table) >= 0).sort((a, b) => b.table.headerMatch.length - a.table.headerMatch.length);
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export function extract(read: TableRead, config: ImportConfig): ExtractResult {
  const rows = extractTable(read, config.table);
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
