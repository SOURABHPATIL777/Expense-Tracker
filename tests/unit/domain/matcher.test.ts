import { describe, expect, it } from "vitest";
import { matchIncoming, rankSettlementCandidates, type MatchCandidate } from "@/backend/domain/matcher";
import { fingerprintAll } from "@/backend/domain/fingerprint";
import { inferKind } from "@/backend/domain/inferKind";
import type { ParsedEvent } from "@/backend/import/types";

const tx = (over: Partial<MatchCandidate>): MatchCandidate => ({
  id: crypto.randomUUID(),
  amountMinor: 35000,
  direction: "debit",
  occurredAt: "2024-10-05T05:02:00.000Z",
  referenceId: null,
  ...over,
});

describe("matchIncoming", () => {
  it("links an app payment to the bank row with the same UTR", () => {
    const bank = tx({ referenceId: "427912345678", occurredAt: "2024-10-04T18:30:00.000Z" });
    const decision = matchIncoming({ ...tx({}), referenceId: "427912345678" }, [bank], 24);
    expect(decision).toEqual({ kind: "same_reference", transactionId: bank.id });
  });

  it("does not link a payment and its reversal (same UTR, opposite direction)", () => {
    const debit = tx({ referenceId: "427912345678" });
    const decision = matchIncoming({ ...tx({ direction: "credit" }), referenceId: "427912345678" }, [debit], 24);
    expect(decision.kind).toBe("new");
  });

  it("flags same amount + close time without a UTR as a possible duplicate, never a merge", () => {
    const existing = tx({ occurredAt: "2024-10-05T04:00:00.000Z" });
    expect(matchIncoming(tx({}), [existing], 24)).toEqual({ kind: "possible_duplicate", transactionIds: [existing.id] });
  });

  it("treats different UTRs as different payments", () => {
    const existing = tx({ referenceId: "111111111111" });
    expect(matchIncoming(tx({ referenceId: "222222222222" }), [existing], 24).kind).toBe("new");
  });

  it("ignores candidates outside the window", () => {
    expect(matchIncoming(tx({}), [tx({ occurredAt: "2024-10-08T05:02:00.000Z" })], 24).kind).toBe("new");
  });
});

describe("rankSettlementCandidates", () => {
  it("prefers the exact amount from the same counterparty after the expense", () => {
    const since = "2024-10-05T00:00:00.000Z";
    const before = tx({ direction: "credit", occurredAt: "2024-10-04T00:00:00.000Z" });
    const other = tx({ direction: "credit", occurredAt: "2024-10-06T00:00:00.000Z" });
    const fromRahul = tx({ direction: "credit", occurredAt: "2024-10-07T00:00:00.000Z", counterpartyVpa: "rahul@ybl" });
    const ranked = rankSettlementCandidates({ amountMinor: 35000, since, counterpartyVpa: "rahul@ybl", windowDays: 30 }, [before, other, fromRahul]);
    expect(ranked.map((c) => c.id)).toEqual([fromRahul.id, other.id]);
  });
});

const event = (over: Partial<ParsedEvent> = {}): ParsedEvent => ({
  occurredAt: "2024-10-05T05:02:00.000Z",
  amountMinor: 2000,
  direction: "debit",
  status: "success",
  counterpartyName: "Chai Point",
  counterpartyVpa: null,
  narration: "UPI/CHAI",
  referenceId: null,
  appTransactionId: null,
  balanceMinor: null,
  note: null,
  ...over,
});

describe("fingerprintAll", () => {
  it("keeps identical rows within a file distinct but stable across re-imports", () => {
    const a = fingerprintAll("phonepe", [event(), event()]);
    const b = fingerprintAll("phonepe", [event(), event()]);
    expect(a[0]).not.toBe(a[1]);
    expect(a).toEqual(b);
  });
});

describe("inferKind", () => {
  it.each([
    [event({ counterpartyVpa: "me@ybl" }), "self_transfer"],
    [event({ direction: "credit", narration: "REV-UPI/427912345678" }), "reversal"],
    [event({ direction: "credit", narration: "Refund from Amazon" }), "refund"],
    [event({ narration: "CRED CLUB credit card bill" }), "cc_bill_payment"],
    [event(), "unknown"],
  ])("%#", (e, kind) => {
    expect(inferKind(e, new Set(["me@ybl"]))).toBe(kind);
  });
});
