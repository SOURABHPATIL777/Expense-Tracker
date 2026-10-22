import "server-only";
import type {
  CategorySource,
  FileStatus,
  Direction,
  ImportStatus,
  LlmProvider,
  LlmTask,
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
};

export type ImportTemplateRow = Timestamps & {
  id: string;
  user_id: string;
  name: string;
  source_kind: SourceKind;
  source_app: string;
  header_signature: string;
  config: unknown;
};

export type ImportRow = Timestamps & {
  id: string;
  user_id: string;
  account_id: string | null;
  source_kind: SourceKind;
  source_app: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_sha256: string;
  status: ImportStatus;
  preset_id: string | null;
  template_id: string | null;
  config: unknown;
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

export type MerchantMapRow = Timestamps & {
  id: string;
  user_id: string;
  merchant_key: string;
  merchant_name: string | null;
  category_id: string;
  transaction_kind: TransactionKind | null;
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

export type LlmConfigRow = Timestamps & {
  id: string;
  user_id: string;
  task: LlmTask;
  enabled: boolean;
  provider: LlmProvider;
  model: string;
  endpoint_name: string | null;
  temperature: number;
  max_output_tokens: number;
  timeout_ms: number;
  allow_cloud_processing: boolean;
  last_tested_at: string | null;
  test_result: unknown;
};
