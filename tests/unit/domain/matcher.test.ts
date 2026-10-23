import { describe, expect, it } from "vitest";
import { matchIncoming, rankSettlementCandidates, type ExistingTransaction, type IncomingRow, type MatchCandidate } from "@/backend/domain/matcher";
import { normaliseRef } from "@/backend/import/engine";
import { fingerprintAll } from "@/backend/domain/fingerprint";
import { inferKind } from "@/backend/domain/inferKind";
import type { ParsedEvent } from "@/backend/import/types";

const window = { daysBefore: 1, daysAfter: 3, minutes: 30 };

/** Paytm row: payee name, a time, often no UTR. */
const appRow = (over: Partial<IncomingRow> = {}): IncomingRow => ({
  amountMinor: 35000,
  direction: "debit",
  occurredAt: "2024-10-05T05:02:11.000Z", // 10:32 IST
  referenceId: null,
  sourceKind: "upi_app",
  sourceApp: "paytm",
  importId: "paytm-import",
  counterpartyVpa: null,
  counterpartyName: "Swiggy",
  narration: "Paid to Swiggy",
  balanceMinor: null,
  ...over,
});

/** HDFC transaction already imported: date only (midnight IST), UTR, cryptic narration, balance. */
const bankTx = (over: Partial<ExistingTransaction> = {}): ExistingTransaction => ({
  id: "bank-1",
  amountMinor: 35000,
  direction: "debit",
  occurredAt: "2024-10-05T18:30:00.000Z", // 6 Oct 00:00 IST: posted the next day
  referenceId: "427912345678",
  counterpartyVpa: "swiggy.stores@axisbank",
  counterpartyName: "SWIGGY",
  narration: "UPI-SWIGGY-SWIGGY.STORES@AXISBANK-UTIB0000000-427912345678-PAYMENT",
  sourceKinds: ["bank"],
  sourceApps: ["hdfc"],
  importIds: ["hdfc-import"],
  balances: [1200000],
  ...over,
});

describe("matchIncoming: UPI app ↔ bank", () => {
  it("links the same UTR", () => {
    expect(matchIncoming(appRow({ referenceId: "427912345678" }), [bankTx()], window)).toEqual({ kind: "same_reference", transactionId: "bank-1" });
  });

  it("links an app row without UTR to the only bank row with that amount a day later", () => {
    expect(matchIncoming(appRow(), [bankTx()], window)).toEqual({ kind: "cross_source", transactionId: "bank-1" });
  });

  it("picks the corroborated one of two same-amount bank rows, and asks when it can't tell", () => {
    const other = bankTx({ id: "bank-2", referenceId: "427911111111", counterpartyVpa: "zomato@hdfcbank", counterpartyName: "ZOMATO", narration: "UPI-ZOMATO-ZOMATO@HDFCBANK-427911111111" });
    expect(matchIncoming(appRow(), [bankTx(), other], window)).toEqual({ kind: "cross_source", transactionId: "bank-1" });
    const unnamed = appRow({ counterpartyName: null, narration: "Payment" });
    expect(matchIncoming(unnamed, [bankTx(), other], window).kind).toBe("possible_duplicate");
  });

  it("never links two different UTRs, the other direction, or outside the posting window", () => {
    expect(matchIncoming(appRow({ referenceId: "999999999999" }), [bankTx()], window).kind).toBe("new");
    expect(matchIncoming(appRow({ direction: "credit" }), [bankTx()], window).kind).toBe("new");
    expect(matchIncoming(appRow({ occurredAt: "2024-09-28T05:02:11.000Z" }), [bankTx()], window).kind).toBe("new");
  });

  it("doesn't pair a bank row that already has its app row", () => {
    expect(matchIncoming(appRow(), [bankTx({ sourceKinds: ["bank", "upi_app"] })], window).kind).toBe("new");
  });

  it("works the other way round (bank file imported after the app file)", () => {
    const appTx = bankTx({ id: "app-1", occurredAt: "2024-10-05T05:02:11.000Z", referenceId: null, sourceKinds: ["upi_app"], sourceApps: ["paytm"], importIds: ["paytm-import"], counterpartyName: "Swiggy", narration: "Paid to Swiggy", balances: [] });
    const bankRow = appRow({ sourceKind: "bank", sourceApp: "hdfc", importId: "hdfc-import", occurredAt: "2024-10-05T18:30:00.000Z", referenceId: "427912345678", counterpartyName: "SWIGGY" });
    expect(matchIncoming(bankRow, [appTx], window)).toEqual({ kind: "cross_source", transactionId: "app-1" });
  });
});

describe("matchIncoming: same statement imported again", () => {
  it("recognises a row from another copy (PDF then Excel) by its running balance", () => {
    const again = appRow({ sourceKind: "bank", sourceApp: "hdfc", importId: "hdfc-excel", occurredAt: "2024-10-05T18:30:00.000Z", narration: "UPI SWIGGY 427912", balanceMinor: 1200000, counterpartyName: null });
    expect(matchIncoming(again, [bankTx({ referenceId: null })], window)).toEqual({ kind: "same_row", transactionId: "bank-1" });
  });

  it("never compares rows of the same import (two ₹20 teas are two payments)", () => {
    const tea = bankTx({ id: "tea-1", amountMinor: 2000, sourceKinds: ["upi_app"], sourceApps: ["paytm"], importIds: ["paytm-import"], referenceId: null });
    expect(matchIncoming(appRow({ amountMinor: 2000 }), [tea], window).kind).toBe("new");
  });
});

describe("normaliseRef", () => {
  it("drops bank zero padding so references match across sources", () => {
    expect(normaliseRef("0000427912345678")).toBe("427912345678");
    expect(normaliseRef("427912345678")).toBe("427912345678");
    expect(normaliseRef("N280241234567")).toBe("N280241234567");
    expect(normaliseRef("000000")).toBeNull();
  });
});

describe("rankSettlementCandidates", () => {
  const tx = (over: Partial<MatchCandidate>): MatchCandidate => ({ id: crypto.randomUUID(), amountMinor: 35000, direction: "debit", occurredAt: "2024-10-05T05:02:00.000Z", referenceId: null, ...over });

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
