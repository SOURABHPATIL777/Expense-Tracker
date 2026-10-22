import "server-only";
import type { RuleField } from "@/backend/constants/enums.constants";

type CounterpartyFields = { counterparty_vpa: string | null; merchant_normalized: string | null };

/** Column holding each rule field's value on a transaction. */
export const COUNTERPARTY_COLUMN = { vpa: "counterparty_vpa", merchant: "merchant_normalized" } as const satisfies Partial<Record<RuleField, string>>;

export type CounterpartyKey = { field: keyof typeof COUNTERPARTY_COLUMN; value: string };

/**
 * Who the money went to or came from, precisely enough to treat "the same counterparty" alike:
 * the UPI ID / account handle when the statement has one, otherwise the cleaned-up merchant name.
 */
export function counterpartyKey(t: CounterpartyFields): CounterpartyKey | null {
  const vpa = t.counterparty_vpa?.trim().toLowerCase();
  if (vpa) return { field: "vpa", value: vpa };
  const merchant = t.merchant_normalized?.trim();
  if (merchant && merchant.length >= 2) return { field: "merchant", value: merchant };
  return null;
}
