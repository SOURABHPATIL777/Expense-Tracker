import "server-only";
import { SALARY_HINT, SALARY_PATTERNS } from "@/backend/constants/app.constants";
import type { Direction } from "@/backend/constants/enums.constants";
import { counterpartyKey } from "./counterparty";

type SalaryFields = {
  direction: Direction;
  status: string;
  narration: string | null;
  merchant_raw: string | null;
  merchant_normalized: string | null;
};

/** A successful credit whose statement text says it's salary (SALARY, SAL, PAYROLL, …). */
export function looksLikeSalary(t: SalaryFields): boolean {
  if (t.direction !== "credit" || t.status !== "success") return false;
  const text = [t.narration, t.merchant_raw, t.merchant_normalized].filter(Boolean).join(" ");
  return SALARY_PATTERNS.some((p) => p.test(text));
}

type CreditFields = { id: string; amount_minor: number; occurred_at: string; counterparty_vpa: string | null; merchant_normalized: string | null };

/**
 * How many earlier credits from the same payer had a similar amount: monthly salary shows up as a
 * small repeating count. Pure; `history` is the user's recent credits.
 */
export function similarEarlierCredits(t: CreditFields & { direction: Direction }, history: readonly CreditFields[]): number {
  if (t.direction !== "credit") return 0;
  const key = counterpartyKey(t);
  if (!key) return 0;
  const tolerance = t.amount_minor * SALARY_HINT.AMOUNT_TOLERANCE;
  return history.filter((h) => {
    if (h.id === t.id || h.occurred_at >= t.occurred_at) return false;
    const other = counterpartyKey(h);
    return other?.field === key.field && other.value === key.value && Math.abs(h.amount_minor - t.amount_minor) <= tolerance;
  }).length;
}
