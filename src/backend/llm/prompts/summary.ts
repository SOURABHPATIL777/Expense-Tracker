import "server-only";
import { z } from "zod";
import { formatInr } from "@/shared/utils/money";
import type { CategoryTotalDto, OverviewTotalsDto, ReportRange } from "@/shared/schemas/reports";

export const SUMMARY_INSTRUCTIONS = `Explain a person's spending for the period in plain, friendly English (Indian context, rupees).
You receive totals that were already calculated exactly. Never compute, estimate or invent any number:
quote only figures that appear in the data, exactly as written. No financial advice, no judgement.
Return a one-line headline and up to four short points (for example the biggest categories, money paid for others,
own-account transfers kept out of spending, and anything still unclassified that makes the totals incomplete).`;

export const summarySchema = z.object({
  headline: z.string().min(1).max(160),
  points: z.array(z.string().min(1).max(240)).max(4),
});

/** Pre-formatted figures only: the model explains, it never does arithmetic. */
export function summaryData(range: ReportRange, t: OverviewTotalsDto, categories: CategoryTotalDto[], topN: number): string {
  return JSON.stringify({
    period: `${range.from} to ${range.to}`,
    personal_spending: formatInr(t.personalExpenseMinor),
    all_money_out: formatInr(t.cashOutflowMinor),
    paid_for_others: formatInr(t.othersShareMinor),
    moved_between_own_accounts_and_card_bills: formatInr(t.ownTransfersMinor),
    income: formatInr(t.incomeMinor),
    refunds_received: formatInr(t.refundsReceivedMinor),
    paid_out_not_yet_classified: formatInr(t.unclassifiedOutflowMinor),
    received_not_yet_classified: formatInr(t.unclassifiedInflowMinor),
    failed_or_pending_payments: t.failedOrPendingCount,
    top_categories: categories.slice(0, topN).map((c) => ({ category: c.name, amount: formatInr(c.totalMinor), payments: c.count })),
  });
}
