import "server-only";
import { STATEMENT_TABLE } from "@/backend/constants/app.constants";
import { AppError } from "@/backend/errors/AppError";
import { looksLikeTransactionRow } from "./text";
import type { ReadResult } from "./types";

/** A date somewhere in a line of text (12/10/2024, 2024-10-12, 12 Oct 2024, Oct 12, 2024). */
export const DATE_IN_TEXT = /\b(\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[ -][a-z]{3,9}[ -,']+\d{2,4}|[a-z]{3,9} \d{1,2},? \d{4})/i;
/** An amount somewhere in a line: with a rupee sign, or with paise (350.00). */
export const AMOUNT_IN_TEXT = /(₹|\brs\.\s*|\brs\s+|\binr\s*)\d[\d,]*(\.\d{1,2})?|\b\d[\d,]*\.\d{2}\b/i;

export const lineLooksLikeTransaction = (line: string) => DATE_IN_TEXT.test(line) && AMOUNT_IN_TEXT.test(line);

/**
 * How many rows or lines of a file look like transactions (a date and an amount). In text, the
 * date and the amount may sit on separate lines (activity pages put the date under each entry).
 */
export function transactionLikeCount(read: ReadResult): number {
  const table = read.kind === "table" ? read : read.table;
  const rows = table ? table.rows.filter(looksLikeTransactionRow).length : 0;
  if (read.kind !== "text") return rows;
  const both = read.lines.filter(lineLooksLikeTransaction).length;
  const split = Math.min(read.lines.filter((l) => DATE_IN_TEXT.test(l)).length, read.lines.filter((l) => AMOUNT_IN_TEXT.test(l)).length);
  return Math.max(rows, both, split);
}

/**
 * Cheap gate before any AI call: a statement has at least a couple of rows with a date and an
 * amount. Invoices, resumes, price lists and the like are turned away here.
 */
export function assertLooksLikeStatement(read: ReadResult): void {
  if (transactionLikeCount(read) < STATEMENT_TABLE.MIN_TRANSACTION_ROWS) throw new AppError("NOT_A_STATEMENT");
}
