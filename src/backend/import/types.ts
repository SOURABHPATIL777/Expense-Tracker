import "server-only";
import type { Direction, SourceApp, SourceKind, TransactionStatus } from "@/backend/constants/enums.constants";

// ---------------------------------------------------------------------------
// Reader output: every file format is reduced to one of two shapes.
// ---------------------------------------------------------------------------

/** Spreadsheet-like data (CSV, XLS/XLSX). Every cell is a string; XLS dates become `yyyy-MM-dd HH:mm:ss`. */
export type TableRead = { kind: "table"; rows: string[][] };

/** Text extracted from a PDF, one visual line per entry. */
export type TextRead = { kind: "text"; lines: string[] };

export type ReadResult = TableRead | TextRead;

export type ReaderId = "csv" | "xlsx" | "pdf_text";

/** Tabular presets match CSV and Excel alike; text presets read PDFs. */
export type ConfigReader = "table" | "pdf_text";

// ---------------------------------------------------------------------------
// Import configuration: presets and user templates share this declarative shape.
// A new bank or UPI app is a new config object, never new parsing code.
// ---------------------------------------------------------------------------

export type AmountSpec =
  /** Separate withdrawal/deposit columns (most bank statements). */
  | { mode: "split"; debit: string[]; credit: string[] }
  /** One column, sign or Dr/Cr suffix decides direction ("-350", "+500", "450.00 Dr"). */
  | { mode: "signed"; amount: string[] }
  /** One amount column plus a type column ("DEBIT"/"CREDIT", "Paid"/"Received"). */
  | { mode: "typed"; amount: string[]; type: string[]; debitValues: string[]; creditValues: string[] };

export type StatusSpec = { column: string[]; map: Record<string, TransactionStatus> };

/** Column aliases per field. Each alias is compared after header normalisation. */
export type TableColumns = {
  date: string[];
  time?: string[];
  narration?: string[];
  counterparty?: string[];
  vpa?: string[];
  reference?: string[];
  appTransactionId?: string[];
  balance?: string[];
  note?: string[];
};

export type TableSpec = {
  /** Normalised header tokens that must all be present in the header row (detection signature). */
  headerMatch: string[];
  columns: TableColumns;
  amount: AmountSpec;
  status?: StatusSpec;
  dateFormats: string[];
};

/** Regex-driven extraction for text sources. Patterns use named groups. */
export type TextSpec = {
  /** All must match for the preset to be detected. */
  detect: string[];
  /** Only search the first N lines (statement header) — narrations mention other banks' names. */
  detectWithinLines?: number;
  /** Splits the line stream into records; each match starts a new record. */
  recordStart: string;
  /** Lines matching any of these are dropped before record splitting (page headers/footers). */
  ignoreLines?: string[];
  fields: {
    /** Must capture `date` (and optionally `time`). */
    date: string;
    /** Must capture `amount`; may also capture the running `balance`. */
    amount: string;
    /** Keyword fallbacks for direction (used when the balance can't decide it). */
    debitWhen: string;
    creditWhen: string;
    /** Captures `narration`; defaults to the record's first line. */
    narration?: string;
    counterparty?: string;
    vpa?: string;
    reference?: string;
    appTransactionId?: string;
    time?: string;
  };
  status?: Array<{ when: string; status: TransactionStatus }>;
  dateFormats: string[];
  /**
   * Bank PDFs render debit/credit as unlabeled columns; with a captured running balance the
   * direction is the sign of the balance change from the previous row.
   */
  directionFromBalance?: boolean;
};

export type ImportConfig = {
  id: string;
  label: string;
  sourceKind: SourceKind;
  sourceApp: SourceApp;
  reader: ConfigReader;
  /** True only once a real, anonymised export has passed the fixture tests. */
  verified: boolean;
  table?: TableSpec;
  text?: TextSpec;
};

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

export type ParsedEvent = {
  occurredAt: string;
  amountMinor: number;
  direction: Direction;
  status: TransactionStatus;
  counterpartyName: string | null;
  counterpartyVpa: string | null;
  narration: string | null;
  referenceId: string | null;
  appTransactionId: string | null;
  balanceMinor: number | null;
  note: string | null;
};

export type ExtractedRow = {
  rowIndex: number;
  raw: string[] | string;
  parsed: ParsedEvent | null;
  /** Why the row could not be parsed (kept for the review screen). */
  error: string | null;
};

export type ExtractResult = {
  rows: ExtractedRow[];
  periodStart: string | null;
  periodEnd: string | null;
};
