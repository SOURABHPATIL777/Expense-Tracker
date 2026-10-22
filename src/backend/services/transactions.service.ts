import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { unwrap } from "@/backend/errors/AppError";
import { AUDIT_ACTIONS } from "@/backend/constants/enums.constants";
import { TABLES } from "@/backend/constants/db.constants";
import { TransactionsRepository } from "@/backend/repositories/transactions.repository";
import { RefundsRepository } from "@/backend/repositories/refunds.repository";
import { SharedExpensesRepository } from "@/backend/repositories/splits.repository";
import type { Query } from "@/backend/repositories/BaseRepository";
import { toTransactionDto } from "@/backend/mappers/transactions.mapper";
import { istDateRange } from "@/backend/domain/period";
import { pageMeta } from "./paginate";
import { audit } from "./auditLog";
import { recategorize } from "./categorization.service";
import { spreadManualEdit } from "./counterpartyRules.service";
import type { SourceKind } from "@/shared/constants/enums";
import type { TransactionDetailDto, TransactionListQuery, UpdateTransactionInput } from "@/shared/schemas/transactions";

/** Applies list filters; `search` is pre-sanitised by its schema so it is safe inside the `or` filter. */
function applyFilters(q: Query, f: TransactionListQuery): Query {
  let out = q;
  if (f.from || f.to) {
    const { fromIso, toIso } = istDateRange(f.from ?? "2000-01-01", f.to ?? "2100-12-31");
    out = out.gte("occurred_at", fromIso).lt("occurred_at", toIso);
  }
  if (f.direction) out = out.eq("direction", f.direction);
  if (f.kind) out = out.eq("transaction_kind", f.kind);
  if (f.status) out = out.eq("status", f.status);
  if (f.sourceApp) out = out.eq("source_app", f.sourceApp);
  if (f.review) out = out.eq("review_status", "needs_review");
  if (f.categoryId === "none") out = out.is("category_id", null);
  else if (f.categoryId) out = out.eq("category_id", f.categoryId);
  if (f.search) {
    const s = `%${f.search}%`;
    out = out.or(`merchant_normalized.ilike.${s},merchant_raw.ilike.${s},narration.ilike.${s},counterparty_vpa.ilike.${s},reference_id.ilike.${s}`);
  }
  return out;
}

export function transactionsService(db: Db) {
  const repo = new TransactionsRepository(db);

  return {
    async list(userId: string, query: TransactionListQuery) {
      const { rows, total } = await repo.list(userId, query, (q) => applyFilters(q, query));
      return { items: rows.map(toTransactionDto), meta: pageMeta(query, total) };
    },

    async get(userId: string, id: string): Promise<TransactionDetailDto> {
      const tx = await repo.findById(userId, id);
      const sources = unwrap(
        await db
          .from(TABLES.TRANSACTION_SOURCES)
          .select("import_id, source_kind, source_app, created_at, imports(file_name)")
          .eq("user_id", userId)
          .eq("transaction_id", id)
          .order("created_at"),
        "transactions.sources",
      ) as unknown as Array<{ import_id: string; source_kind: SourceKind; source_app: string; created_at: string; imports: { file_name: string } | null }>;
      const [refund, split] = await Promise.all([
        new RefundsRepository(db).findActiveForTransaction(userId, id),
        new SharedExpensesRepository(db).findOptional(userId, (q) => q.eq("transaction_id", id).neq("status", "cancelled")),
      ]);
      return {
        ...toTransactionDto(tx),
        sources: sources.map((s) => ({ importId: s.import_id, fileName: s.imports?.file_name ?? null, sourceKind: s.source_kind, sourceApp: s.source_app, addedAt: s.created_at })),
        openRefundId: refund?.id ?? null,
        splitId: split?.id ?? null,
      };
    },

    /** Any manual edit locks the transaction so rules and AI never overwrite it. */
    async update(userId: string, id: string, input: UpdateTransactionInput): Promise<TransactionDetailDto> {
      if (input.categoryId) {
        await recategorize(db, userId, id, input.categoryId, input.transactionKind);
      }
      const manual = !input.categoryId && (input.categoryId === null || input.transactionKind !== undefined);
      const patch = {
        ...(input.categoryId === null && { category_id: null, category_source: "user" as const, category_confidence: null }),
        ...(!input.categoryId && input.transactionKind && { transaction_kind: input.transactionKind }),
        ...(manual && { user_locked: true, review_status: "ok" as const }),
        ...(input.note !== undefined && { note: input.note }),
        ...(input.userLocked !== undefined && { user_locked: input.userLocked }),
      };
      if (Object.keys(patch).length > 0) await repo.update(userId, id, patch);
      // The same UPI ID / account in the same direction follows this edit, now and in future imports.
      const alsoUpdated = await spreadManualEdit(db, userId, id, { categoryId: input.categoryId, kind: input.transactionKind });
      await audit(db, { userId, action: AUDIT_ACTIONS.TRANSACTION_UPDATED, entityType: "transaction", entityId: id, metadata: { fields: Object.keys(input), alsoUpdated } });
      return { ...(await this.get(userId, id)), alsoUpdated };
    },
  };
}
