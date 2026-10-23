import "server-only";
import { PG_ERROR, TABLES } from "@/backend/constants/db.constants";
import { AppError, fromDbError, unwrap, unwrapMaybe } from "@/backend/errors/AppError";
import type { Direction } from "@/backend/constants/enums.constants";
import { BaseRepository, type OrderBy } from "./BaseRepository";
import type { TransactionRow, TransactionSourceRow } from "./types";
import { inBatches } from "./inBatches";

export type CandidateQuery = { references: string[]; amounts: number[]; from: string; to: string; direction?: Direction };

export class TransactionsRepository extends BaseRepository<TransactionRow> {
  protected readonly table = TABLES.TRANSACTIONS;
  protected readonly defaultOrder: OrderBy = { column: "occurred_at", ascending: false };

  /** Existing transactions that could be the same money movement as a batch of incoming events. */
  async findCandidates(userId: string, q: CandidateQuery): Promise<TransactionRow[]> {
    // One query per URL-safe chunk: a 500-row import step would otherwise exceed the URL limit.
    const byRef = await inBatches(q.references, (refs) => this.listAll(userId, (b) => b.in("reference_id", refs)));
    const byAmount = await inBatches(q.amounts, (amounts) =>
      this.listAll(userId, (b) => {
        let query = b.in("amount_minor", amounts).gte("occurred_at", q.from).lte("occurred_at", q.to);
        if (q.direction) query = query.eq("direction", q.direction);
        return query;
      }),
    );
    const all = new Map<string, TransactionRow>();
    for (const row of [...byRef, ...byAmount]) all.set(row.id, row);
    return [...all.values()];
  }

  /**
   * Bulk insert. Returns `false` (and inserts nothing) on a unique-reference conflict so the caller
   * can retry row by row; any other failure throws.
   */
  async tryInsertMany(userId: string, rows: Array<Partial<TransactionRow>>): Promise<boolean> {
    if (rows.length === 0) return true;
    const { error } = await this.from().insert(rows.map((r) => ({ ...r, user_id: userId })));
    if (!error) return true;
    if (error.code === PG_ERROR.UNIQUE_VIOLATION) return false;
    throw fromDbError(error, "transactions.tryInsertMany");
  }

  async findByReference(userId: string, referenceId: string, direction: Direction): Promise<TransactionRow | null> {
    return this.findOptional(userId, (q) => q.eq("reference_id", referenceId).eq("direction", direction));
  }

  async updateMany(userId: string, ids: string[], patch: Partial<TransactionRow>): Promise<void> {
    await inBatches(ids, async (chunk) => {
      unwrapMaybe(await this.from().update(patch).eq("user_id", userId).in("id", chunk), "transactions.updateMany");
      return [];
    });
  }
}

export class TransactionSourcesRepository extends BaseRepository<TransactionSourceRow> {
  protected readonly table = TABLES.TRANSACTION_SOURCES;

  async insertManyRows(userId: string, rows: Array<Omit<TransactionSourceRow, "id" | "user_id" | "created_at">>): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.from().upsert(
      rows.map((r) => ({ ...r, user_id: userId })),
      { onConflict: "raw_event_id", ignoreDuplicates: true },
    );
    if (error) throw new AppError("INTERNAL", { internal: error });
  }

  async sourceKindsFor(userId: string, transactionIds: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    const rows = await inBatches(
      transactionIds,
      async (chunk) =>
        unwrap(await this.from().select("transaction_id, source_kind").eq("user_id", userId).in("transaction_id", chunk), "transactionSources.kinds") as Array<{
          transaction_id: string;
          source_kind: string;
        }>,
    );
    for (const r of rows) out.set(r.transaction_id, (out.get(r.transaction_id) ?? new Set()).add(r.source_kind));
    return out;
  }
}
