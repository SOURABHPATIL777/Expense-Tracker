import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let alice: string;
let salary: string;

beforeAll(async () => {
  t = await createTestDb();
  alice = await t.createUser();
  salary = (await t.db.query<{ id: string }>(`select id from public.categories where user_id = $1 and name = 'Salary'`, [alice])).rows[0].id;
});

const autoRule = (pattern: string, direction: string | null) =>
  t.db.query(
    `insert into public.categorization_rules (user_id, field, operator, pattern, category_id, transaction_kind, direction, origin)
     values ($1, 'vpa', 'equals', $2, $3, 'income', $4, 'auto')`,
    [alice, pattern, salary, direction],
  );

describe("realtime", () => {
  it("publishes imports to Supabase Realtime", async () => {
    const { rows } = await t.db.query(`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'imports'`);
    expect(rows).toHaveLength(1);
  });
});

describe("rules: direction and auto rules", () => {
  it("defaults to user rules that apply to both directions", async () => {
    const { rows } = await t.db.query<{ direction: string | null; origin: string }>(
      `insert into public.categorization_rules (user_id, field, operator, pattern, category_id) values ($1, 'merchant', 'contains', 'swiggy', $2) returning direction, origin`,
      [alice, salary],
    );
    expect(rows[0]).toEqual({ direction: null, origin: "user" });
  });

  it("keeps one auto rule per counterparty and direction", async () => {
    await autoRule("payroll@acme", "credit");
    await expect(autoRule("PAYROLL@ACME", "credit")).rejects.toThrow(/duplicate key/);
    await autoRule("payroll@acme", "debit");
  });

  it("rejects an unknown origin", async () => {
    await expect(
      t.db.query(`insert into public.categorization_rules (user_id, field, operator, pattern, category_id, origin) values ($1, 'vpa', 'equals', 'x@y', $2, 'robot')`, [alice, salary]),
    ).rejects.toThrow(/check constraint/);
  });
});
