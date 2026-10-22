import "server-only";
import { getAdminClient, type Db } from "@/backend/supabase/clients";
import { PG_ERROR, TABLES } from "@/backend/constants/db.constants";
import type { TransactionKind } from "@/backend/constants/enums.constants";
import { AppError, unwrap } from "@/backend/errors/AppError";
import type { MapEntry } from "@/backend/domain/categoryMap";
import type { CategoryMapRow } from "./types";

/**
 * Keyword → category map. Reads use the caller's client (users may read their own rows and the
 * shared ones); writes go through the service role because users can't write this table directly.
 */
export class CategoryMapRepository {
  private readonly admin = getAdminClient();

  constructor(private readonly db: Db) {}

  async entriesFor(userId: string): Promise<MapEntry[]> {
    const rows = unwrap(
      await this.db
        .from(TABLES.CATEGORY_MAP)
        .select("keyword, category_name, transaction_kind, user_id")
        .or(`user_id.is.null,user_id.eq.${userId}`),
      "categoryMap.entriesFor",
    ) as Array<Pick<CategoryMapRow, "keyword" | "category_name" | "transaction_kind" | "user_id">>;
    return rows.map((r) => ({ keyword: r.keyword, categoryName: r.category_name, transactionKind: r.transaction_kind, userScoped: r.user_id === userId }));
  }

  /** Adds keywords learned by the LLM for everyone; an existing keyword is left as it is. */
  async learnShared(entries: Array<{ keyword: string; categoryName: string; transactionKind: TransactionKind | null }>): Promise<number> {
    let added = 0;
    for (const e of entries) {
      const { error } = await this.admin
        .from(TABLES.CATEGORY_MAP)
        .insert({ keyword: e.keyword, category_name: e.categoryName, transaction_kind: e.transactionKind, origin: "llm" });
      if (!error) added += 1;
      else if (error.code !== PG_ERROR.UNIQUE_VIOLATION) throw new AppError("INTERNAL", { internal: error });
    }
    return added;
  }

  /** Records a user's own choice for a keyword (replaces their earlier choice for it). */
  async learnForUser(userId: string, keyword: string, categoryName: string, transactionKind: TransactionKind | null): Promise<void> {
    const patch = { category_name: categoryName, transaction_kind: transactionKind };
    const updated = unwrap(
      await this.admin.from(TABLES.CATEGORY_MAP).update(patch).eq("user_id", userId).eq("keyword", keyword).select("id"),
      "categoryMap.updateUser",
    ) as unknown[];
    if (updated.length) return;
    const { error } = await this.admin.from(TABLES.CATEGORY_MAP).insert({ ...patch, user_id: userId, keyword, origin: "user" });
    if (error && error.code !== PG_ERROR.UNIQUE_VIOLATION) throw new AppError("INTERNAL", { internal: error });
  }
}
