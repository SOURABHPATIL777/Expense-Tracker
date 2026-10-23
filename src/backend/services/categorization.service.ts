import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminClient, type Db } from "@/backend/supabase/clients";
import { CategoriesRepository, RulesRepository } from "@/backend/repositories/categorization.repository";
import { CategoryKeywordsRepository } from "@/backend/repositories/categoryKeywords.repository";
import { TransactionsRepository } from "@/backend/repositories/transactions.repository";
import { toCategoryDto, toCategoryRow, toRuleDto, toRuleRow } from "@/backend/mappers/transactions.mapper";
import { isBankKeyword, matchCategory, normalizeKeyword } from "@/backend/domain/categoryMap";
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

/**
 * Re-runs rules + learned merchants over every transaction the user hasn't set by hand.
 * `rulesOnly` skips the AI for transactions nothing matches (after a single edit).
 */
export async function reclassifyAll(userId: string, opts: { rulesOnly?: boolean } = {}): Promise<void> {
  await enqueueJob(getAdminClient(), {
    type: "classify_transactions",
    userId,
    payload: { scope: "all", ...(opts.rulesOnly && { rulesOnly: true }) },
    idempotencyKey: `classify:all:${randomUUID()}`,
  });
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
 * as one of the user's own category keywords, so the same merchant is categorised this way from now on.
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
  const keywords = new CategoryKeywordsRepository(db);
  // Reuse the keyword that identified this merchant; otherwise learn its name. Never the narration
  // ("…salary june 2026" would match nothing else) and never a bank's name.
  const matched = matchCategory(matchTexts(tx), await keywords.entriesFor(userId));
  const keyword = matched?.keyword ?? normalizeKeyword(tx.merchant_normalized);
  if (keyword && !isBankKeyword(keyword)) await keywords.learnForUser(userId, keyword, category.id, kind ?? null, "user");
}
