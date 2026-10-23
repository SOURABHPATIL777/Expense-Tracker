import "server-only";
import type { Direction } from "@/backend/constants/enums.constants";

// One deterministic matcher for every "is this the same money movement?" question:
// cross-source duplicates (app ↔ bank), refund matching and repayment matching.

export type MatchCandidate = {
  id: string;
  amountMinor: number;
  direction: Direction;
  occurredAt: string;
  referenceId: string | null;
  sourceKind?: string;
  counterpartyVpa?: string | null;
  merchantKey?: string | null;
};

/** An existing transaction as the import matcher sees it: where it came from, and its details. */
export type ExistingTransaction = MatchCandidate & {
  /** Kinds and apps of the statements it was seen in ("bank", "upi_app"; "hdfc", "paytm"). */
  sourceKinds: string[];
  sourceApps: string[];
  importIds: string[];
  narration: string | null;
  counterpartyName: string | null;
  /** Running balances printed next to it in bank statements. */
  balances: number[];
};

/** An incoming statement row. */
export type IncomingRow = {
  amountMinor: number;
  direction: Direction;
  occurredAt: string;
  referenceId: string | null;
  sourceKind: string;
  sourceApp: string;
  importId: string;
  counterpartyVpa: string | null;
  counterpartyName: string | null;
  narration: string | null;
  balanceMinor: number | null;
};

export type MatchDecision =
  /** Same UTR + direction: the same payment seen from another source. Link it, never duplicate it. */
  | { kind: "same_reference"; transactionId: string }
  /** The same payment from the other side (UPI app ↔ bank) without a shared UTR, corroborated. Link it. */
  | { kind: "cross_source"; transactionId: string }
  /** The same statement row imported again (overlapping statements, or PDF then Excel). Skip it. */
  | { kind: "same_row"; transactionId: string }
  /** Could be the same payment, but not certain: create it and ask the user. */
  | { kind: "possible_duplicate"; transactionIds: string[] }
  | { kind: "new" };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 330 * 60_000;

export const hoursBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / HOUR_MS;

/** Calendar day in IST, as a day number (statements are dated in IST). */
const istDay = (iso: string) => Math.floor((Date.parse(iso) + IST_OFFSET_MS) / DAY_MS);
/** Bank statements usually print only a date, stored as midnight IST. */
const hasTime = (iso: string) => (Date.parse(iso) + IST_OFFSET_MS) % DAY_MS !== 0;

export type MatchWindow = {
  /** A bank can show a UPI payment this many days before (rarely) or after the app's date. */
  daysBefore: number;
  daysAfter: number;
  /** Times within this many minutes count as corroboration when both sides have a time. */
  minutes: number;
};

const words = (text: string | null | undefined) =>
  new Set(
    (text ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w)),
  );

/** Share of `a`'s words found in `b` (payee "Swiggy" in bank narration "UPI-SWIGGY-…"). */
function overlap(a: string | null | undefined, b: string | null | undefined): number {
  const wa = words(a);
  if (!wa.size) return 0;
  const wb = words(b);
  return [...wa].filter((w) => wb.has(w)).length / wa.size;
}

/** How strongly an app row and a bank row look like the same payment (beyond amount and date). */
function corroboration(row: IncomingRow, c: ExistingTransaction, window: MatchWindow): number {
  let score = 0;
  if (row.counterpartyVpa && c.counterpartyVpa && row.counterpartyVpa === c.counterpartyVpa) score += 50;
  const payee = Math.max(overlap(row.counterpartyName, `${c.narration ?? ""} ${c.counterpartyName ?? ""}`), overlap(c.counterpartyName, row.narration));
  if (payee >= 0.5) score += 30;
  if (hasTime(row.occurredAt) && hasTime(c.occurredAt) && hoursBetween(row.occurredAt, c.occurredAt) * 60 <= window.minutes) score += 20;
  const days = Math.abs(istDay(row.occurredAt) - istDay(c.occurredAt));
  score += days === 0 ? 10 : days === 1 ? 5 : 0;
  return score;
}

/**
 * Decides how an incoming statement row relates to existing transactions:
 *  - the same UTR (and direction) is the same payment → link;
 *  - from the other side (UPI app ↔ bank) with the same amount, direction and a plausible date,
 *    and either the only such candidate or clearly the best corroborated one → link;
 *  - the same statement row seen again (same app/bank, same day and amount, and the same running
 *    balance or nearly the same narration) → skip as already imported;
 *  - an uncertain app ↔ bank lookalike → create it and ask the user.
 * Rows of the same import are never compared with each other (two ₹20 teas are two payments),
 * and two different UTRs are never the same payment.
 */
export function matchIncoming(row: IncomingRow, candidates: readonly ExistingTransaction[], window: MatchWindow): MatchDecision {
  const others = candidates.filter((c) => !c.importIds.includes(row.importId) && c.direction === row.direction);
  if (row.referenceId) {
    const sameRef = others.find((c) => c.referenceId === row.referenceId);
    if (sameRef) return { kind: "same_reference", transactionId: sameRef.id };
  }
  const compatible = others.filter((c) => c.amountMinor === row.amountMinor && !(c.referenceId && row.referenceId && c.referenceId !== row.referenceId));

  // The same row from another copy of the same statement.
  const sameDay = compatible.filter((c) => c.sourceApps.includes(row.sourceApp) && istDay(c.occurredAt) === istDay(row.occurredAt));
  const sameRow = sameDay.find((c) => (row.balanceMinor !== null && c.balances.includes(row.balanceMinor)) || overlap(row.narration, c.narration) >= 0.8);
  if (sameRow) return { kind: "same_row", transactionId: sameRow.id };

  // The other side of the same payment: an app row and a bank row.
  const crossSide = compatible.filter((c) => {
    if (c.sourceKinds.includes(row.sourceKind)) return false; // already has a row from this side
    const appDay = istDay(row.sourceKind === "upi_app" ? row.occurredAt : c.occurredAt);
    const bankDay = istDay(row.sourceKind === "upi_app" ? c.occurredAt : row.occurredAt);
    return bankDay - appDay >= -window.daysBefore && bankDay - appDay <= window.daysAfter;
  });
  if (crossSide.length === 1) return { kind: "cross_source", transactionId: crossSide[0].id };
  if (crossSide.length > 1) {
    const ranked = crossSide.map((c) => ({ c, score: corroboration(row, c, window) })).sort((a, b) => b.score - a.score);
    if (ranked[0].score >= 30 && ranked[0].score - ranked[1].score >= 20) return { kind: "cross_source", transactionId: ranked[0].c.id };
    return { kind: "possible_duplicate", transactionIds: ranked.map((r) => r.c.id) };
  }
  return { kind: "new" };
}

/**
 * Ranks incoming credits that could settle an expected amount (refunds, friend repayments):
 * exact amount first, then same counterparty, then closest in time. Only credits after `since`.
 */
export function rankSettlementCandidates(
  expected: { amountMinor: number; since: string; counterpartyVpa?: string | null; merchantKey?: string | null; windowDays: number },
  credits: MatchCandidate[],
): MatchCandidate[] {
  const sinceMs = Date.parse(expected.since);
  const untilMs = sinceMs + expected.windowDays * 24 * HOUR_MS;
  const score = (c: MatchCandidate) =>
    (c.amountMinor === expected.amountMinor ? 100 : c.amountMinor <= expected.amountMinor ? 40 : 0) +
    (expected.counterpartyVpa && c.counterpartyVpa === expected.counterpartyVpa ? 30 : 0) +
    (expected.merchantKey && c.merchantKey === expected.merchantKey ? 20 : 0) -
    hoursBetween(c.occurredAt, expected.since) / 24;
  return credits
    .filter((c) => c.direction === "credit" && Date.parse(c.occurredAt) >= sinceMs && Date.parse(c.occurredAt) <= untilMs)
    .filter((c) => c.amountMinor === expected.amountMinor || (expected.counterpartyVpa && c.counterpartyVpa === expected.counterpartyVpa))
    .sort((a, b) => score(b) - score(a));
}
