import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let alice: string;
let bob: string;
let guest: string;

const categoryId = async (userId: string, name: string) =>
  (await t.db.query<{ id: string }>(`select id from public.categories where user_id = $1 and name = $2`, [userId, name])).rows[0].id;
const catalogId = async (name: string) => (await t.db.query<{ id: string }>(`select id from public.default_categories where name = $1`, [name])).rows[0].id;

beforeAll(async () => {
  t = await createTestDb();
  alice = await t.createUser();
  bob = await t.createUser();
  guest = await t.createUser({ anonymous: true });
  await t.db.query(`insert into public.category_map_keyword (user_id, category_id, keyword, origin) values ($1, $2, 'chai point', 'user')`, [
    alice,
    await categoryId(alice, "Food & Dining"),
  ]);
});

describe("import_layouts", () => {
  it("starts empty: layouts are learned by the LLM, not seeded", async () => {
    const { rows } = await t.db.query<{ n: number }>(`select count(*)::int as n from public.import_layouts`);
    expect(rows[0].n).toBe(0);
  });

  it("is server-only: no user or guest can read or write it", async () => {
    await expect(t.as(alice, (q) => q(`select * from public.import_layouts limit 1`))).rejects.toThrow(/permission denied/);
    await expect(t.as(guest, (q) => q(`select * from public.import_layouts limit 1`), { anonymous: true })).rejects.toThrow(/permission denied/);
  });
});

describe("imports", () => {
  it("accepts an upload before its source is detected", async () => {
    const { rows } = await t.db.query<{ source_app: string | null; read_by_ai: boolean; file_deleted_at: string | null }>(
      `insert into public.imports (user_id, file_name, file_path, file_size, file_sha256)
       values ($1, 'statement.pdf', $2, 10, $3) returning source_app, read_by_ai, file_deleted_at`,
      [alice, `${alice}/x/statement.pdf`, "b".repeat(64)],
    );
    expect(rows[0]).toEqual({ source_app: null, read_by_ai: false, file_deleted_at: null });
  });
});

describe("default_categories (catalog)", () => {
  it("gives every new user their own linked copy of each catalog category", async () => {
    const { rows } = await t.db.query<{ name: string; kind_hint: string; linked: boolean }>(
      `select c.name, c.kind_hint, c.default_category_id = d.id as linked
         from public.categories c join public.default_categories d on d.name = c.name
        where c.user_id = $1 and c.name in ('Individual', 'Credit Card Bill') order by c.name`,
      [alice],
    );
    expect(rows).toEqual([
      { name: "Credit Card Bill", kind_hint: "cc_bill_payment", linked: true },
      { name: "Individual", kind_hint: "expense", linked: true },
    ]);
    const counts = await t.db.query<{ catalog: number; mine: number }>(
      `select (select count(*)::int from public.default_categories) as catalog,
              (select count(*)::int from public.categories where user_id = $1 and default_category_id is not null) as mine`,
      [bob],
    );
    expect(counts.rows[0].mine).toBe(counts.rows[0].catalog);
  });

  it("reaches existing users when a developer adds a category, linking one with the same name", async () => {
    await t.db.query(`insert into public.categories (user_id, name) values ($1, 'Pets')`, [alice]);
    await t.db.query(`insert into public.default_categories (name, color) values ('Pets', '#a61e4d')`);
    const pets = await catalogId("Pets");
    const { rows } = await t.db.query<{ user_id: string; n: number }>(
      `select user_id, count(*)::int as n from public.categories where lower(name) = 'pets' and default_category_id = $1 group by user_id`,
      [pets],
    );
    expect(Object.fromEntries(rows.map((r) => [r.user_id, r.n]))).toEqual({ [alice]: 1, [bob]: 1 });
  });

  it("is readable by users but written only by the server", async () => {
    const { rows } = await t.as(alice, (q) => q(`select name from public.default_categories where name = 'Groceries'`));
    expect(rows).toHaveLength(1);
    await expect(t.as(alice, (q) => q(`insert into public.default_categories (name) values ('Evil')`))).rejects.toThrow(/permission denied/);
  });
});

describe("category_map_keyword", () => {
  it("lets a user read the shared rows and their own, but not other users' rows", async () => {
    const asAlice = await t.as(alice, (q) => q<{ keyword: string }>(`select keyword from public.category_map_keyword where keyword in ('zomato', 'chai point')`));
    expect(asAlice.rows.map((r) => r.keyword).sort()).toEqual(["chai point", "zomato"]);
    const asBob = await t.as(bob, (q) => q<{ keyword: string }>(`select keyword from public.category_map_keyword where keyword = 'chai point'`));
    expect(asBob.rows).toHaveLength(0);
    const asGuest = await t.as(guest, (q) => q(`select * from public.category_map_keyword limit 1`), { anonymous: true });
    expect(asGuest.rows).toHaveLength(0);
  });

  it("only the server writes it", async () => {
    const food = await categoryId(bob, "Food & Dining");
    await expect(
      t.as(bob, (q) => q(`insert into public.category_map_keyword (user_id, category_id, keyword) values ($1, $2, 'evil')`, [bob, food])),
    ).rejects.toThrow(/permission denied/);
  });

  it("takes a hand-written shared keyword with just a keyword and a catalog id", async () => {
    await t.db.query(`insert into public.category_map_keyword (keyword, default_category_id) select 'nature basket', id from public.default_categories where name = 'Groceries'`);
    const { rows } = await t.db.query<{ origin: string }>(`select origin from public.category_map_keyword where keyword = 'nature basket' and user_id is null`);
    expect(rows).toEqual([{ origin: "manual" }]);
  });

  it("keeps one shared row per keyword but allows a per-user override", async () => {
    const shopping = await catalogId("Shopping");
    await expect(t.db.query(`insert into public.category_map_keyword (keyword, default_category_id) values ('zomato', $1)`, [shopping])).rejects.toThrow(/duplicate key/);
    await t.db.query(`insert into public.category_map_keyword (user_id, category_id, keyword, origin) values ($1, $2, 'zomato', 'user')`, [
      bob,
      await categoryId(bob, "Shopping"),
    ]);
  });

  it("rejects a row that is both shared and user-owned, or neither", async () => {
    const food = await catalogId("Food & Dining");
    await expect(
      t.db.query(`insert into public.category_map_keyword (user_id, category_id, default_category_id, keyword) values ($1, $2, $3, 'both')`, [
        alice,
        await categoryId(alice, "Food & Dining"),
        food,
      ]),
    ).rejects.toThrow(/category_map_keyword_scope/);
    await expect(t.db.query(`insert into public.category_map_keyword (keyword) values ('neither')`)).rejects.toThrow(/category_map_keyword_scope/);
  });

  it("rejects a user keyword that points at another user's category", async () => {
    await expect(
      t.db.query(`insert into public.category_map_keyword (user_id, category_id, keyword) values ($1, $2, 'stolen')`, [alice, await categoryId(bob, "Travel")]),
    ).rejects.toThrow(/foreign key/);
  });

  it("drops a user's keywords when they delete the category", async () => {
    const travel = await categoryId(alice, "Travel");
    await t.db.query(`insert into public.category_map_keyword (user_id, category_id, keyword) values ($1, $2, 'my travel agent')`, [alice, travel]);
    await t.db.query(`delete from public.categories where id = $1`, [travel]);
    const { rows } = await t.db.query(`select 1 from public.category_map_keyword where keyword = 'my travel agent'`);
    expect(rows).toHaveLength(0);
  });

  it("seeds the specific card-bill keyword alongside the broader investment one", async () => {
    const { rows } = await t.db.query<{ keyword: string; name: string; kind_hint: string }>(
      `select k.keyword, d.name, d.kind_hint
         from public.category_map_keyword k join public.default_categories d on d.id = k.default_category_id
        where k.user_id is null and k.keyword like 'indmoney%' order by k.keyword`,
    );
    expect(rows).toEqual([
      { keyword: "indmoney", name: "Investments", kind_hint: "self_transfer" },
      { keyword: "indmoney credit card repayment", name: "Credit Card Bill", kind_hint: "cc_bill_payment" },
    ]);
  });
});
