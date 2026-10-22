import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminClient, type Db } from "@/backend/supabase/clients";
import { CategoriesRepository, RulesRepository } from "@/backend/repositories/categorization.repository";
import { CategoryMapRepository } from "@/backend/repositories/categoryMap.repository";
import { TransactionsRepository } from "@/backend/repositories/transactions.repository";
import { toCategoryDto, toCategoryRow, toRuleDto, toRuleRow } from "@/backend/mappers/transactions.mapper";
import { matchCategory, normalizeKeyword } from "@/backend/domain/categoryMap";
import { looksLikeIndividual } from "@/backend/domain/individual";
import { matchTexts } from "./classification.service";
import { enqueueJob } from "@/backend/jobs/queue";
import { kickWorker } from "@/backend/jobs/worker";
import type { TransactionKind } from "@/backend/constants/enums.constants";
import type { CategoryDto, CategoryInput, RuleDto, RuleInput } from "@/shared/schemas/categories";

export function categoriesService(db: Db) {
  const repo = new CategoriesRepository(db);
  return {
    list: async (userId: string): Promise<CategoryDto[]> => (await repo.listAll(userId)).map(toCategoryDto),
    create: async (userId: string, input: CategoryInput) => toCategoryDto(await repo.insert(userId, toCategoryRow(input))),
    update: async (userId: string, id: string, input: Partial<CategoryInput>) => toCategoryDto(await repo.update(userId, id, toCategoryRow(input))),
    /** Transactions keep existing; they simply become uncategorised (FK is ON DELETE SET NULL). */
    remove: (userId: string, id: string) => repo.remove(userId, id),
  };
}

/** Re-runs rules + learned merchants over every transaction the user hasn't set by hand. */
export async function reclassifyAll(userId: string): Promise<void> {
  await enqueueJob(getAdminClient(), { type: "classify_transactions", userId, payload: { scope: "all" }, idempotencyKey: `classify:all:${randomUUID()}` });
  kickWorker();
}

export function rulesService(db: Db) {
  const repo = new RulesRepository(db);
  const assertCategory = async (userId: string, categoryId?: string) => {
    if (categoryId) await new CategoriesRepository(db).findById(userId, categoryId);
  };
  return {
    list: async (userId: string): Promise<RuleDto[]> => (await repo.listAll(userId)).map(toRuleDto),
    async create(userId: string, input: RuleInput) {
      await assertCategory(userId, input.categoryId);
      return toRuleDto(await repo.insert(userId, toRuleRow(input)));
    },
    async update(userId: string, id: string, input: Partial<RuleInput>) {
      await assertCategory(userId, input.categoryId);
      return toRuleDto(await repo.update(userId, id, toRuleRow(input)));
    },
    remove: (userId: string, id: string) => repo.remove(userId, id),
    apply: reclassifyAll,
  };
}

/**
 * A user's manual category choice: locks the transaction against rules/AI and records the choice
 * in the user's own category map, so the same merchant is categorised this way from now on.
 * Payments to people are not mapped (a person isn't a merchant); a rule handles a specific person.
 */
export async function recategorize(db: Db, userId: string, transactionId: string, categoryId: string, kind?: TransactionKind): Promise<void> {
  const category = await new CategoriesRepository(db).findById(userId, categoryId);
  const txRepo = new TransactionsRepository(db);
  const tx = await txRepo.findById(userId, transactionId);
  const resolvedKind = kind ?? (category.kind_hint === "expense" && tx.direction === "credit" ? tx.transaction_kind : category.kind_hint);
  await txRepo.update(userId, transactionId, {
    category_id: category.id,
    category_source: "user",
    category_confidence: 1,
    transaction_kind: resolvedKind,
    user_locked: true,
    review_status: "ok",
  });

  if (looksLikeIndividual({ merchant: tx.merchant_normalized ?? tx.merchant_raw, vpa: tx.counterparty_vpa, narration: tx.narration })) return;
  const map = new CategoryMapRepository(db);
  // Reuse the keyword that identified this merchant; otherwise learn its name.
  const matched = matchCategory(matchTexts(tx), await map.entriesFor(userId));
  const keyword = matched?.keyword ?? normalizeKeyword(tx.merchant_normalized ?? tx.merchant_raw);
  if (keyword) await map.learnForUser(userId, keyword, category.name, kind ?? null);
}
