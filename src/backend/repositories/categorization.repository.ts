import "server-only";
import { TABLES } from "@/backend/constants/db.constants";
import { BaseRepository, type OrderBy } from "./BaseRepository";
import type { CategoryRow, RuleRow } from "./types";

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

