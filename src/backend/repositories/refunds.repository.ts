import "server-only";
import { TABLES } from "@/backend/constants/db.constants";
import { BaseRepository } from "./BaseRepository";
import type { RefundRow } from "./types";

export class RefundsRepository extends BaseRepository<RefundRow> {
  protected readonly table = TABLES.REFUND_EXPECTATIONS;

  /** Refunds still waiting for money (open or with suggestions). */
  listWaiting(userId: string) {
    return this.listAll(userId, (q) => q.in("status", ["open", "suggested"]));
  }

  findActiveForTransaction(userId: string, transactionId: string) {
    return this.findOptional(userId, (q) => q.eq("transaction_id", transactionId).neq("status", "closed"));
  }

  /** Credits already confirmed as some refund; never suggested again. */
  async matchedCreditIds(userId: string): Promise<Set<string>> {
    const rows = await this.listAll(userId, (q) => q.not("matched_transaction_id", "is", null));
    return new Set(rows.map((r) => r.matched_transaction_id!));
  }
}
