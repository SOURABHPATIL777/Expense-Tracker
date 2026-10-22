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
  IMPORT_ROWS_PER_STEP: 500,
  CLASSIFY_PER_STEP: 50,
  LLM_BATCH_SIZE: 20,
} as const;

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
