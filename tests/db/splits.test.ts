import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let owner: string;
let guest: string;
let intruder: string;
let expenseId: string;
let txId: string;
let rahul: string;
let priya: string;
let ownerRow: string;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const anon = { anonymous: true };

async function saveSplit(expense: string | null, participants: Array<{ id?: string; displayName: string; isOwner: boolean; shareMinor: number }>, tx: string | null = txId) {
  const { rows } = await t.as(owner, (q) =>
    q<{ id: string }>(`select public.save_split($1, $2, 'Dinner', 'exact', 200000, $3::jsonb, null) as id`, [expense, expense ? null : tx, JSON.stringify(participants)]),
  );
  return rows[0].id;
}

async function invite(participantId: string, token: string, expiresIn = "7 days") {
  await t.as(owner, (q) =>
    q(`insert into public.share_invites (user_id, participant_id, token_hash, expires_at) values ($1, $2, $3, now() + $4::interval)`, [owner, participantId, hash(token), expiresIn]),
  );
}

beforeAll(async () => {
  t = await createTestDb();
  owner = await t.createUser({ name: "Sourabh" });
  guest = await t.createUser({ anonymous: true });
  intruder = await t.createUser({ anonymous: true });
  txId = (
    await t.db.query<{ id: string }>(
      `insert into public.transactions (user_id, amount_minor, direction, transaction_kind, occurred_at, source_app) values ($1, 200000, 'debit', 'expense', now(), 'phonepe') returning id`,
      [owner],
    )
  ).rows[0].id;
  expenseId = await saveSplit(null, [
    { displayName: "You", isOwner: true, shareMinor: 50000 },
    { displayName: "Rahul", isOwner: false, shareMinor: 50000 },
    { displayName: "Priya", isOwner: false, shareMinor: 100000 },
  ]);
  const parts = (await t.db.query<{ id: string; display_name: string }>(`select id, display_name from public.expense_participants where expense_id = $1`, [expenseId])).rows;
  rahul = parts.find((p) => p.display_name === "Rahul")!.id;
  priya = parts.find((p) => p.display_name === "Priya")!.id;
  ownerRow = parts.find((p) => p.display_name === "You")!.id;
});

describe("save_split", () => {
  it("records only the owner's share as personal spending on the payment", async () => {
    const { rows } = await t.db.query<{ personal_share_minor: string }>(`select personal_share_minor from public.transactions where id = $1`, [txId]);
    expect(Number(rows[0].personal_share_minor)).toBe(50000);
  });

  it("rejects shares that don't add up to the total", async () => {
    await expect(saveSplit(null, [{ displayName: "You", isOwner: true, shareMinor: 1 }], null)).rejects.toThrow(/APP:VALIDATION/);
  });
});

describe("guest invitations", () => {
  it("binds a link to the first session that opens it, idempotently", async () => {
    await invite(rahul, "rahul-token");
    const first = await t.as(guest, (q) => q<{ id: string }>(`select public.redeem_invite($1) as id`, [hash("rahul-token")]), anon);
    const again = await t.as(guest, (q) => q<{ id: string }>(`select public.redeem_invite($1) as id`, [hash("rahul-token")]), anon);
    expect(first.rows[0].id).toBe(rahul);
    expect(again.rows[0].id).toBe(rahul);
  });

  it("refuses a second device, expired links and the owner's own link", async () => {
    await expect(t.as(intruder, (q) => q(`select public.redeem_invite($1)`, [hash("rahul-token")]), anon)).rejects.toThrow(/APP:INVITE_TAKEN/);
    await invite(priya, "expired-token", "-1 minute");
    await expect(t.as(intruder, (q) => q(`select public.redeem_invite($1)`, [hash("expired-token")]), anon)).rejects.toThrow(/APP:INVITE_INVALID/);
    await invite(priya, "owner-opens");
    await expect(t.as(owner, (q) => q(`select public.redeem_invite($1)`, [hash("owner-opens")]))).rejects.toThrow(/APP:INVALID_STATE/);
  });

  it("shows a guest only their own share, never the table data", async () => {
    const { rows } = await t.as(guest, (q) => q<{ s: Array<Record<string, unknown>> }>(`select public.guest_get_share() as s`), anon);
    expect(rows[0].s).toHaveLength(1);
    expect(rows[0].s[0]).toMatchObject({ participantId: rahul, ownerName: "Sourabh", shareMinor: 50000, totalMinor: 200000 });
    expect(JSON.stringify(rows[0].s)).not.toContain("Priya");
    for (const table of ["shared_expenses", "expense_participants", "payment_claims", "transactions"]) {
      const direct = await t.as(guest, (q) => q(`select * from public.${table}`), anon);
      expect(direct.rows, table).toHaveLength(0);
    }
  });
});

describe("guest actions", () => {
  it("requires the current version to agree, and flags edits for reconfirmation", async () => {
    await expect(t.as(guest, (q) => q(`select public.guest_respond($1, 'agreed', 99, null)`, [rahul]), anon)).rejects.toThrow(/APP:VERSION_MISMATCH/);
    await t.as(guest, (q) => q(`select public.guest_respond($1, 'agreed', 1, null)`, [rahul]), anon);

    await saveSplit(expenseId, [
      { id: ownerRow, displayName: "You", isOwner: true, shareMinor: 60000 },
      { id: rahul, displayName: "Rahul", isOwner: false, shareMinor: 40000 },
      { id: priya, displayName: "Priya", isOwner: false, shareMinor: 100000 },
    ]);
    const { rows } = await t.as(guest, (q) => q<{ s: Array<Record<string, unknown>> }>(`select public.guest_get_share() as s`), anon);
    expect(rows[0].s[0]).toMatchObject({ version: 2, responseStatus: "agreed", needsReconfirm: true, shareMinor: 40000 });
  });

  it("caps payment claims at the outstanding share and dedupes retries", async () => {
    await expect(t.as(guest, (q) => q(`select public.guest_report_payment($1, 40001, 'key-over-0001', null)`, [rahul]), anon)).rejects.toThrow(/APP:VALIDATION/);
    const a = await t.as(guest, (q) => q<{ id: string }>(`select public.guest_report_payment($1, 40000, 'key-pay-0001', 'sent on gpay') as id`, [rahul]), anon);
    const b = await t.as(guest, (q) => q<{ id: string }>(`select public.guest_report_payment($1, 40000, 'key-pay-0001', 'sent on gpay') as id`, [rahul]), anon);
    expect(a.rows[0].id).toBe(b.rows[0].id);
    const { rows } = await t.db.query(`select status, reported_by from public.payment_claims where participant_id = $1`, [rahul]);
    expect(rows).toEqual([{ status: "reported", reported_by: "guest" }]);
  });

  it("blocks sessions without access from acting for a participant", async () => {
    await expect(t.as(intruder, (q) => q(`select public.guest_respond($1, 'questioned', 2, 'not me')`, [priya]), anon)).rejects.toThrow(/APP:FORBIDDEN/);
    await expect(t.as(intruder, (q) => q(`select public.guest_report_payment($1, 100, 'key-evil-0001', null)`, [rahul]), anon)).rejects.toThrow(/APP:FORBIDDEN/);
  });

  it("prevents removing someone who has reported a payment", async () => {
    await expect(
      saveSplit(expenseId, [
        { id: ownerRow, displayName: "You", isOwner: true, shareMinor: 100000 },
        { id: priya, displayName: "Priya", isOwner: false, shareMinor: 100000 },
      ]),
    ).rejects.toThrow(/APP:INVALID_STATE/);
  });
});
