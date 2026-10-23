import "server-only";
import { PG_ERROR, TABLES } from "@/backend/constants/db.constants";
import { AppError, fromDbError, unwrap, unwrapMaybe } from "@/backend/errors/AppError";
import type { Direction } from "@/backend/constants/enums.constants";
import { BaseRepository, type OrderBy } from "./BaseRepository";
import type { TransactionRow, TransactionSourceRow } from "./types";
import { inBatches } from "./inBatches";

export type CandidateQuery = { references: string[]; amounts: number[]; from: string; to: string; direction?: Direction };

/** A transaction with the statements it was seen in (kind, app, import and the row's parsed data). */
export type CandidateRow = TransactionRow & {
  transaction_sources: Array<{ source_kind: string; source_app: string; import_id: string; raw_events: { parsed: { balanceMinor?: number | null } | null } | null }>;
};

const CANDIDATE_COLUMNS = "*, transaction_sources(source_kind, source_app, import_id, raw_events(parsed))";

export class TransactionsRepository extends BaseRepository<TransactionRow> {
  protected readonly table = TABLES.TRANSACTIONS;
  protected readonly defaultOrder: OrderBy = { column: "occurred_at", ascending: false };

  /**
   * Existing transactions that could be the same money movement as a batch of incoming events,
   * with the statements each was seen in (for telling app ↔ bank pairs from re-imports).
   */
  async findCandidates(userId: string, q: CandidateQuery): Promise<CandidateRow[]> {
    const run = async (refine: (b: ReturnType<typeof this.withSources>) => ReturnType<typeof this.withSources>) =>
      unwrap(await refine(this.withSources(userId)), "transactions.findCandidates") as CandidateRow[];
    // One query per URL-safe chunk: a 500-row import step would otherwise exceed the URL limit.
    const byRef = await inBatches(q.references, (refs) => run((b) => b.in("reference_id", refs)));
    const byAmount = await inBatches(q.amounts, (amounts) =>
      run((b) => {
        let query = b.in("amount_minor", amounts).gte("occurred_at", q.from).lte("occurred_at", q.to);
        if (q.direction) query = query.eq("direction", q.direction);
        return query;
      }),
    );
    const all = new Map<string, CandidateRow>();
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

  private withSources(userId: string) {
    return this.scoped(userId, CANDIDATE_COLUMNS);
  }

  /**
   * Fills a linked transaction's missing details from the other statement (UTR from the bank,
   * clean payee from the app). Never overwrites, and a UTR another transaction holds is skipped.
   */
  async enrich(userId: string, id: string, patch: Partial<TransactionRow>): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    const { error } = await this.from().update(patch).eq("user_id", userId).eq("id", id);
    if (!error) return;
    if (error.code !== PG_ERROR.UNIQUE_VIOLATION) throw fromDbError(error, "transactions.enrich");
    const rest = { ...patch };
    delete rest.reference_id;
    if (Object.keys(rest).length) unwrapMaybe(await this.from().update(rest).eq("user_id", userId).eq("id", id), "transactions.enrich");
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
