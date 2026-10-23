import "server-only";
import type { Direction } from "@/backend/constants/enums.constants";
import type { ExtractedRow, ParsedEvent } from "./types";

/** Rounding slack when comparing balances, in paise. */
const TOLERANCE = 1;
/** Rows that must reconcile for a mapping to be trusted. */
export const RECONCILE_SHARE = 0.7;
/** Fewer comparable rows than this and the check can't say anything. */
const MIN_CHECKED = 3;

type Balanced = Pick<ParsedEvent, "amountMinor" | "direction" | "balanceMinor">;

const signed = (e: Balanced, flip: boolean) => {
  const credit = (e.direction === "credit") !== flip;
  return credit ? e.amountMinor : -e.amountMinor;
};
const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

/** How many consecutive rows satisfy "previous balance ± amount = this balance", per statement order. */
function count(events: readonly Balanced[], order: "asc" | "desc", flip: boolean) {
  let checked = 0;
  let matched = 0;
  for (let i = 1; i < events.length; i++) {
    const [prev, cur] = [events[i - 1], events[i]];
    if (prev.balanceMinor === null || cur.balanceMinor === null) continue;
    checked += 1;
    // Oldest first: this row moved the balance from the previous one. Newest first: the reverse.
    const ok = order === "asc" ? close(prev.balanceMinor + signed(cur, flip), cur.balanceMinor) : close(cur.balanceMinor + signed(prev, flip), prev.balanceMinor);
    if (ok) matched += 1;
  }
  return { checked, matched };
}

export type BalanceVerdict = "ok" | "swapped" | "mismatch" | "unknown";

/**
 * Checks parsed rows against their running balance. "swapped" means debits and credits are the
 * wrong way round (columns mixed up); "mismatch" means rows don't reconcile at all (misaligned
 * columns); "unknown" when there are too few balances to tell.
 */
export function balanceVerdict(events: readonly Balanced[]): BalanceVerdict {
  const best = (flip: boolean) => {
    const asc = count(events, "asc", flip);
    const desc = count(events, "desc", flip);
    return asc.matched >= desc.matched ? asc : desc;
  };
  const straight = best(false);
  if (straight.checked < MIN_CHECKED) return "unknown";
  if (straight.matched / straight.checked >= RECONCILE_SHARE) return "ok";
  const flipped = best(true);
  return flipped.matched / flipped.checked >= RECONCILE_SHARE ? "swapped" : "mismatch";
}

/** Flips every row's direction (debit and credit columns were mapped the wrong way round). */
export function swapDirections(rows: ExtractedRow[]): ExtractedRow[] {
  return rows.map((r) => (r.parsed ? { ...r, parsed: { ...r.parsed, direction: r.parsed.direction === "debit" ? "credit" : "debit" } } : r));
}

/**
 * For statements that print unsigned amounts: each row's direction is the sign of its balance
 * change, reading the statement in whichever order (oldest or newest first) makes the changes
 * equal the amounts. Rows whose change can't be worked out are marked unreadable.
 */
export function directionsFromBalance(rows: ExtractedRow[]): ExtractedRow[] {
  const idx = rows.flatMap((r, i) => (r.parsed && r.parsed.balanceMinor !== null ? [i] : []));
  const deltaDirection = (order: "asc" | "desc") => {
    const out = new Map<number, Direction>();
    idx.forEach((i, k) => {
      const neighbour = order === "asc" ? idx[k - 1] : idx[k + 1];
      if (neighbour === undefined) return;
      const delta = rows[i].parsed!.balanceMinor! - rows[neighbour].parsed!.balanceMinor!;
      if (close(Math.abs(delta), rows[i].parsed!.amountMinor)) out.set(i, delta > 0 ? "credit" : "debit");
    });
    return out;
  };
  const asc = deltaDirection("asc");
  const desc = deltaDirection("desc");
  const chosen = asc.size >= desc.size ? asc : desc;
  return rows.map((r, i) => {
    if (!r.parsed) return r;
    const direction = chosen.get(i);
    return direction ? { ...r, parsed: { ...r.parsed, direction } } : { ...r, parsed: null, error: "Could not tell debit from credit" };
  });
}
