import "server-only";
import type { PostgrestFilterBuilder } from "@supabase/supabase-js";
import type { Db } from "@/backend/supabase/clients";
import type { TableName } from "@/backend/constants/db.constants";
import { unwrap, unwrapMaybe } from "@/backend/errors/AppError";
import { pageRange } from "@/backend/services/paginate";
import type { PaginationQuery } from "@/shared/schemas/common";

// Rows are typed by each repository's Row interface; the builder itself stays untyped until
// `npm run db:types` output is wired in.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Query = PostgrestFilterBuilder<any, any, any, any, any, any, any>;
type Values = Record<string, unknown>;
/* eslint-enable @typescript-eslint/no-explicit-any */
export type QueryRefiner = (q: Query) => Query;
export type OrderBy = { column: string; ascending?: boolean };

export type BaseRow = { id: string; user_id: string };

/**
 * Common CRUD for user-owned tables. Every query is scoped by `user_id` even though RLS also
 * enforces it, because the worker uses the service-role client where RLS does not apply.
 * Subclasses add only their aggregate-specific queries.
 */
export abstract class BaseRepository<Row extends BaseRow> {
  protected abstract readonly table: TableName;
  protected readonly defaultOrder: OrderBy = { column: "created_at", ascending: false };

  constructor(protected readonly db: Db) {}

  protected from() {
    return this.db.from(this.table);
  }

  protected scoped(userId: string, columns = "*", options?: { count?: "exact" }): Query {
    return (this.from().select(columns, options) as Query).eq("user_id", userId);
  }

  async findById(userId: string, id: string): Promise<Row> {
    return unwrap(await this.scoped(userId).eq("id", id).maybeSingle(), `${this.table}.findById`) as Row;
  }

  async findOptional(userId: string, refine: QueryRefiner): Promise<Row | null> {
    return unwrapMaybe(await refine(this.scoped(userId)).limit(1).maybeSingle(), `${this.table}.findOptional`) as Row | null;
  }

  async list(
    userId: string,
    page: PaginationQuery,
    refine: QueryRefiner = (q) => q,
    order: OrderBy = this.defaultOrder,
  ): Promise<{ rows: Row[]; total: number }> {
    const [from, to] = pageRange(page);
    const result = await refine(this.scoped(userId, "*", { count: "exact" }))
      .order(order.column, { ascending: order.ascending ?? false })
      .range(from, to);
    const rows = unwrap(result, `${this.table}.list`) as Row[];
    return { rows, total: result.count ?? rows.length };
  }

  async listAll(userId: string, refine: QueryRefiner = (q) => q, order: OrderBy = this.defaultOrder): Promise<Row[]> {
    const result = await refine(this.scoped(userId)).order(order.column, { ascending: order.ascending ?? false });
    return unwrap(result, `${this.table}.listAll`) as Row[];
  }

  async insert(userId: string, values: Omit<Partial<Row>, "user_id">): Promise<Row> {
    const result = await this.from().insert({ ...values, user_id: userId }).select().single();
    return unwrap(result, `${this.table}.insert`) as Row;
  }

  async insertMany(userId: string, values: Array<Omit<Partial<Row>, "user_id">>): Promise<Row[]> {
    if (values.length === 0) return [];
    const result = await this.from()
      .insert(values.map((v) => ({ ...v, user_id: userId })))
      .select();
    return unwrap(result, `${this.table}.insertMany`) as Row[];
  }

  async update(userId: string, id: string, patch: Omit<Partial<Row>, "id" | "user_id">): Promise<Row> {
    const result = await this.from()
      .update(patch as Values)
      .eq("user_id", userId)
      .eq("id", id)
      .select()
      .maybeSingle();
    return unwrap(result, `${this.table}.update`) as Row;
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.from().delete().eq("user_id", userId).eq("id", id).select("id").maybeSingle();
    unwrap(result, `${this.table}.remove`);
  }
}
