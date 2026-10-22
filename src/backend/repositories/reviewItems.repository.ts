import "server-only";
import { PG_ERROR, TABLES } from "@/backend/constants/db.constants";
import { fromDbError } from "@/backend/errors/AppError";
import { BaseRepository } from "./BaseRepository";
import type { ReviewItemRow } from "./types";

export type NewReviewItem = Pick<ReviewItemRow, "kind" | "transaction_id"> &
  Partial<Pick<ReviewItemRow, "related_transaction_id" | "raw_event_id" | "payload">>;

export class ReviewItemsRepository extends BaseRepository<ReviewItemRow> {
  protected readonly table = TABLES.REVIEW_ITEMS;

  /** Opens review items, skipping any that are already open for the same pair. Returns how many were created. */
  async openMany(userId: string, items: NewReviewItem[]): Promise<number> {
    let created = 0;
    for (const item of items) {
      const { error } = await this.from().insert({ ...item, user_id: userId, status: "open" });
      if (!error) created += 1;
      else if (error.code !== PG_ERROR.UNIQUE_VIOLATION) throw fromDbError(error, "reviewItems.openMany");
    }
    return created;
  }
}
