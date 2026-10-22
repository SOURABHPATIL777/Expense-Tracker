import "server-only";
import { TABLES } from "@/backend/constants/db.constants";
import { unwrapMaybe } from "@/backend/errors/AppError";
import { BaseRepository, type OrderBy } from "./BaseRepository";
import type { CategoryRow, MerchantMapRow, RuleRow } from "./types";

export class CategoriesRepository extends BaseRepository<CategoryRow> {
  protected readonly table = TABLES.CATEGORIES;
  protected readonly defaultOrder: OrderBy = { column: "name", ascending: true };
}

export class RulesRepository extends BaseRepository<RuleRow> {
  protected readonly table = TABLES.CATEGORIZATION_RULES;
  protected readonly defaultOrder: OrderBy = { column: "priority", ascending: true };

  listActive(userId: string) {
    return this.listAll(userId, (q) => q.eq("is_active", true));
  }
}

export class MerchantMapRepository extends BaseRepository<MerchantMapRow> {
  protected readonly table = TABLES.MERCHANT_MAP;

  async forKeys(userId: string, keys: string[]): Promise<Map<string, MerchantMapRow>> {
    if (keys.length === 0) return new Map();
    const rows = await this.listAll(userId, (q) => q.in("merchant_key", keys));
    return new Map(rows.map((r) => [r.merchant_key, r]));
  }

  /** Learns a user correction: this merchant always belongs in this category. */
  async learn(userId: string, values: Pick<MerchantMapRow, "merchant_key" | "merchant_name" | "category_id" | "transaction_kind">): Promise<void> {
    unwrapMaybe(
      await this.from().upsert({ ...values, user_id: userId }, { onConflict: "user_id,merchant_key" }),
      "merchantMap.learn",
    );
  }
}
