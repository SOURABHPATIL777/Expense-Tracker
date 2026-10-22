import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let alice: string;
let bob: string;
let guest: string;

beforeAll(async () => {
  t = await createTestDb();
  alice = await t.createUser();
  bob = await t.createUser();
  guest = await t.createUser({ anonymous: true });
  await t.db.query(`insert into public.category_map (user_id, keyword, category_name, origin) values ($1, 'chai point', 'Food & Dining', 'user')`, [alice]);
});

describe("import_layouts", () => {
  it("is seeded with the former presets", async () => {
    const { rows } = await t.db.query<{ n: number }>(`select count(*)::int as n from public.import_layouts where origin = 'seed'`);
    expect(rows[0].n).toBeGreaterThanOrEqual(30);
  });

  it("is server-only: no user or guest can read or write it", async () => {
    await expect(t.as(alice, (q) => q(`select * from public.import_layouts limit 1`))).rejects.toThrow(/permission denied/);
    await expect(t.as(guest, (q) => q(`select * from public.import_layouts limit 1`), { anonymous: true })).rejects.toThrow(/permission denied/);
  });
});

describe("imports", () => {
  it("accepts an upload before its source is detected", async () => {
    const { rows } = await t.db.query<{ source_app: string | null; read_by_ai: boolean }>(
      `insert into public.imports (user_id, file_name, file_path, file_size, file_sha256)
       values ($1, 'statement.pdf', $2, 10, $3) returning source_app, read_by_ai`,
      [alice, `${alice}/x/statement.pdf`, "b".repeat(64)],
    );
    expect(rows[0]).toEqual({ source_app: null, read_by_ai: false });
  });
});

describe("category_map", () => {
  it("lets a user read the shared rows and their own, but not other users' rows", async () => {
    const asAlice = await t.as(alice, (q) => q<{ keyword: string }>(`select keyword from public.category_map where keyword in ('zomato', 'chai point')`));
    expect(asAlice.rows.map((r) => r.keyword).sort()).toEqual(["chai point", "zomato"]);
    const asBob = await t.as(bob, (q) => q<{ keyword: string }>(`select keyword from public.category_map where keyword = 'chai point'`));
    expect(asBob.rows).toHaveLength(0);
    const asGuest = await t.as(guest, (q) => q(`select * from public.category_map limit 1`), { anonymous: true });
    expect(asGuest.rows).toHaveLength(0);
  });

  it("only the server writes it", async () => {
    await expect(
      t.as(bob, (q) => q(`insert into public.category_map (user_id, keyword, category_name, origin) values ($1, 'evil', 'Food & Dining', 'user')`, [bob])),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps one shared row per keyword but allows a per-user override", async () => {
    await expect(t.db.query(`insert into public.category_map (keyword, category_name, origin) values ('zomato', 'Shopping', 'llm')`)).rejects.toThrow(/duplicate key/);
    await t.db.query(`insert into public.category_map (user_id, keyword, category_name, origin) values ($1, 'zomato', 'Shopping', 'user')`, [bob]);
  });

  it("seeds the specific card-bill keyword alongside the broader investment one", async () => {
    const { rows } = await t.db.query<{ keyword: string; category_name: string; transaction_kind: string | null }>(
      `select keyword, category_name, transaction_kind from public.category_map where user_id is null and keyword like 'indmoney%' order by keyword`,
    );
    expect(rows).toEqual([
      { keyword: "indmoney", category_name: "Investments", transaction_kind: "self_transfer" },
      { keyword: "indmoney credit card repayment", category_name: "Credit Card Bill", transaction_kind: "cc_bill_payment" },
    ]);
  });
});

describe("default categories", () => {
  it("include Individual and Credit Card Bill for new users", async () => {
    const { rows } = await t.db.query<{ name: string; kind_hint: string }>(
      `select name, kind_hint from public.categories where user_id = $1 and name in ('Individual', 'Credit Card Bill') order by name`,
      [alice],
    );
    expect(rows).toEqual([
      { name: "Credit Card Bill", kind_hint: "cc_bill_payment" },
      { name: "Individual", kind_hint: "expense" },
    ]);
  });
});
