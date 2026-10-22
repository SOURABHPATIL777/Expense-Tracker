import "server-only";
import type { TransactionKind } from "@/backend/constants/enums.constants";

export type MapEntry = {
  keyword: string;
  categoryName: string;
  transactionKind: TransactionKind | null;
  /** A user's own correction (beats any shared mapping). */
  userScoped: boolean;
};

/** Lower-case, everything except letters and digits becomes a space: "SWIGGY.STORES@AXIS" → "swiggy stores axis". */
export const normalizeForMatch = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A storable keyword (2–60 chars of letters, digits and spaces), or null. */
export function normalizeKeyword(raw: string | null | undefined): string | null {
  const k = normalizeForMatch(raw ?? "");
  return k.length >= 2 && k.length <= 60 && /^[a-z0-9][a-z0-9 ]+$/.test(k) ? k : null;
}

const haystack = (texts: ReadonlyArray<string | null | undefined>) => ` ${normalizeForMatch(texts.filter(Boolean).join(" "))} `;

/** Whole-word match, so "ola" matches "Ola Cabs" but not "Coca Cola". */
export const keywordAppearsIn = (texts: ReadonlyArray<string | null | undefined>, keyword: string) =>
  haystack(texts).includes(` ${normalizeForMatch(keyword)} `);

/**
 * Picks the mapping for a transaction: the user's own rows win; otherwise the longest matching
 * shared keyword, so "indmoney credit card repayment" beats plain "indmoney".
 */
export function matchCategory(texts: ReadonlyArray<string | null | undefined>, entries: readonly MapEntry[]): MapEntry | null {
  const hay = haystack(texts);
  const hits = entries.filter((e) => hay.includes(` ${e.keyword} `));
  if (hits.length === 0) return null;
  const own = hits.filter((e) => e.userScoped);
  return (own.length ? own : hits).reduce((best, e) => (e.keyword.length > best.keyword.length ? e : best));
}
