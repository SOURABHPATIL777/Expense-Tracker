import "server-only";
import { createHash } from "node:crypto";
import { STATEMENT_HEADER_WORDS, STATEMENT_TABLE } from "@/backend/constants/app.constants";

/** Lower-case, collapse whitespace, strip punctuation: "Withdrawal Amt. (INR)" → "withdrawal amt inr". */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

const DATE_LIKE = /^(\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[ -][a-z]{3,9}[ -,]+\d{2,4}|[a-z]{3,9} \d{1,2},? \d{4})\b/i;
const AMOUNT_LIKE = /^[+-]?\s*(₹|rs\.?|inr)?\s*(\d[\d,]*(\.\d{1,2})?|\.\d{1,2})\s*(dr|cr)?$/i;
const HEADER_WORD = new RegExp(`\\b(${STATEMENT_HEADER_WORDS.join("|")})\\b`, "i");

export const isDateLike = (text: string) => DATE_LIKE.test(text.trim());
export const isAmountLike = (text: string) => AMOUNT_LIKE.test(text.trim());

/** A row that could be a transaction: it has a date-like cell and a separate amount-like cell. */
export function looksLikeTransactionRow(cells: readonly string[]): boolean {
  const date = cells.findIndex(isDateLike);
  return date >= 0 && cells.some((c, i) => i !== date && isAmountLike(c));
}

/** A column-header row: several header words ("Date", "Narration", "Debit", …) and no values. */
export function looksLikeHeaderRow(cells: readonly string[]): boolean {
  const filled = cells.map((c) => c.trim()).filter(Boolean);
  if (filled.some((c) => isDateLike(c) || isAmountLike(c))) return false;
  return filled.filter((c) => c.length <= 60 && HEADER_WORD.test(normalizeHeader(c))).length >= STATEMENT_TABLE.MIN_HEADER_CELLS;
}

/** Signature of a header row used to recognise a saved template next time. */
export function headerSignature(header: string[]): string {
  return header.map(normalizeHeader).filter(Boolean).join("|");
}

export const nullIfEmpty = (v: string | undefined | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Identity of a PDF statement layout for the shared layouts table: a SHA-256 of its first header
 * lines with digits removed. Only the hash is stored, because those lines can hold a customer's
 * name or address.
 */
export function textLayoutFingerprint(lines: string[], take = 8): string {
  const head = lines
    .slice(0, 30)
    .map((l) => normalizeHeader(l.replace(/\d+/g, " ")))
    .filter((l) => l.length >= 3)
    .slice(0, take)
    .join("|");
  return `sha256:${createHash("sha256").update(head).digest("hex")}`;
}
