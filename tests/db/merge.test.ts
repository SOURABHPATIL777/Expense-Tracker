import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let user: string;
let other: string;

beforeAll(async () => {
  t = await createTestDb();
  user = await t.createUser();
  other = await t.createUser();
});

async function tx(userId: string, over: { amount?: number; ref?: string | null; vpa?: string | null; sourceApp?: string } = {}) {
  const { rows } = await t.db.query<{ id: string }>(
    `insert into public.transactions (user_id, amount_minor, direction, occurred_at, source_app, reference_id, counterparty_vpa, review_status)
     values ($1, $2, 'debit', now(), $3, $4, $5, 'needs_review') returning id`,
    [userId, over.amount ?? 35000, over.sourceApp ?? "phonepe", over.ref ?? null, over.vpa ?? null],
  );
  return rows[0].id;
}

async function source(userId: string, txId: string, kind: "upi_app" | "bank") {
  const imp = await t.db.query<{ id: string }>(
    `insert into public.imports (user_id, source_kind, source_app, file_name, file_path, file_size, file_sha256)
     values ($1, $2, 'x', 'f.csv', $3, 1, $4) returning id`,
    [userId, kind, `${userId}/${crypto.randomUUID()}/f.csv`, crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")],
  );
  const raw = await t.db.query<{ id: string }>(
    `insert into public.raw_events (user_id, import_id, row_index, raw, fingerprint, status, transaction_id)
     values ($1, $2, 0, '{}', $3, 'accepted', $4) returning id`,
    [userId, imp.rows[0].id, crypto.randomUUID(), txId],
  );
  await t.db.query(
    `insert into public.transaction_sources (user_id, transaction_id, raw_event_id, import_id, source_kind, source_app) values ($1, $2, $3, $4, $5, 'x')`,
    [userId, txId, raw.rows[0].id, imp.rows[0].id, kind],
  );
}

describe("merge_transactions", () => {
  it("folds the duplicate into the kept transaction and reconciles sources", async () => {
    const keep = await tx(user, { sourceApp: "sbi" });
    const remove = await tx(user, { ref: "427912345678", vpa: "swiggy@ybl" });
    await source(user, keep, "bank");
    await source(user, remove, "upi_app");
    await t.db.query(`insert into public.review_items (user_id, kind, transaction_id, related_transaction_id) values ($1, 'duplicate_candidate', $2, $3)`, [user, remove, keep]);

    await t.as(user, (q) => q(`select public.merge_transactions($1, $2)`, [keep, remove]));

    const { rows } = await t.db.query(`select reference_id, counterparty_vpa, reconciliation, review_status from public.transactions where id = $1`, [keep]);
    expect(rows[0]).toEqual({ reference_id: "427912345678", counterparty_vpa: "swiggy@ybl", reconciliation: "reconciled", review_status: "ok" });
    expect((await t.db.query(`select 1 from public.transactions where id = $1`, [remove])).rows).toHaveLength(0);
    expect((await t.db.query(`select count(*)::int as n from public.transaction_sources where transaction_id = $1`, [keep])).rows[0]).toEqual({ n: 2 });
    // The review item pointed at the removed transaction, so it goes with it: nothing is left open.
    expect((await t.db.query(`select 1 from public.review_items where status = 'open' and related_transaction_id = $1`, [keep])).rows).toHaveLength(0);
  });

  it("refuses different amounts and other users' transactions", async () => {
    const a = await tx(user);
    const b = await tx(user, { amount: 100 });
    await expect(t.as(user, (q) => q(`select public.merge_transactions($1, $2)`, [a, b]))).rejects.toThrow(/APP:INVALID_STATE/);
    const theirs = await tx(other);
    await expect(t.as(user, (q) => q(`select public.merge_transactions($1, $2)`, [a, theirs]))).rejects.toThrow(/APP:NOT_FOUND/);
  });
});
