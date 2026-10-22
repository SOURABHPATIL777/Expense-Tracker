import "server-only";

export const TABLES = {
  PROFILES: "profiles",
  FINANCIAL_ACCOUNTS: "financial_accounts",
  IMPORT_TEMPLATES: "import_templates",
  IMPORTS: "imports",
  RAW_EVENTS: "raw_events",
  TRANSACTIONS: "transactions",
  TRANSACTION_SOURCES: "transaction_sources",
  CATEGORIES: "categories",
  CATEGORIZATION_RULES: "categorization_rules",
  MERCHANT_MAP: "merchant_map",
  REVIEW_ITEMS: "review_items",
  REFUND_EXPECTATIONS: "refund_expectations",
  LLM_CONFIGS: "llm_configs",
  AGENT_RUNS: "agent_runs",
  JOBS: "jobs",
  AUDIT_EVENTS: "audit_events",
  SHARED_EXPENSES: "shared_expenses",
  EXPENSE_PARTICIPANTS: "expense_participants",
  SHARE_INVITES: "share_invites",
  GUEST_ACCESS: "guest_access",
  PAYMENT_CLAIMS: "payment_claims",
  EXPENSE_EVENTS: "expense_events",
  IDEMPOTENCY_KEYS: "idempotency_keys",
} as const;
export type TableName = (typeof TABLES)[keyof typeof TABLES];

export const RPC = {
  CLAIM_JOBS: "claim_jobs",
  RATE_LIMIT_HIT: "rate_limit_hit",
  REPORT_OVERVIEW: "report_overview",
  REPORT_CATEGORY_BREAKDOWN: "report_category_breakdown",
  REDEEM_INVITE: "redeem_invite",
  GUEST_GET_SHARE: "guest_get_share",
  GUEST_RESPOND: "guest_respond",
  GUEST_REPORT_PAYMENT: "guest_report_payment",
  OWNER_RESOLVE_CLAIM: "owner_resolve_claim",
  SAVE_SPLIT: "save_split",
  DELETE_IMPORT: "delete_import",
} as const;

export const BUCKETS = {
  STATEMENTS: "statements",
} as const;

export const PG_ERROR = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  INSUFFICIENT_PRIVILEGE: "42501",
  RAISE_EXCEPTION: "P0001",
  NO_ROWS: "PGRST116",
} as const;
