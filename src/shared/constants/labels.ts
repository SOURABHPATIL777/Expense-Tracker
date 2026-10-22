import type {
  ClaimStatus,
  Direction,
  ImportStatus,
  ParticipantResponse,
  RefundStatus,
  ReviewItemKind,
  RuleField,
  RuleOperator,
  SharedExpenseStatus,
  SourceApp,
  TransactionKind,
  TransactionStatus,
} from "./enums";

// Display labels and badge tones for enum values. StatusBadge renders from these maps only.

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export type LabelMap<T extends string> = Record<T, { label: string; tone: Tone }>;

export const TRANSACTION_KIND_LABELS: LabelMap<TransactionKind> = {
  expense: { label: "Expense", tone: "neutral" },
  income: { label: "Income", tone: "success" },
  self_transfer: { label: "Own transfer", tone: "info" },
  refund: { label: "Refund", tone: "success" },
  reversal: { label: "Reversal", tone: "success" },
  reimbursable: { label: "Reimbursable", tone: "warning" },
  cc_bill_payment: { label: "Card bill", tone: "info" },
  unknown: { label: "Unclassified", tone: "warning" },
};

export const TRANSACTION_STATUS_LABELS: LabelMap<TransactionStatus> = {
  success: { label: "Success", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  reversed: { label: "Reversed", tone: "info" },
};

export const IMPORT_STATUS_LABELS: LabelMap<ImportStatus> = {
  uploaded: { label: "Uploaded", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  parsing: { label: "Reading file", tone: "info" },
  needs_mapping: { label: "Map columns", tone: "warning" },
  needs_password: { label: "Password needed", tone: "warning" },
  processing: { label: "Processing", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const REVIEW_ITEM_KIND_LABELS: LabelMap<ReviewItemKind> = {
  duplicate_candidate: { label: "Possible duplicate", tone: "warning" },
  low_confidence_category: { label: "Check category", tone: "info" },
  transfer_confirmation: { label: "Transfer?", tone: "info" },
  refund_match: { label: "Refund match", tone: "success" },
};

export const REFUND_STATUS_LABELS: LabelMap<RefundStatus> = {
  open: { label: "Waiting", tone: "warning" },
  suggested: { label: "Possible match", tone: "info" },
  matched: { label: "Received", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

export const SHARED_EXPENSE_STATUS_LABELS: LabelMap<SharedExpenseStatus> = {
  open: { label: "Open", tone: "info" },
  closed: { label: "Settled", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const PARTICIPANT_RESPONSE_LABELS: LabelMap<ParticipantResponse> = {
  pending: { label: "Not responded", tone: "neutral" },
  agreed: { label: "Agreed", tone: "success" },
  questioned: { label: "Questioned", tone: "warning" },
};

export const CLAIM_STATUS_LABELS: LabelMap<ClaimStatus> = {
  reported: { label: "Reported paid", tone: "info" },
  confirmed: { label: "Received", tone: "success" },
  rejected: { label: "Not received", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export const SOURCE_APP_LABELS: Record<SourceApp, string> = {
  phonepe: "PhonePe",
  gpay: "Google Pay",
  paytm: "Paytm",
  other_upi: "Other UPI app",
  hdfc: "HDFC Bank",
  icici: "ICICI Bank",
  sbi: "State Bank of India",
  pnb: "Punjab National Bank",
  bob: "Bank of Baroda",
  canara: "Canara Bank",
  union: "Union Bank of India",
  boi: "Bank of India",
  indian: "Indian Bank",
  central: "Central Bank of India",
  iob: "Indian Overseas Bank",
  uco: "UCO Bank",
  bom: "Bank of Maharashtra",
  psb: "Punjab & Sind Bank",
  other_bank: "Other bank",
};



export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  merchant: "Merchant name",
  vpa: "UPI ID",
  narration: "Statement description",
};

/** For rules: which money a rule applies to. */
export const RULE_DIRECTION_LABELS: Record<Direction, string> = {
  debit: "Money out",
  credit: "Money in",
};

export const RULE_OPERATOR_LABELS: Record<RuleOperator, string> = {
  contains: "contains",
  equals: "is exactly",
  starts_with: "starts with",
};
