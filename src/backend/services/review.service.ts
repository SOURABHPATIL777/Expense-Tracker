import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { invalidState, unwrapMaybe } from "@/backend/errors/AppError";
import { RPC } from "@/backend/constants/db.constants";
import { ReviewItemsRepository } from "@/backend/repositories/reviewItems.repository";
import { TransactionsRepository } from "@/backend/repositories/transactions.repository";
import { toReviewItemDto } from "@/backend/mappers/transactions.mapper";
import { pageMeta } from "./paginate";
import { recategorize } from "./categorization.service";
import type { PaginationQuery } from "@/shared/schemas/common";
import type { ResolveReviewInput } from "@/shared/schemas/review";
import type { ReviewItemKind } from "@/backend/constants/enums.constants";

/** Which resolutions make sense for each kind of review item. */
const ALLOWED: Record<ReviewItemKind, ReadonlyArray<ResolveReviewInput["action"]>> = {
  duplicate_candidate: ["keep_both", "merge", "dismiss"],
  low_confidence_category: ["accept", "recategorize", "dismiss"],
  transfer_confirmation: ["accept", "dismiss"],
  refund_match: ["accept", "dismiss"],
};

export function reviewService(db: Db) {
  const items = new ReviewItemsRepository(db);
  const transactions = new TransactionsRepository(db);

  async function markTransactionOk(userId: string, id: string | null) {
    if (!id) return;
    const stillOpen = await items.findOptional(userId, (q) => q.eq("status", "open").or(`transaction_id.eq.${id},related_transaction_id.eq.${id}`));
    if (!stillOpen) await transactions.updateMany(userId, [id], { review_status: "ok" });
  }

  return {
    async list(userId: string, page: PaginationQuery) {
      const { rows, total } = await items.list(userId, page, (q) => q.eq("status", "open"));
      const ids = [...new Set(rows.flatMap((r) => [r.transaction_id, r.related_transaction_id].filter((v): v is string => Boolean(v))))];
      const txs = ids.length ? await transactions.listAll(userId, (q) => q.in("id", ids)) : [];
      const byId = new Map(txs.map((t) => [t.id, t]));
      return { items: rows.map((r) => toReviewItemDto(r, byId)), meta: pageMeta(page, total) };
    },

    async openCount(userId: string): Promise<number> {
      return (await items.list(userId, { page: 1, pageSize: 1 }, (q) => q.eq("status", "open"))).total;
    },

    async resolve(userId: string, id: string, input: ResolveReviewInput): Promise<void> {
      const item = await items.findById(userId, id);
      if (item.status !== "open") throw invalidState("This item was already resolved.");
      if (!ALLOWED[item.kind].includes(input.action)) throw invalidState("That action doesn't apply to this item.");

      if (input.action === "merge") {
        // The newer transaction (the one flagged) folds into the one that already existed.
        unwrapMaybe(await db.rpc(RPC.MERGE_TRANSACTIONS, { p_keep: item.related_transaction_id, p_remove: item.transaction_id }), "review.merge");
        await markTransactionOk(userId, item.related_transaction_id);
        return;
      }
      if (input.action === "recategorize" && item.transaction_id) {
        await recategorize(db, userId, item.transaction_id, input.categoryId);
      }
      await items.update(userId, id, {
        status: input.action === "dismiss" ? "dismissed" : "resolved",
        resolution: input.action,
        resolved_at: new Date().toISOString(),
      });
      await markTransactionOk(userId, item.transaction_id);
      await markTransactionOk(userId, item.related_transaction_id);
    },
  };
}
