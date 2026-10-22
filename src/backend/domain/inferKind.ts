import "server-only";
import type { SourceKind, TransactionKind } from "@/backend/constants/enums.constants";
import type { ParsedEvent } from "@/backend/import/types";

const REFUND = /\b(refund|rfnd|cashback)\b/i;
const REVERSAL = /\b(rev|reversal|reversed|chargeback)\b/i;
const CARD_BILL = /\b(credit card|cc payment|card bill|cred club|billdesk.*card|autopay.*card)\b/i;

const RAILS: Array<[RegExp, string]> = [
  [/\bUPI\b/i, "upi"],
  [/\bIMPS\b/i, "imps"],
  [/\bNEFT\b/i, "neft"],
  [/\bRTGS\b/i, "rtgs"],
  [/\b(ATM|ATW|NWD)\b/i, "atm"],
  [/\b(POS|ECOM)\b/i, "card"],
];

/** Payment rail from the row: UPI-app rows are UPI by definition; bank rows are read from the narration. */
export function paymentRail(e: ParsedEvent, sourceKind: SourceKind): string {
  if (sourceKind === "upi_app") return "upi";
  const text = e.narration ?? "";
  return RAILS.find(([re]) => re.test(text))?.[1] ?? "other";
}

/**
 * Deterministic first-pass classification from the statement row itself. Anything not settled
 * here stays `unknown` for rules / merchant map / LLM to decide.
 */
export function inferKind(e: ParsedEvent, ownVpas: ReadonlySet<string>): TransactionKind {
  const text = `${e.narration ?? ""} ${e.counterpartyName ?? ""}`;
  if (e.counterpartyVpa && ownVpas.has(e.counterpartyVpa)) return "self_transfer";
  if (e.direction === "credit" && REVERSAL.test(text)) return "reversal";
  if (e.direction === "credit" && REFUND.test(text)) return "refund";
  if (e.direction === "debit" && CARD_BILL.test(text)) return "cc_bill_payment";
  return "unknown";
}
