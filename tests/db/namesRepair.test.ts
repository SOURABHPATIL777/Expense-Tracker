import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let alice: string;
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

beforeAll(async () => {
  t = await createTestDb();
  alice = await t.createUser();
  const transfers = (await t.db.query<{ id: string }>(`select id from public.default_categories order by name limit 1`)).rows[0].id;
  const mine = (await t.db.query<{ id: string }>(`select id from public.categories where user_id = $1 limit 1`, [alice])).rows[0].id;
  // Shared keywords the AI learned (and one a developer added by hand, which stays).
  for (const keyword of ["state bank of india", "zz canara bank", "kotak mahindra", "zz grape shop"]) {
    await t.db.query(`delete from public.category_map_keyword where keyword = $1`, [keyword]);
    await t.db.query(`insert into public.category_map_keyword (keyword, default_category_id, origin) values ($1, $2, 'llm')`, [keyword, transfers]);
  }
  await t.db.query(`insert into public.category_map_keyword (keyword, default_category_id, origin) values ('zz bank manual', $1, 'manual')`, [transfers]);
  for (const keyword of ["technology icici bank limited salary june 2026", "jigsaw financial technology", "salary sept 26"]) {
    await t.db.query(`insert into public.category_map_keyword (keyword, user_id, category_id, origin) values ($1, $2, $3, 'user')`, [keyword, alice, mine]);
  }
  for (const [status, sha] of [["completed", "c"], ["failed", "d"]]) {
    await t.db.query(
      `insert into public.imports (user_id, file_name, file_path, file_size, file_sha256, status) values ($1, 's.pdf', $2, 10, $3, $4)`,
      [alice, `${alice}/${sha}/s.pdf`, sha.repeat(64), status],
    );
  }
  // The migrations already ran on the empty database; run them again over this data.
  await t.db.exec(migration("20261026000001_names_repair.sql"));
  await t.db.exec(migration("20261026000002_reread_imports.sql"));
});

describe("names repair migrations", () => {
  it("drops AI- and user-learned bank keywords and dated narrations, keeps the rest", async () => {
    const { rows } = await t.db.query<{ keyword: string }>(`select keyword from public.category_map_keyword where origin <> 'seed' order by keyword`);
    expect(rows.map((r) => r.keyword)).toEqual(["jigsaw financial technology", "zz bank manual", "zz grape shop"]);
  });

  it("queues one re-read per completed import, once", async () => {
    await t.db.exec(migration("20261026000002_reread_imports.sql"));
    const { rows } = await t.db.query<{ type: string; payload: { fromFile: boolean } }>(`select type, payload from public.jobs where user_id = $1`, [alice]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "reread_import", payload: { fromFile: false } });
  });
});
