import "server-only";
import { parseAmountToMinor } from "@/shared/utils/money";
import { matchesDateFormat } from "./dates";
import { DATE_FORMAT_OPTIONS, type MappingInput } from "./mapping";
import { looksLikeHeaderRow, normalizeHeader } from "./text";
import type { TableRead } from "./types";

type Field = keyof MappingInput["columns"] | "debit" | "credit" | "amount" | "type";

/**
 * Header words per field, tried in this order (the first field to claim a column keeps it), on
 * normalised header text ("Withdrawal Amt." → "withdrawal amt", "Debit/Credit(₹)" → "debit credit").
 */
const SYNONYMS: ReadonlyArray<readonly [Field, RegExp]> = [
  ["amount", /\b(debit credit|credit debit|dr cr|cr dr)\b/],
  ["balance", /\bbalance\b/],
  ["debit", /\b(withdrawal|withdrawals|debit|debits|dr|money out|paid out)\b/],
  ["credit", /\b(deposit|deposits|credit|credits|cr|money in|paid in)\b/],
  ["vpa", /\b(upi id|vpa)\b|other transaction details/],
  ["appTransactionId", /\b(order id|transaction id|txn id|tran id)\b/],
  ["reference", /\b(chq|cheque|ref|reference|utr|rrn)\b/],
  ["time", /\btime\b/],
  ["date", /\b(txn|tran|trans|transaction|posting|booking)\s*date\b/],
  ["date", /\bdate\b/],
  ["narration", /\b(narration|description|particulars|transaction details|details)\b/],
  ["amount", /\b(amount|amt)\b/],
  ["type", /\b(type|dr cr indicator)\b/],
  ["counterparty", /\b(payee|beneficiary|merchant|name)\b/],
  ["note", /\b(comment|comments|note|notes)\b/],
  ["narration", /\bremarks?\b/],
  ["note", /\b(remarks?|tags?)\b/],
];

const DEBIT_WORDS = /\b(dr|debit|debited|paid|sent|withdrawal|purchase)\b/i;
const CREDIT_WORDS = /\b(cr|credit|credited|received|deposit|refund)\b/i;
const SIGNED = /^\s*[+-]|\b(dr|cr)\b/i;
const SAMPLE = 60;

/** The date format (of the allowed list) that parses the most sample values; dd/MM wins ties. */
export function inferDateFormat(values: readonly string[]): (typeof DATE_FORMAT_OPTIONS)[number] | null {
  const sample = values.filter((v) => v.trim()).slice(0, SAMPLE);
  let best: (typeof DATE_FORMAT_OPTIONS)[number] | null = null;
  let bestCount = 0;
  for (const format of DATE_FORMAT_OPTIONS) {
    const count = sample.filter((v) => matchesDateFormat(v, format)).length;
    // On a tie the more specific format wins ("dd MMM yyyy" over "d MMM yyyy"); dd/MM stays ahead of MM/dd.
    if (count > bestCount || (count === bestCount && count > 0 && best && format.length > best.length)) [best, bestCount] = [format, count];
  }
  return bestCount > 0 ? best : null;
}

/**
 * Works out which column is which from the header names alone, with no AI: the same mapping the
 * LLM would return. Null when the header doesn't say enough (no date column, or no amount).
 */
export function mapColumnsLocally(read: TableRead): MappingInput | null {
  const headerRowIndex = read.rows.findIndex((r) => looksLikeHeaderRow(r));
  if (headerRowIndex < 0) return null;
  const header = read.rows[headerRowIndex].map(normalizeHeader);
  const data = read.rows.slice(headerRowIndex + 1, headerRowIndex + 1 + SAMPLE);
  const values = (i: number) => data.map((r) => r[i] ?? "").filter((v) => v.trim());

  const found = new Map<Field, number>();
  const used = new Set<number>();
  for (const [field, pattern] of SYNONYMS) {
    if (found.has(field)) continue;
    const i = header.findIndex((h, idx) => h && !used.has(idx) && pattern.test(h));
    if (i < 0) continue;
    found.set(field, i);
    used.add(i);
  }

  const date = found.get("date");
  if (date === undefined) return null;
  const dateFormat = inferDateFormat(values(date));
  if (!dateFormat) return null;

  const debit = found.get("debit");
  const credit = found.get("credit");
  const amount = found.get("amount");
  const type = found.get("type");
  let amountSpec: MappingInput["amount"];
  if (debit !== undefined && credit !== undefined) amountSpec = { mode: "split", debit, credit };
  else if (amount !== undefined && type !== undefined) {
    const kinds = [...new Set(values(type).map((v) => v.trim()))];
    const debitValues = kinds.filter((k) => DEBIT_WORDS.test(k));
    const creditValues = kinds.filter((k) => CREDIT_WORDS.test(k) && !DEBIT_WORDS.test(k));
    if (!debitValues.length || !creditValues.length) return null;
    amountSpec = { mode: "typed", amount, type, debitValues, creditValues };
  } else if (amount !== undefined) {
    const amounts = values(amount).filter((v) => parseAmountToMinor(v) !== null);
    const signedShare = amounts.filter((v) => SIGNED.test(v)).length / Math.max(1, amounts.length);
    if (signedShare >= 0.5) amountSpec = { mode: "signed", amount };
    else if (found.has("balance")) amountSpec = { mode: "balance", amount };
    else return null;
  } else return null;

  const column = (f: Field) => found.get(f);
  return {
    headerRowIndex,
    columns: {
      date,
      time: column("time"),
      narration: column("narration"),
      counterparty: column("counterparty"),
      vpa: column("vpa"),
      reference: column("reference"),
      appTransactionId: column("appTransactionId"),
      balance: column("balance"),
      note: column("note"),
    },
    amount: amountSpec,
    dateFormat,
  };
}
