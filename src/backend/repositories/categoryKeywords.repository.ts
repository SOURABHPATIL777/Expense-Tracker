import "server-only";
import { getAdminClient, type Db } from "@/backend/supabase/clients";
import { PG_ERROR, TABLES } from "@/backend/constants/db.constants";
import type { TransactionKind } from "@/backend/constants/enums.constants";
import { AppError, unwrap } from "@/backend/errors/AppError";
import type { MapEntry } from "@/backend/domain/categoryMap";
import type { CategoryKeywordOrigin, CategoryKeywordRow } from "./types";

const catalogIds = new Map<string, string>();

/**
 * Keyword → category (category_map_keyword). Reads use the caller's client (users may read their
 * own rows and the shared ones); writes go through the service role because users can't write
 * this table directly. Developers may also add shared rows by hand (see the migration).
 */
export class CategoryKeywordsRepository {
  private readonly admin = getAdminClient();

  constructor(private readonly db: Db) {}

  /** Id of a catalog category by name (catalog ids never change, so it is cached). */
  async catalogId(name: string): Promise<string | null> {
    const key = name.toLowerCase();
    if (!catalogIds.has(key)) {
      const rows = unwrap(
        await this.admin.from(TABLES.DEFAULT_CATEGORIES).select("id").ilike("name", name).limit(1),
        "categoryKeywords.catalogId",
      ) as Array<{ id: string }>;
      if (!rows[0]) return null;
      catalogIds.set(key, rows[0].id);
    }
    return catalogIds.get(key)!;
  }

  async entriesFor(userId: string): Promise<MapEntry[]> {
    const rows = unwrap(
      await this.db
        .from(TABLES.CATEGORY_MAP_KEYWORD)
        .select("keyword, default_category_id, category_id, transaction_kind, user_id")
        .or(`user_id.is.null,user_id.eq.${userId}`),
      "categoryKeywords.entriesFor",
    ) as Array<Pick<CategoryKeywordRow, "keyword" | "default_category_id" | "category_id" | "transaction_kind" | "user_id">>;
    return rows.map((r) => ({
      keyword: r.keyword,
      categoryId: r.category_id,
      defaultCategoryId: r.default_category_id,
      transactionKind: r.transaction_kind,
      userScoped: r.user_id === userId,
    }));
  }

  /** Adds keywords learned by the LLM for everyone; an existing keyword is left as it is. */
  async learnShared(entries: Array<{ keyword: string; defaultCategoryId: string; transactionKind: TransactionKind | null }>): Promise<number> {
    let added = 0;
    for (const e of entries) {
      const { error } = await this.admin
        .from(TABLES.CATEGORY_MAP_KEYWORD)
        .insert({ keyword: e.keyword, default_category_id: e.defaultCategoryId, transaction_kind: e.transactionKind, origin: "llm" });
      if (!error) added += 1;
      else if (error.code !== PG_ERROR.UNIQUE_VIOLATION) throw new AppError("INTERNAL", { internal: error });
    }
    return added;
  }

  /** Records a keyword for one user's own category (replaces their earlier choice for it). */
  async learnForUser(userId: string, keyword: string, categoryId: string, transactionKind: TransactionKind | null, origin: CategoryKeywordOrigin): Promise<void> {
    const patch = { category_id: categoryId, transaction_kind: transactionKind, origin };
    const updated = unwrap(
      await this.admin.from(TABLES.CATEGORY_MAP_KEYWORD).update(patch).eq("user_id", userId).eq("keyword", keyword).select("id"),
      "categoryKeywords.updateUser",
    ) as unknown[];
    if (updated.length) return;
    const { error } = await this.admin.from(TABLES.CATEGORY_MAP_KEYWORD).insert({ ...patch, user_id: userId, keyword });
    if (error && error.code !== PG_ERROR.UNIQUE_VIOLATION) throw new AppError("INTERNAL", { internal: error });
  }
}
