import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let alice: string;
let bob: string;
let guest: string;

beforeAll(async () => {
  t = await createTestDb();
  alice = await t.createUser({ name: "Alice" });
  bob = await t.createUser({ name: "Bob" });
  guest = await t.createUser({ anonymous: true });
});

async function insertTransaction(userId: string) {
  const { rows } = await t.db.query<{ id: string }>(
    `insert into public.transactions (user_id, amount_minor, direction, occurred_at, source_app)
     values ($1, 50000, 'debit', now(), 'phonepe') returning id`,
    [userId],
  );
  return rows[0].id;
}

describe("signup trigger", () => {
  it("creates a profile and default categories for permanent users", async () => {
    const { rows } = await t.db.query<{ n: number }>(`select count(*)::int as n from public.categories where user_id = $1`, [alice]);
    expect(rows[0].n).toBeGreaterThanOrEqual(15);
    const profile = await t.db.query(`select display_name from public.profiles where id = $1`, [alice]);
    expect(profile.rows).toEqual([{ display_name: "Alice" }]);
  });

  it("creates nothing for anonymous guests", async () => {
    const { rows } = await t.db.query<{ n: number }>(`select count(*)::int as n from public.categories where user_id = $1`, [guest]);
    expect(rows[0].n).toBe(0);
  });
});

describe("transactions RLS", () => {
  it("owners see their rows; other users and guests see none", async () => {
    const txId = await insertTransaction(alice);
    const asAlice = await t.as(alice, (q) => q(`select id from public.transactions where id = $1`, [txId]));
    const asBob = await t.as(bob, (q) => q(`select id from public.transactions where id = $1`, [txId]));
    const asGuest = await t.as(guest, (q) => q(`select id from public.transactions`), { anonymous: true });
    expect(asAlice.rows).toHaveLength(1);
    expect(asBob.rows).toHaveLength(0);
    expect(asGuest.rows).toHaveLength(0);
  });

  it("prevents inserting rows for another user", async () => {
    await expect(
      t.as(bob, (q) =>
        q(`insert into public.transactions (user_id, amount_minor, direction, occurred_at, source_app) values ($1, 1, 'debit', now(), 'gpay')`, [alice]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("prevents anonymous sessions from writing even their own rows", async () => {
    await expect(
      t.as(
        guest,
        (q) => q(`insert into public.categories (user_id, name) values ($1, 'Sneaky')`, [guest]),
        { anonymous: true },
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("allows a payment and its reversal to share a UTR but blocks duplicate UTRs per direction", async () => {
    const insert = (direction: string) =>
      t.db.query(
        `insert into public.transactions (user_id, amount_minor, direction, occurred_at, source_app, reference_id)
         values ($1, 1000, $2, now(), 'sbi', '412345678901')`,
        [bob, direction],
      );
    await insert("debit");
    await insert("credit");
    await expect(insert("debit")).rejects.toThrow(/duplicate key/);
  });
});

describe("service-only objects", () => {
  it("hides jobs and rate limits from users", async () => {
    await t.db.query(`insert into public.jobs (user_id, type) values ($1, 'parse_import')`, [alice]);
    const { rows } = await t.as(alice, (q) => q(`select * from public.jobs`));
    expect(rows).toHaveLength(0);
  });

  it("claim_jobs locks and increments attempts", async () => {
    const { rows } = await t.db.query<{ attempts: number; status: string }>(`select attempts, status from public.claim_jobs(10, 60)`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ attempts: 1, status: "running" });
    const again = await t.db.query(`select * from public.claim_jobs(10, 60)`);
    expect(again.rows).toHaveLength(0);
  });

  it("rate_limit_hit allows up to the max per window", async () => {
    const hit = async () => (await t.db.query<{ ok: boolean }>(`select public.rate_limit_hit('t:1', 60, 2) as ok`)).rows[0].ok;
    expect([await hit(), await hit(), await hit()]).toEqual([true, true, false]);
  });
});

describe("uploaded_files ledger", () => {
  const sha = "a".repeat(64);
  async function insertImport(userId: string) {
    const { rows } = await t.db.query<{ id: string }>(
      `insert into public.imports (user_id, source_kind, source_app, file_name, file_path, file_size, file_sha256)
       values ($1, 'upi_app', 'phonepe', 'statement.pdf', $2, 100, $3) returning id`,
      [userId, `${userId}/x/statement.pdf`, crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")],
    );
    return rows[0].id;
  }
  const record = (userId: string, importId: string | null, key: string) =>
    t.db.query<{ id: string }>(
      `insert into public.uploaded_files (user_id, import_id, file_name, file_key, bucket, size_bytes, sha256)
       values ($1, $2, 'statement.pdf', $3, 'expense-statements', 100, $4) returning id`,
      [userId, importId, key, sha],
    );

  it("lets owners read their file history but never write it", async () => {
    const importId = await insertImport(alice);
    await record(alice, importId, `${alice}/${importId}/statement.pdf`);
    const own = await t.as(alice, (q) => q(`select status from public.uploaded_files where import_id = $1`, [importId]));
    expect(own.rows).toEqual([{ status: "uploaded" }]);
    const other = await t.as(bob, (q) => q(`select id from public.uploaded_files where import_id = $1`, [importId]));
    expect(other.rows).toHaveLength(0);
    await expect(t.as(alice, (q) => q(`update public.uploaded_files set status = 'deleted' where import_id = $1`, [importId]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("requires keys under the owner's prefix", async () => {
    await expect(record(alice, null, `${bob}/x/evil.pdf`)).rejects.toThrow(/check constraint/);
  });

  it("requires deleted_at exactly when deleted, and survives import deletion", async () => {
    const importId = await insertImport(bob);
    const key = `${bob}/${importId}/statement.pdf`;
    await record(bob, importId, key);
    await expect(t.db.query(`update public.uploaded_files set status = 'deleted' where file_key = $1`, [key])).rejects.toThrow(/check constraint/);
    await t.db.query(`update public.uploaded_files set status = 'deleted', deleted_at = now() where file_key = $1`, [key]);
    await t.db.query(`delete from public.imports where id = $1`, [importId]);
    const { rows } = await t.db.query(`select status, import_id from public.uploaded_files where file_key = $1`, [key]);
    expect(rows).toEqual([{ status: "deleted", import_id: null }]);
  });
});
