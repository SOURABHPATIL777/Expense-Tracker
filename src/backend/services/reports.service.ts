import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { unwrap } from "@/backend/errors/AppError";
import { RPC } from "@/backend/constants/db.constants";
import { CategoriesRepository } from "@/backend/repositories/categorization.repository";
import { ImportsRepository } from "@/backend/repositories/imports.repository";
import { RefundsRepository } from "@/backend/repositories/refunds.repository";
import { istDateRange, todayIst } from "@/backend/domain/period";
import { reviewService } from "./review.service";
import { splitsService } from "./splits.service";
import { runLlmTask } from "@/backend/llm/run";
import { SUMMARY_INSTRUCTIONS, summaryData, summarySchema } from "@/backend/llm/prompts/summary";
import { REPORTS } from "@/backend/constants/app.constants";
import type { CategoryTotalDto, OverviewDto, OverviewTotalsDto, ReportRange, SourceStatusDto, SummaryDto } from "@/shared/schemas/reports";
import type { SourceApp } from "@/shared/constants/enums";

const RECENT_IMPORTS = 100;

type OverviewRow = {
  cash_outflow: number;
  personal_expense: number;
  others_share: number;
  own_transfers: number;
  unclassified_outflow: number;
  income: number;
  refunds_received: number;
  unclassified_inflow: number;
  uncategorized_count: number;
  failed_or_pending_count: number;
  transaction_count: number;
};

const toTotals = (r: OverviewRow): OverviewTotalsDto => ({
  cashOutflowMinor: Number(r.cash_outflow),
  personalExpenseMinor: Number(r.personal_expense),
  othersShareMinor: Number(r.others_share),
  ownTransfersMinor: Number(r.own_transfers),
  unclassifiedOutflowMinor: Number(r.unclassified_outflow),
  incomeMinor: Number(r.income),
  refundsReceivedMinor: Number(r.refunds_received),
  unclassifiedInflowMinor: Number(r.unclassified_inflow),
  uncategorizedCount: Number(r.uncategorized_count),
  failedOrPendingCount: Number(r.failed_or_pending_count),
  transactionCount: Number(r.transaction_count),
});

/** Every number here comes from SQL aggregates over successful transactions. */
export function reportsService(db: Db) {
  async function totals(range: ReportRange): Promise<OverviewTotalsDto> {
    const { fromIso, toIso } = istDateRange(range.from, range.to);
    return toTotals(unwrap(await db.rpc(RPC.REPORT_OVERVIEW, { p_from: fromIso, p_to: toIso }), "reports.overview") as OverviewRow);
  }

  async function categories(userId: string, range: ReportRange): Promise<CategoryTotalDto[]> {
    const { fromIso, toIso } = istDateRange(range.from, range.to);
    const [rows, cats] = await Promise.all([
      db.rpc(RPC.REPORT_CATEGORY_BREAKDOWN, { p_from: fromIso, p_to: toIso }),
      new CategoriesRepository(db).listAll(userId),
    ]);
    const byId = new Map(cats.map((c) => [c.id, c]));
    return (unwrap(rows, "reports.categories") as Array<{ category_id: string | null; total_minor: number; tx_count: number }>).map((r) => ({
      categoryId: r.category_id,
      name: r.category_id ? (byId.get(r.category_id)?.name ?? "Deleted category") : "Uncategorised",
      color: r.category_id ? (byId.get(r.category_id)?.color ?? null) : null,
      totalMinor: Number(r.total_minor),
      count: Number(r.tx_count),
    }));
  }

  /** Latest completed import per source, so users can see how current their numbers are. */
  async function sources(userId: string): Promise<SourceStatusDto[]> {
    const { rows } = await new ImportsRepository(db).list(userId, { page: 1, pageSize: RECENT_IMPORTS }, (q) => q.eq("status", "completed"));
    const latest = new Map<string, SourceStatusDto>();
    for (const r of rows) {
      if (!r.source_app || latest.has(r.source_app)) continue;
      latest.set(r.source_app, { sourceApp: r.source_app as SourceApp, lastImportedAt: r.completed_at ?? r.created_at, coveredUntil: r.period_end });
    }
    return [...latest.values()];
  }

  async function refundsSummary(userId: string) {
    const waiting = await new RefundsRepository(db).listWaiting(userId);
    const today = todayIst();
    return {
      expectedMinor: waiting.reduce((sum, r) => sum + r.expected_amount_minor, 0),
      openCount: waiting.length,
      suggestedCount: waiting.filter((r) => r.status === "suggested").length,
      overdueCount: waiting.filter((r) => r.expected_by && r.expected_by < today).length,
    };
  }

  return {
    totals,
    categories,

    /** AI-written explanation of SQL-computed totals; it receives formatted figures, never raw transactions. */
    async summary(userId: string, range: ReportRange): Promise<SummaryDto> {
      const [t, c] = await Promise.all([totals(range), categories(userId, range)]);
      const out = await runLlmTask({
        userId,
        task: "monthly_summary",
        schema: summarySchema,
        instructions: SUMMARY_INSTRUCTIONS,
        data: summaryData(range, t, c, REPORTS.TOP_CATEGORIES),
      });
      return { ...out, generatedAt: new Date().toISOString() };
    },
    async overview(userId: string, range: ReportRange): Promise<OverviewDto> {
      const [t, c, refunds, openReviewCount, s, owedToYouMinor] = await Promise.all([
        totals(range),
        categories(userId, range),
        refundsSummary(userId),
        reviewService(db).openCount(userId),
        sources(userId),
        splitsService(db).owedToYou(userId),
      ]);
      return { range, totals: t, categories: c, refunds, owedToYouMinor, openReviewCount, sources: s };
    },
  };
}
