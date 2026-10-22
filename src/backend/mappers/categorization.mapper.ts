import "server-only";
import type { CategoryRow, LlmConfigRow, ReviewItemRow, RuleRow, TransactionRow } from "@/backend/repositories/types";
import type { CategoryDto, CategoryInput, RuleDto, RuleInput } from "@/shared/schemas/categories";
import type { LlmConfigDto, LlmTestResultDto } from "@/shared/schemas/llm";
import type { ReviewItemDto, TransactionSummaryDto } from "@/shared/schemas/review";

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

export const toLlmConfigDto = (r: LlmConfigRow): LlmConfigDto => ({
  task: r.task,
  enabled: r.enabled,
  provider: r.provider,
  model: r.model,
  endpointName: r.endpoint_name,
  temperature: Number(r.temperature),
  maxOutputTokens: r.max_output_tokens,
  timeoutMs: r.timeout_ms,
  allowCloudProcessing: r.allow_cloud_processing,
  lastTestedAt: r.last_tested_at,
  lastTest: (r.test_result as LlmTestResultDto | null) ?? null,
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
