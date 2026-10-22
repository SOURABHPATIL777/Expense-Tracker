import "server-only";
import { z } from "zod";
import { redactForLlm } from "@/backend/llm/redact";

/** Kinds the model may suggest. Own-account transfers, refunds and reversals are decided deterministically. */
export const LLM_KINDS = ["expense", "income", "reimbursable", "unknown"] as const;

export const CATEGORIZE_INSTRUCTIONS = `Classify each Indian UPI/bank transaction.
For every item return:
- index: the item's index
- category: exactly one name from the provided category list, or null if none fits
- kind: "expense" for personal spending, "income" for salary/interest/business income, "reimbursable" for spending clearly done on someone else's behalf, "unknown" if a credit could be a friend repaying (do not guess income for person-to-person credits)
- confidence: 0 to 1
Base the answer only on merchant, UPI handle and narration. Unknown merchants get low confidence.`;

export function categorizeSchema(categoryNames: readonly [string, ...string[]]) {
  return z.object({
    items: z.array(
      z.object({
        index: z.number().int().min(0),
        category: z.enum(categoryNames).nullable(),
        kind: z.enum(LLM_KINDS),
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
