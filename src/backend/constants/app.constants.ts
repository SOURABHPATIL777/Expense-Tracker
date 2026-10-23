import "server-only";
import type { JobType } from "@/shared/constants/enums";

export { PAGINATION, UPLOAD, SPLIT, TEXT, CURRENCY } from "@/shared/constants/limits";

export const APP = {
  NAME: "UPI Spend Tracker",
  API_VERSION: "v1",
} as const;

export const TIMEOUTS_MS = {
  LLM_DEFAULT: 30_000,
  LLM_MAX: 120_000,
  LLM_TEST: 15_000,
  STORAGE: 20_000,
} as const;

export const STORAGE = {
  /** Presigned R2 PUT URLs expire after this long. */
  SIGNED_UPLOAD_TTL_SECONDS: 10 * 60,
} as const;

export const JOBS = {
  DEFAULT_MAX_ATTEMPTS: 5,
  BATCH_SIZE: 5,
  LOCK_SECONDS: 120,
  BACKOFF_BASE_SECONDS: 30,
  BACKOFF_MAX_SECONDS: 60 * 60,
  /** Worker stops claiming new jobs after this much wall-clock time to stay under the function limit. */
  WORKER_BUDGET_MS: 45_000,
  /** Hard stop for any job started in a pass: the function limit (60 s, vercel.json) minus a margin. */
  INVOCATION_LIMIT_MS: 55_000,
  /** No job is started with less than this left before INVOCATION_LIMIT_MS. */
  MIN_JOB_START_MS: 20_000,
  /** Minimum gap between traffic-triggered worker passes on one server instance. */
  OPPORTUNISTIC_INTERVAL_MS: 60_000,
  /** Kept short so ordinary API calls don't hold their function open for long. */
  OPPORTUNISTIC_BUDGET_MS: 15_000,
  IMPORT_ROWS_PER_STEP: 500,
  CLASSIFY_PER_STEP: 50,
  LLM_BATCH_SIZE: 20,
  /** Categorisation batches sent to the model at the same time. */
  LLM_PARALLEL: 3,
} as const;

/**
 * Words found in statement column headers. A row (or PDF line) with at least
 * STATEMENT_TABLE.MIN_HEADER_CELLS such cells, and no dates or amounts, is a header row.
 */
export const STATEMENT_HEADER_WORDS = [
  "date", "txn", "tran", "trans", "transaction", "value", "posting", "time",
  "narration", "description", "particulars", "details", "remarks", "comment", "note",
  "chq", "cheque", "ref", "reference", "utr", "rrn", "order",
  "withdrawal", "withdrawals", "debit", "debits", "dr", "deposit", "deposits", "credit", "credits", "cr",
  "amount", "balance", "type", "mode", "status", "upi", "account", "payee", "beneficiary",
] as const;

export const STATEMENT_TABLE = {
  MIN_HEADER_CELLS: 3,
  /** Fewer transaction rows than this and a file isn't treated as a statement. */
  MIN_TRANSACTION_ROWS: 2,
  /** A rebuilt PDF table needs at least this many dated records to be used. */
  MIN_PDF_RECORDS: 3,
} as const;

/** Statement text that marks a credit as salary (matched on credits only, case-insensitive, whole words). */
export const SALARY_PATTERNS: readonly RegExp[] = [/\bsalary\b/i, /\bsal\b/i, /\bsal(ary)?[ -]?cr(edit)?\b/i, /\bpayroll\b/i, /\bstipend\b/i, /\/sal\//i];

/** Credits that look like salary from the same payer in recent months (sent to the LLM as a hint). */
export const SALARY_HINT = { LOOKBACK_DAYS: 100, AMOUNT_TOLERANCE: 0.25 } as const;

export const MATCHING = {
  /** Cross-source duplicate window when no UTR is available. */
  DUPLICATE_WINDOW_HOURS: 24,
  /** How far after a debit an incoming credit can be suggested as its refund. */
  REFUND_WINDOW_DAYS: 45,
  REPAYMENT_WINDOW_DAYS: 30,
} as const;

export const REPORTS = {
  MAX_RANGE_DAYS: 366,
  TOP_CATEGORIES: 8,
} as const;

/** Jobs enqueued (with `{ importId }`) once an import finishes processing. */
export const AFTER_IMPORT_JOBS: readonly JobType[] = ["classify_transactions", "match_refunds"];
