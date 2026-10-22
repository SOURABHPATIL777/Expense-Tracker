import "server-only";
import { z } from "zod";
import { redactForLlm } from "@/backend/llm/redact";

/** Kinds the model may suggest. Own-account transfers, refunds and reversals are decided deterministically. */
export const LLM_KINDS = ["expense", "income", "reimbursable", "self_transfer", "cc_bill_payment", "unknown"] as const;

export const CATEGORIZE_INSTRUCTIONS = `Classify each Indian UPI/bank transaction that isn't categorised yet.
For every item return:
- index: the item's index
- isIndividual: true if the counterparty is a person (a friend, family member, landlord paid personally), false for any business
- category: exactly one name from the provided list, or null if none fits (use "Individual" for people)
- kind: "expense" for personal spending, "income" for salary/interest, "self_transfer" for investments/own accounts (e.g. brokers, mutual funds),
  "cc_bill_payment" for credit-card bill payments, "reimbursable" for spending clearly done for someone else,
  "unknown" when a credit could be a friend repaying (never guess income for person-to-person credits)
- keyword: the merchant or brand phrase that identifies this business, copied from the text in lower case (e.g. "zomato", "apple media",
  "indmoney credit card repayment"); null for people or when no clear brand appears
- confidence: 0 to 1
Base the answer only on the merchant, UPI handle and narration provided.`;

export function categorizeSchema(categoryNames: readonly [string, ...string[]]) {
  return z.object({
    items: z.array(
      z.object({
        index: z.number().int().min(0),
        isIndividual: z.boolean(),
        category: z.enum(categoryNames).nullable(),
        kind: z.enum(LLM_KINDS),
        keyword: z.string().max(60).nullable(),
        confidence: z.number().min(0).max(1),
      }),
    ),
  });
}

export type CategorizeItem = {
  index: number;
  direction: "debit" | "credit";
  amountRupees: number;
  merchant: string | null;
  upiHandle: string | null;
  narration: string | null;
};

/** Redacted, compact payload: no account numbers, phone numbers or emails reach the model. */
export function categorizeData(categories: readonly string[], items: CategorizeItem[]): string {
  return JSON.stringify({
    categories,
    transactions: items.map((i) => ({
      index: i.index,
      direction: i.direction,
      amount_inr: i.amountRupees,
      merchant: redactForLlm(i.merchant),
      upi_handle: redactForLlm(i.upiHandle),
      narration: redactForLlm(i.narration),
    })),
  });
}
