import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let user: string;
let other: string;

type Row = { amount: number; direction: "debit" | "credit"; kind: string; status?: string; share?: number | null; at?: string; category?: string | null };

async function insert(userId: string, r: Row) {
  await t.db.query(
    `insert into public.transactions (user_id, amount_minor, direction, transaction_kind, status, personal_share_minor, occurred_at, source_app, category_id)
     values ($1, $2, $3, $4, $5, $6, $7, 'phonepe', $8)`,
    [userId, r.amount, r.direction, r.kind, r.status ?? "success", r.share ?? null, r.at ?? "2024-10-10T06:00:00Z", r.category ?? null],
  );
}

beforeAll(async () => {
  t = await createTestDb();
  user = await t.createUser();
  other = await t.createUser();
  const food = (await t.db.query<{ id: string }>(`select id from public.categories where user_id = $1 and name = 'Food & Dining'`, [user])).rows[0].id;
  const rows: Row[] = [
    { amount: 200000, direction: "debit", kind: "expense", share: 50000, category: food }, // dinner for 4, my share 500
    { amount: 100000, direction: "debit", kind: "expense", category: food },
    { amount: 500000, direction: "debit", kind: "self_transfer" },
    { amount: 30000, direction: "debit", kind: "reimbursable" },
    { amount: 999900, direction: "debit", kind: "expense", status: "failed" }, // not counted
    { amount: 8500000, direction: "credit", kind: "income" },
    { amount: 40000, direction: "credit", kind: "refund" },
    { amount: 50000, direction: "credit", kind: "unknown" }, // a friend repaying?
    { amount: 77700, direction: "debit", kind: "expense", at: "2024-10-31T18:30:00Z" }, // 1 Nov 00:00 IST: next month
  ];
  for (const r of rows) await insert(user, r);
  await insert(other, { amount: 123400, direction: "debit", kind: "expense" });
});

const october = { from: "2024-09-30T18:30:00.000Z", to: "2024-10-31T18:30:00.000Z" };

describe("report_overview", () => {
  it("separates personal spending from cash outflow, transfers and others' shares", async () => {
    const { rows } = await t.as(user, (q) => q<{ r: Record<string, number> }>(`select public.report_overview($1, $2) as r`, [october.from, october.to]));
    expect(rows[0].r).toMatchObject({
      cash_outflow: 830000, // 2000 + 1000 + 5000 + 300; failed payment excluded
      personal_expense: 150000, // my 500 share + 1000
      others_share: 180000, // 1500 of the dinner + 300 reimbursable
      own_transfers: 500000,
      income: 8500000,
      refunds_received: 40000,
      unclassified_inflow: 50000,
      failed_or_pending_count: 1,
      uncategorized_count: 0,
    });
  });

  it("breaks spending down by category using the personal share", async () => {
    const { rows } = await t.as(user, (q) => q<{ total_minor: string; tx_count: string }>(`select * from public.report_category_breakdown($1, $2)`, [october.from, october.to]));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total_minor)).toBe(150000);
    expect(Number(rows[0].tx_count)).toBe(2);
  });

  it("only ever reports the caller's own transactions", async () => {
    const { rows } = await t.as(other, (q) => q<{ r: Record<string, number> }>(`select public.report_overview($1, $2) as r`, [october.from, october.to]));
    expect(rows[0].r.personal_expense).toBe(123400);
  });
});
