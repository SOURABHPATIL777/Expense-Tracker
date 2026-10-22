import "server-only";
import type { Db } from "@/backend/supabase/clients";
import type { Logger } from "@/backend/logger/logger";
import { unwrap } from "@/backend/errors/AppError";
import { JOBS } from "@/backend/constants/app.constants";
import { LLM_CONFIDENCE_THRESHOLD } from "@/backend/constants/llm.constants";
import type { TransactionKind } from "@/backend/constants/enums.constants";
import { TABLES } from "@/backend/constants/db.constants";
import { CategoriesRepository, RulesRepository } from "@/backend/repositories/categorization.repository";
import { CategoryMapRepository } from "@/backend/repositories/categoryMap.repository";
import { TransactionsRepository } from "@/backend/repositories/transactions.repository";
import { ReviewItemsRepository, type NewReviewItem } from "@/backend/repositories/reviewItems.repository";
import type { CategoryRow, RuleRow, TransactionRow } from "@/backend/repositories/types";
import { firstMatchingRule, type Rule } from "@/backend/domain/rules";
import { keywordAppearsIn, matchCategory, normalizeKeyword } from "@/backend/domain/categoryMap";
import { looksLikeIndividual } from "@/backend/domain/individual";
import { llmTaskEnabled, runLlmTask } from "@/backend/llm/run";
import { CATEGORIZE_INSTRUCTIONS, categorizeData, categorizeSchema } from "@/backend/llm/prompts/categorize";

/** Decided from the statement itself at import time; rules may override, the map and LLM may not. */
const DETERMINISTIC_KINDS = new Set<TransactionKind>(["self_transfer", "refund", "reversal", "cc_bill_payment"]);

/** Name of the default category for person-to-person payments (seeded for every user). */
export const INDIVIDUAL_CATEGORY = "Individual";

export type ClassifyScope = { scope: "import"; importId: string; cursor?: string } | { scope: "all"; cursor?: string };

type Patch = Partial<Pick<TransactionRow, "category_id" | "category_source" | "category_confidence" | "transaction_kind" | "review_status">>;

const toRule = (r: RuleRow): Rule => ({
  id: r.id,
  field: r.field,
  operator: r.operator,
  pattern: r.pattern,
  categoryId: r.category_id,
  transactionKind: r.transaction_kind,
  priority: r.priority,
});

/** The text a keyword can match: merchant, raw merchant, narration and UPI handle. */
export const matchTexts = (t: Pick<TransactionRow, "merchant_normalized" | "merchant_raw" | "narration" | "counterparty_vpa">) => [
  t.merchant_normalized,
  t.merchant_raw,
  t.narration,
  t.counterparty_vpa,
];

/** Debits default to spending; credits stay `unknown` (a friend repaying is not income) until decided. */
const defaultKind = (t: TransactionRow): TransactionKind =>
  t.transaction_kind !== "unknown" ? t.transaction_kind : t.direction === "debit" ? "expense" : "unknown";

/** A category's kind hint applies only when it agrees with the money's direction. */
function kindFor(t: TransactionRow, category: CategoryRow | undefined, explicit?: TransactionKind | null): TransactionKind {
  if (explicit) return explicit;
  if (DETERMINISTIC_KINDS.has(t.transaction_kind)) return t.transaction_kind;
  const hint = category?.kind_hint;
  if (!hint || (hint === "expense" && t.direction === "credit") || (hint === "income" && t.direction === "debit")) return defaultKind(t);
  return hint;
}

/**
 * Classification order for every unlocked transaction:
 *   your rules → own transfers/refunds/card bills from the statement → category map (your own
 *   choices first, then the longest shared keyword) → person-to-person ("Individual") → LLM.
 * The LLM only sees what's still uncategorised, and each keyword it uses (verified to be in the
 * text) is saved to the shared map so the next occurrence needs no LLM call.
 */
export function classificationService(db: Db, log: Logger) {
  const transactions = new TransactionsRepository(db);
  const categoriesRepo = new CategoriesRepository(db);
  const rulesRepo = new RulesRepository(db);
  const categoryMap = new CategoryMapRepository(db);
  const reviews = new ReviewItemsRepository(db);

  /** Next keyset page of transactions to classify for a scope. */
  async function nextBatch(userId: string, s: ClassifyScope): Promise<{ rows: TransactionRow[]; cursor: string | null }> {
    const limit = JOBS.CLASSIFY_PER_STEP;
    let ids: string[];
    if (s.scope === "import") {
      let q = db.from(TABLES.TRANSACTION_SOURCES).select("transaction_id").eq("user_id", userId).eq("import_id", s.importId);
      if (s.cursor) q = q.gt("transaction_id", s.cursor);
      ids = (unwrap(await q.order("transaction_id").limit(limit), "classify.importIds") as Array<{ transaction_id: string }>).map((r) => r.transaction_id);
    } else {
      let q = db.from(TABLES.TRANSACTIONS).select("id").eq("user_id", userId).eq("user_locked", false);
      if (s.cursor) q = q.gt("id", s.cursor);
      ids = (unwrap(await q.order("id").limit(limit), "classify.allIds") as Array<{ id: string }>).map((r) => r.id);
    }
    if (ids.length === 0) return { rows: [], cursor: null };
    const rows = await transactions.listAll(userId, (q) => {
      const base = q.in("id", ids).eq("user_locked", false);
      // An import pass only fills gaps; a full pass (after rule changes) redoes everything the user didn't set.
      return s.scope === "import" ? base.is("category_id", null) : base.or("category_source.is.null,category_source.neq.user");
    });
    return { rows, cursor: ids.length === limit ? ids.at(-1)! : null };
  }

  async function llmPass(userId: string, pending: TransactionRow[], categories: CategoryRow[], patches: Map<string, Patch>, reviewItems: NewReviewItem[]) {
    if (!llmTaskEnabled("categorize") || categories.length === 0) return;
    const names = categories.map((c) => c.name);
    const schema = categorizeSchema(names as [string, ...string[]]);
    const byName = new Map(categories.map((c) => [c.name, c]));
    const individual = byName.get(INDIVIDUAL_CATEGORY);
    const learned = new Map<string, { keyword: string; categoryName: string; transactionKind: TransactionKind | null }>();

    for (let i = 0; i < pending.length; i += JOBS.LLM_BATCH_SIZE) {
      const batch = pending.slice(i, i + JOBS.LLM_BATCH_SIZE);
      const out = await runLlmTask({
        userId,
        task: "categorize",
        schema,
        instructions: CATEGORIZE_INSTRUCTIONS,
        data: categorizeData(
          names,
          batch.map((t, index) => ({
            index,
            direction: t.direction,
            amountRupees: t.amount_minor / 100,
            merchant: t.merchant_normalized ?? t.merchant_raw,
            upiHandle: t.counterparty_vpa,
            narration: t.narration,
          })),
        ),
      });
      for (const item of out.items) {
        const t = batch[item.index];
        if (!t) continue; // the model referenced an index we never sent
        const category = item.isIndividual ? individual : item.category ? byName.get(item.category) : undefined;
        const lowConfidence = item.confidence < LLM_CONFIDENCE_THRESHOLD;
        const explicitKind = item.kind === "unknown" || item.isIndividual ? null : item.kind;
        patches.set(t.id, {
          category_id: category?.id ?? null,
          category_source: category ? "llm" : null,
          category_confidence: item.confidence,
          transaction_kind: kindFor(t, category, explicitKind),
          review_status: lowConfidence ? "needs_review" : t.review_status,
        });
        if (lowConfidence) {
          reviewItems.push({ kind: "low_confidence_category", transaction_id: t.id, payload: { suggestedCategoryId: category?.id ?? null, confidence: item.confidence } });
          continue;
        }
        // Only a confident, business keyword that really appears in the text is shared with everyone.
        const keyword = normalizeKeyword(item.keyword);
        if (!item.isIndividual && category && keyword && keywordAppearsIn(matchTexts(t), keyword)) {
          learned.set(keyword, { keyword, categoryName: category.name, transactionKind: explicitKind });
        }
      }
    }
    if (learned.size) log.info({ added: await categoryMap.learnShared([...learned.values()]) }, "category keywords learned");
  }

  /** Classifies one batch; returns the cursor for the next batch, or null when the scope is done. */
  async function classifyStep(userId: string, scope: ClassifyScope): Promise<string | null> {
    const { rows, cursor } = await nextBatch(userId, scope);
    if (rows.length === 0) return cursor;

    const [categories, rules, entries] = await Promise.all([categoriesRepo.listAll(userId), rulesRepo.listActive(userId), categoryMap.entriesFor(userId)]);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
    const individual = categoryByName.get(INDIVIDUAL_CATEGORY.toLowerCase());
    const domainRules = rules.map(toRule);

    const patches = new Map<string, Patch>();
    const pendingLlm: TransactionRow[] = [];
    for (const t of rows) {
      const rule = firstMatchingRule({ merchant: t.merchant_normalized ?? t.merchant_raw, vpa: t.counterparty_vpa, narration: t.narration }, domainRules);
      if (rule) {
        const categoryId = rule.categoryId ?? t.category_id;
        patches.set(t.id, { category_id: categoryId, category_source: "rule", category_confidence: 1, transaction_kind: kindFor(t, categoryById.get(categoryId ?? ""), rule.transactionKind) });
        continue;
      }
      if (DETERMINISTIC_KINDS.has(t.transaction_kind) || t.status !== "success") continue;

      const mapped = matchCategory(matchTexts(t), entries);
      const mappedCategory = mapped ? categoryByName.get(mapped.categoryName.toLowerCase()) : undefined;
      if (mapped && mappedCategory) {
        patches.set(t.id, {
          category_id: mappedCategory.id,
          category_source: "merchant_map",
          category_confidence: 1,
          transaction_kind: kindFor(t, mappedCategory, mapped.transactionKind),
        });
        continue;
      }
      if (individual && looksLikeIndividual({ merchant: t.merchant_normalized ?? t.merchant_raw, vpa: t.counterparty_vpa, narration: t.narration })) {
        patches.set(t.id, { category_id: individual.id, category_source: "system", category_confidence: 1, transaction_kind: defaultKind(t) });
        continue;
      }
      patches.set(t.id, { transaction_kind: defaultKind(t) });
      pendingLlm.push(t);
    }

    const reviewItems: NewReviewItem[] = [];
    // Deterministic results are saved first so an LLM outage never loses them (the job retries the rest).
    await savePatches(userId, patches);
    patches.clear();
    if (pendingLlm.length) {
      await llmPass(userId, pendingLlm, categories, patches, reviewItems);
      await savePatches(userId, patches);
      await reviews.openMany(userId, reviewItems);
    }
    log.info({ classified: rows.length, llm: pendingLlm.length, review: reviewItems.length }, "classification step");
    return cursor;
  }

  async function savePatches(userId: string, patches: Map<string, Patch>) {
    for (const [id, patch] of patches) await transactions.update(userId, id, patch);
  }

  return { classifyStep };
}
