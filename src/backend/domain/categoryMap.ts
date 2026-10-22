import "server-only";
import type { TransactionKind } from "@/backend/constants/enums.constants";

export type MapEntry = {
  keyword: string;
  /** Set on a user's own row: their category. */
  categoryId: string | null;
  /** Set on a shared row: the catalog category, resolved to each user's copy of it. */
  defaultCategoryId: string | null;
  transactionKind: TransactionKind | null;
  /** A user's own correction (beats any shared mapping). */
  userScoped: boolean;
};

/**
 * The user's category for a map entry: their own category, or their copy of the catalog one.
 * Null when they have since deleted it (the transaction then falls through to the next step).
 */
export function resolveCategory<C extends { id: string; default_category_id: string | null }>(entry: MapEntry, categories: readonly C[]): C | null {
  if (entry.categoryId) return categories.find((c) => c.id === entry.categoryId) ?? null;
  if (entry.defaultCategoryId) return categories.find((c) => c.default_category_id === entry.defaultCategoryId) ?? null;
  return null;
}

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
