import "server-only";
import type { CategoryRow, RefundRow, ReviewItemRow, RuleRow, TransactionRow } from "@/backend/repositories/types";
import type { CategoryDto, CategoryInput, RuleDto, RuleInput } from "@/shared/schemas/categories";
import type { ReviewItemDto, TransactionSummaryDto } from "@/shared/schemas/review";
import type { TransactionDto } from "@/shared/schemas/transactions";
import type { RefundDto } from "@/shared/schemas/refunds";

export const toCategoryDto = (r: CategoryRow): CategoryDto => ({ id: r.id, name: r.name, kindHint: r.kind_hint, color: r.color, isSystem: r.is_system });

export const toCategoryRow = (i: Partial<CategoryInput>): Partial<CategoryRow> => ({
  ...(i.name !== undefined && { name: i.name }),
  ...(i.kindHint !== undefined && { kind_hint: i.kindHint }),
  ...("color" in i && { color: i.color ?? null }),
});

export const toRuleDto = (r: RuleRow): RuleDto => ({
  id: r.id,
  field: r.field,
  operator: r.operator,
  pattern: r.pattern,
  categoryId: r.category_id,
  transactionKind: r.transaction_kind,
  priority: r.priority,
  isActive: r.is_active,
});

export const toRuleRow = (i: Partial<RuleInput>): Partial<RuleRow> => ({
  ...(i.field !== undefined && { field: i.field }),
  ...(i.operator !== undefined && { operator: i.operator }),
  ...(i.pattern !== undefined && { pattern: i.pattern }),
  ...("categoryId" in i && { category_id: i.categoryId ?? null }),
  ...("transactionKind" in i && { transaction_kind: i.transactionKind ?? null }),
  ...(i.priority !== undefined && { priority: i.priority }),
  ...(i.isActive !== undefined && { is_active: i.isActive }),
});


export const toTransactionSummary = (t: TransactionRow): TransactionSummaryDto => ({
  id: t.id,
  occurredAt: t.occurred_at,
  amountMinor: t.amount_minor,
  direction: t.direction,
  status: t.status,
  kind: t.transaction_kind,
  merchant: t.merchant_normalized ?? t.merchant_raw,
  categoryId: t.category_id,
  referenceId: t.reference_id,
  sourceApp: t.source_app,
});

export const toReviewItemDto = (r: ReviewItemRow, txById: Map<string, TransactionRow>): ReviewItemDto => {
  const tx = (id: string | null) => (id && txById.has(id) ? toTransactionSummary(txById.get(id)!) : null);
  return { id: r.id, kind: r.kind, createdAt: r.created_at, transaction: tx(r.transaction_id), related: tx(r.related_transaction_id), payload: r.payload };
};

export const toTransactionDto = (t: TransactionRow): TransactionDto => ({
  ...toTransactionSummary(t),
  narration: t.narration,
  note: t.note,
  counterpartyVpa: t.counterparty_vpa,
  appTransactionId: t.app_transaction_id,
  paymentRail: t.payment_rail,
  categorySource: t.category_source,
  categoryConfidence: t.category_confidence === null ? null : Number(t.category_confidence),
  userLocked: t.user_locked,
  personalShareMinor: t.personal_share_minor,
  reconciliation: t.reconciliation,
  reviewStatus: t.review_status,
});

export function toRefundDto(r: RefundRow, txById: Map<string, TransactionRow>, today: string): RefundDto {
  const tx = (id: string | null) => (id && txById.has(id) ? toTransactionSummary(txById.get(id)!) : null);
  const waiting = r.status === "open" || r.status === "suggested";
  return {
    id: r.id,
    status: r.status,
    expectedAmountMinor: r.expected_amount_minor,
    expectedBy: r.expected_by,
    overdue: waiting && Boolean(r.expected_by && r.expected_by < today),
    orderRef: r.order_ref,
    note: r.note,
    createdAt: r.created_at,
    transaction: tx(r.transaction_id),
    match: tx(r.matched_transaction_id),
    suggestions: waiting ? r.suggested_transaction_ids.flatMap((id) => tx(id) ?? []) : [],
  };
}
