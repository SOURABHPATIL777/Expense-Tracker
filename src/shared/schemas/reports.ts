import { z } from "zod";
import type { SourceApp } from "../constants/enums";
import { isoDateSchema } from "./common";

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

export const reportRangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((v) => v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / DAY_MS <= MAX_RANGE_DAYS, { message: "Choose a range of a year or less", path: ["to"] });
export type ReportRange = z.infer<typeof reportRangeSchema>;

export type OverviewTotalsDto = {
  /** Every successful debit: what actually left your accounts. */
  cashOutflowMinor: number;
  /** Your own share of spending (excludes transfers, card bills, others' shares). */
  personalExpenseMinor: number;
  /** Paid by you on behalf of others (split shares + reimbursable). */
  othersShareMinor: number;
  ownTransfersMinor: number;
  unclassifiedOutflowMinor: number;
  incomeMinor: number;
  refundsReceivedMinor: number;
  unclassifiedInflowMinor: number;
  uncategorizedCount: number;
  failedOrPendingCount: number;
  transactionCount: number;
};

export type CategoryTotalDto = { categoryId: string | null; name: string; color: string | null; totalMinor: number; count: number };

export type SourceStatusDto = { sourceApp: SourceApp; lastImportedAt: string; coveredUntil: string | null };

export type OverviewDto = {
  range: ReportRange;
  totals: OverviewTotalsDto;
  categories: CategoryTotalDto[];
  refunds: { expectedMinor: number; openCount: number; suggestedCount: number; overdueCount: number };
  /** Still owed to you across open splits (not limited to the period). */
  owedToYouMinor: number;
  openReviewCount: number;
  sources: SourceStatusDto[];
};

export type SummaryDto = { headline: string; points: string[]; generatedAt: string };
