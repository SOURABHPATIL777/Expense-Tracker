import "server-only";
import type { Direction, SourceApp, SourceKind, TransactionStatus } from "@/backend/constants/enums.constants";

// ---------------------------------------------------------------------------
// Reader output: every file format is reduced to one of two shapes.
// ---------------------------------------------------------------------------

/** Spreadsheet-like data (CSV, XLS/XLSX). Every cell is a string; XLS dates become `yyyy-MM-dd HH:mm:ss`. */
export type TableRead = { kind: "table"; rows: string[][] };

/**
 * Text (PDF, HTML page, JSON records), one visual line per entry, for the AI reader. `table` is
 * set when the file's layout could also be rebuilt as a table (columns from its header), which is
 * tried first.
 */
export type TextRead = { kind: "text"; lines: string[]; table?: TableRead };

export type ReadResult = TableRead | TextRead;

export type ReaderId = "csv" | "xlsx" | "pdf_text" | "html" | "json";

/** Table layouts read CSV and Excel alike; PDFs are read by the LLM (llm/pdfExtraction.ts). */
export type ConfigReader = "table";

// ---------------------------------------------------------------------------
// Import configuration: a declarative table layout, stored in import_layouts once the LLM has
// worked it out. A new bank or UPI app is a new config object, never new parsing code.
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

export type ImportConfig = {
  id: string;
  label: string;
  sourceKind: SourceKind;
  sourceApp: SourceApp;
  reader: ConfigReader;
  /** True only once a real, anonymised export has passed the fixture tests. */
  verified: boolean;
  table: TableSpec;
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
