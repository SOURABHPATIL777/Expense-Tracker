import "server-only";
import { TABLES } from "@/backend/constants/db.constants";
import { unwrapMaybe } from "@/backend/errors/AppError";
import { BaseRepository, type OrderBy } from "./BaseRepository";
import type { AccountRow } from "./types";

export class AccountsRepository extends BaseRepository<AccountRow> {
  protected readonly table = TABLES.FINANCIAL_ACCOUNTS;
  protected readonly defaultOrder: OrderBy = { column: "created_at", ascending: true };

  async clearPrimary(userId: string, exceptId?: string): Promise<void> {
    let q = this.from().update({ is_primary: false }).eq("user_id", userId).eq("is_primary", true);
    if (exceptId) q = q.neq("id", exceptId);
    unwrapMaybe(await q, "accounts.clearPrimary");
  }

  /** All UPI IDs the user owns, lower-cased, for own-transfer detection. */
  async ownVpas(userId: string): Promise<Set<string>> {
    const rows = await this.listAll(userId);
    return new Set(rows.flatMap((r) => r.upi_ids.map((v) => v.toLowerCase())));
  }
}
