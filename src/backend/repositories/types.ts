import "server-only";
import type {
  CategorySource,
  ClaimStatus,
  FileStatus,
  ParticipantResponse,
  SharedExpenseStatus,
  SplitMethod,
  Direction,
  ImportStatus,
  ReconciliationState,
  RefundStatus,
  ReviewItemKind,
  ReviewItemStatus,
  RuleField,
  RuleOperator,
  SourceKind,
  TransactionKind,
  TransactionReviewStatus,
  TransactionStatus,
} from "@/backend/constants/enums.constants";

// Row shapes exactly as stored in Postgres (snake_case). Replace with `npm run db:types` output
// once the project is linked; services map these to camelCase DTOs in src/backend/mappers.

type Timestamps = { created_at: string; updated_at: string };

export type ProfileRow = Timestamps & { id: string; display_name: string | null };

export type AccountRow = Timestamps & {
  id: string;
  user_id: string;
  label: string;
  source_kind: SourceKind;
  source_app: string;
  masked_number: string | null;
  upi_ids: string[];
  is_primary: boolean;
};

export type CategoryRow = Timestamps & {
  id: string;
  user_id: string;
  name: string;
  kind_hint: TransactionKind;
  color: string | null;
  is_system: boolean;
  /** The catalog entry (default_categories) this category was created from, if any. */
  default_category_id: string | null;
};


export type ImportRow = Timestamps & {
  id: string;
  user_id: string;
  account_id: string | null;
  source_kind: SourceKind | null;
  source_app: string | null;
  file_name: string;
  file_path: string;
  file_size: number;
  file_sha256: string;
  status: ImportStatus;
  preset_id: string | null;
  layout_id: string | null;
  extracted_text: string[] | null;
  detected_label: string | null;
  read_by_ai: boolean;
  error_code: string | null;
  error_message: string | null;
  row_count: number;
  imported_count: number;
  linked_count: number;
  duplicate_count: number;
  skipped_count: number;
  review_count: number;
  cursor: number;
  period_start: string | null;
  period_end: string | null;
  completed_at: string | null;
  file_deleted_at: string | null;
};

export type RawEventStatus = "pending" | "accepted" | "linked" | "duplicate" | "skipped" | "rejected";

export type UploadedFileRow = Timestamps & {
  id: string;
  user_id: string;
  import_id: string | null;
  file_name: string;
  file_key: string;
  bucket: string;
  content_type: string | null;
  size_bytes: number;
  sha256: string;
  status: FileStatus;
  deleted_at: string | null;
};

export type TransactionSourceRow = {
  id: string;
  user_id: string;
  transaction_id: string;
  raw_event_id: string;
  import_id: string;
  source_kind: SourceKind;
  source_app: string;
  created_at: string;
};

export type RawEventRow = {
  id: string;
  user_id: string;
  import_id: string;
  row_index: number;
  raw: unknown;
  parsed: unknown;
  fingerprint: string;
  status: RawEventStatus;
  error: string | null;
  transaction_id: string | null;
  created_at: string;
};

export type TransactionRow = Timestamps & {
  id: string;
  user_id: string;
  account_id: string | null;
  amount_minor: number;
  currency: string;
  direction: Direction;
  transaction_kind: TransactionKind;
  status: TransactionStatus;
  occurred_at: string;
  merchant_raw: string | null;
  merchant_normalized: string | null;
  counterparty_vpa: string | null;
  narration: string | null;
  note: string | null;
  category_id: string | null;
  category_source: CategorySource | null;
  category_confidence: number | null;
  user_locked: boolean;
  personal_share_minor: number | null;
  payment_rail: string;
  reference_id: string | null;
  app_transaction_id: string | null;
  source_app: string;
  reconciliation: ReconciliationState;
  review_status: TransactionReviewStatus;
};

export type RuleRow = Timestamps & {
  id: string;
  user_id: string;
  field: RuleField;
  operator: RuleOperator;
  pattern: string;
  category_id: string | null;
  transaction_kind: TransactionKind | null;
  priority: number;
  is_active: boolean;
};


export type ReviewItemRow = {
  id: string;
  user_id: string;
  kind: ReviewItemKind;
  status: ReviewItemStatus;
  transaction_id: string | null;
  related_transaction_id: string | null;
  raw_event_id: string | null;
  payload: Record<string, unknown>;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type RefundRow = Timestamps & {
  id: string;
  user_id: string;
  transaction_id: string;
  expected_amount_minor: number;
  expected_by: string | null;
  order_ref: string | null;
  note: string | null;
  status: RefundStatus;
  matched_transaction_id: string | null;
  suggested_transaction_ids: string[];
  resolved_at: string | null;
};


export type SharedExpenseRow = Timestamps & {
  id: string;
  user_id: string;
  transaction_id: string | null;
  title: string;
  total_minor: number;
  currency: string;
  split_method: SplitMethod;
  note: string | null;
  version: number;
  status: SharedExpenseStatus;
};

export type ParticipantRow = Timestamps & {
  id: string;
  user_id: string;
  expense_id: string;
  display_name: string;
  is_owner: boolean;
  share_minor: number;
  response_status: ParticipantResponse;
  accepted_version: number | null;
  responded_at: string | null;
};

export type InviteRow = {
  id: string;
  user_id: string;
  participant_id: string;
  token_hash: string;
  expires_at: string;
  redeemed_by: string | null;
  redeemed_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type GuestAccessRow = {
  id: string;
  user_id: string;
  participant_id: string;
  auth_user_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type ClaimRow = {
  id: string;
  user_id: string;
  participant_id: string;
  amount_minor: number;
  status: ClaimStatus;
  reported_by: "guest" | "owner";
  matched_transaction_id: string | null;
  note: string | null;
  idempotency_key: string;
  reported_at: string;
  resolved_at: string | null;
};

export type ExpenseEventRow = {
  id: number;
  user_id: string;
  expense_id: string;
  participant_id: string | null;
  actor: "owner" | "guest";
  action: string;
  version: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ImportLayoutKind = "table" | "llm_extract";

/** Shared (not per-user) statement layout, learned by the LLM: how to read one bank's/app's export. */
export type ImportLayoutRow = {
  id: string;
  kind: ImportLayoutKind;
  signature: string;
  label: string;
  source_kind: SourceKind;
  source_app: string;
  config: unknown;
  origin: "llm" | "manual";
  priority: number;
  verified: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
};

/**
 * Keyword → category. Shared rows (user_id null) point at the catalog via default_category_id;
 * a user's own rows point at their category via category_id.
 */
export type CategoryKeywordRow = Timestamps & {
  id: string;
  keyword: string;
  default_category_id: string | null;
  user_id: string | null;
  category_id: string | null;
  transaction_kind: TransactionKind | null;
  origin: CategoryKeywordOrigin;
  use_count: number;
};

export type CategoryKeywordOrigin = "seed" | "llm" | "user" | "manual";
