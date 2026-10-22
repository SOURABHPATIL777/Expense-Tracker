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

export type MatchProbe = Omit<MatchCandidate, "id">;

export type MatchDecision =
  /** Same UTR + direction: the same payment seen from another source. Link it, never duplicate it. */
  | { kind: "same_reference"; transactionId: string }
  /** Same amount/direction close in time but no shared UTR: create it and ask the user. */
  | { kind: "possible_duplicate"; transactionIds: string[] }
  | { kind: "new" };

const HOUR_MS = 3_600_000;

export const hoursBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / HOUR_MS;

/** Decides how an incoming event relates to existing transactions. Never auto-merges without a UTR. */
export function matchIncoming(probe: MatchProbe, candidates: MatchCandidate[], windowHours: number): MatchDecision {
  if (probe.referenceId) {
    const sameRef = candidates.find((c) => c.referenceId === probe.referenceId && c.direction === probe.direction);
    if (sameRef) return { kind: "same_reference", transactionId: sameRef.id };
  }
  const near = candidates.filter(
    (c) =>
      c.amountMinor === probe.amountMinor &&
      c.direction === probe.direction &&
      hoursBetween(c.occurredAt, probe.occurredAt) <= windowHours &&
      // Two different UTRs are two different payments, however similar.
      !(c.referenceId && probe.referenceId && c.referenceId !== probe.referenceId),
  );
  return near.length ? { kind: "possible_duplicate", transactionIds: near.map((c) => c.id) } : { kind: "new" };
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
