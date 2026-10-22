// Single source of truth for every enumerated value used by the database, API and UI.
// The SQL enums in supabase/migrations mirror these tuples exactly.

export const DIRECTIONS = ["debit", "credit"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const TRANSACTION_KINDS = [
  "expense",
  "income",
  "self_transfer",
  "refund",
  "reversal",
  "reimbursable",
  "cc_bill_payment",
  "unknown",
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_STATUSES = ["success", "pending", "failed", "reversed"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_REVIEW_STATUSES = ["ok", "needs_review"] as const;
export type TransactionReviewStatus = (typeof TRANSACTION_REVIEW_STATUSES)[number];

export const RECONCILIATION_STATES = ["single_source", "reconciled"] as const;
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

export const SOURCE_KINDS = ["upi_app", "bank"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const UPI_APPS = ["phonepe", "gpay", "paytm", "other_upi"] as const;
export type UpiApp = (typeof UPI_APPS)[number];

export const BANKS = [
  "hdfc",
  "icici",
  "sbi",
  "pnb",
  "bob",
  "canara",
  "union",
  "boi",
  "indian",
  "central",
  "iob",
  "uco",
  "bom",
  "psb",
  "other_bank",
] as const;
export type Bank = (typeof BANKS)[number];

export const SOURCE_APPS = [...UPI_APPS, ...BANKS] as const;
export type SourceApp = (typeof SOURCE_APPS)[number];

export const IMPORT_STATUSES = [
  "uploaded",
  "queued",
  "parsing",
  "needs_mapping",
  "needs_password",
  "processing",
  "completed",
  "failed",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const REVIEW_ITEM_KINDS = [
  "duplicate_candidate",
  "low_confidence_category",
  "transfer_confirmation",
  "refund_match",
] as const;
export type ReviewItemKind = (typeof REVIEW_ITEM_KINDS)[number];

export const REVIEW_ITEM_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReviewItemStatus = (typeof REVIEW_ITEM_STATUSES)[number];

export const CATEGORY_SOURCES = ["rule", "merchant_map", "llm", "user", "system"] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

export const RULE_FIELDS = ["merchant", "vpa", "narration"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPERATORS = ["contains", "equals", "starts_with"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export const REFUND_STATUSES = ["open", "suggested", "matched", "closed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const LLM_PROVIDERS = ["openai", "google", "xai", "ollama"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_TASKS = ["categorize", "monthly_summary", "refund_message"] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

export const JOB_TYPES = ["parse_import", "classify_transactions", "match_refunds"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "dead"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SPLIT_METHODS = ["equal", "exact", "percent"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export const SHARED_EXPENSE_STATUSES = ["open", "closed", "cancelled"] as const;
export type SharedExpenseStatus = (typeof SHARED_EXPENSE_STATUSES)[number];

export const PARTICIPANT_RESPONSES = ["pending", "agreed", "questioned"] as const;
export type ParticipantResponse = (typeof PARTICIPANT_RESPONSES)[number];

export const CLAIM_STATUSES = ["reported", "confirmed", "rejected", "withdrawn"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
