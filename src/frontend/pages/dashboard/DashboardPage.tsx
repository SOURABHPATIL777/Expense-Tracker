"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { StatCard } from "@/frontend/components/StatCard/StatCard";
import { Select } from "@/frontend/components/Select/Select";
import { BarList } from "@/frontend/components/BarList/BarList";
import { Alert } from "@/frontend/components/Alert/Alert";
import { EmptyState } from "@/frontend/components/EmptyState/EmptyState";
import { ButtonLink } from "@/frontend/components/Button/Button";
import { DateText } from "@/frontend/components/DateText/DateText";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { useApi } from "@/frontend/hooks/useApi";
import { useMutation } from "@/frontend/hooks/useMutation";
import { Button } from "@/frontend/components/Button/Button";
import { formatInr } from "@/frontend/lib/format";
import { api, withQuery } from "@/frontend/lib/apiClient";
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from "@/frontend/lib/periods";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import type { OverviewDto, SummaryDto } from "@/shared/schemas/reports";
import styles from "./DashboardPage.module.css";

export default function DashboardPage() {
  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const range = periodRange(period);
  const overview = useApi<OverviewDto>(API_ROUTES.reports.overview, range);
  const d = overview.data;
  const t = d?.totals;
  const [summary, setSummary] = useState<SummaryDto & { key: string }>();
  const rangeKey = `${range.from}|${range.to}`;
  const explain = useMutation(
    async () => {
      const { data } = await api.post<SummaryDto>(API_ROUTES.reports.summary, range);
      setSummary({ ...data, key: rangeKey });
    },
    { toastErrors: false },
  );
  const txLink = (extra: Record<string, string>) => withQuery(PAGE_ROUTES.transactions, { from: range.from, to: range.to, ...extra });

  return (
    <>
      <PageHeader
        title="Your spending"
        description="What you actually spent, separate from transfers between your own accounts and money others owe you."
        actions={<Select aria-label="Period" options={PERIOD_OPTIONS} value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} />}
      />
      {overview.error && <Alert tone="danger">{overview.error.message}</Alert>}
      {!d || !t ? (
        <Skeleton lines={8} />
      ) : t.transactionCount === 0 && d.sources.length === 0 ? (
        <Card>
          <EmptyState
            title="No transactions yet"
            description="Import a PhonePe, Google Pay, Paytm or bank statement to see your real spending."
            action={<ButtonLink href={PAGE_ROUTES.imports}>Import a statement</ButtonLink>}
          />
        </Card>
      ) : (
        <div className={styles.stack}>
          <div className={styles.kpis}>
            <StatCard label="Your personal spending" value={formatInr(t.personalExpenseMinor)} tone="info" hint="Your share only" />
            <StatCard label="Money that left your accounts" value={formatInr(t.cashOutflowMinor)} hint="All successful payments" />
            <StatCard label="Paid for others" value={formatInr(t.othersShareMinor)} tone={t.othersShareMinor ? "warning" : "neutral"} hint="Split shares + reimbursable" />
            <StatCard label="Moved between your accounts" value={formatInr(t.ownTransfersMinor)} hint="Own transfers & card bills" />
          </div>
          <div className={styles.kpis}>
            <StatCard label="Income" value={formatInr(t.incomeMinor)} tone="success" />
            <StatCard label="Refunds received" value={formatInr(t.refundsReceivedMinor)} tone="success" />
            <StatCard label="Owed to you" value={formatInr(d.owedToYouMinor)} tone={d.owedToYouMinor ? "warning" : "neutral"} hint="Across open splits" />
            <StatCard
              label="Money expected back"
              value={formatInr(d.refunds.expectedMinor)}
              tone={d.refunds.overdueCount ? "danger" : d.refunds.openCount ? "warning" : "neutral"}
              hint={d.refunds.openCount ? `${d.refunds.openCount} refund${d.refunds.openCount > 1 ? "s" : ""} waiting${d.refunds.suggestedCount ? `, ${d.refunds.suggestedCount} possible match` : ""}` : "Nothing pending"}
            />
          </div>

          <Card
            title="In plain words"
            description="An AI explanation of the totals above. It never calculates; every figure comes from your data."
            actions={
              <Button variant="secondary" size="sm" onClick={() => explain.run()} loading={explain.pending}>
                {summary?.key === rangeKey ? "Refresh" : "Explain this period"}
              </Button>
            }
          >
            {explain.error ? (
              <Alert tone="warning">
                {explain.error.message} {explain.error.code.startsWith("LLM") && <Link href={PAGE_ROUTES.settingsAi}>Set up the summary model</Link>}
              </Alert>
            ) : summary?.key === rangeKey ? (
              <div className={styles.summary}>
                <p className={styles.headline}>{summary.headline}</p>
                <ul>
                  {summary.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={styles.muted}>Optional. Uses the model you chose for “Monthly summary” in AI settings.</p>
            )}
          </Card>

          <div className={styles.columns}>
            <Card title="Spending by category" description="Your personal share, successful payments only.">
              {d.categories.length ? (
                <BarList
                  label="Spending by category"
                  formatValue={formatInr}
                  items={d.categories.map((c) => ({
                    key: c.categoryId ?? "none",
                    label: c.name,
                    value: c.totalMinor,
                    dotColor: c.color,
                    detail: `${c.count} payment${c.count === 1 ? "" : "s"}`,
                  }))}
                />
              ) : (
                <EmptyState title="No spending in this period" />
              )}
            </Card>

            <Card title="Data status" description="How complete these numbers are.">
              <ul className={styles.status}>
                {d.sources.map((s) => (
                  <li key={s.sourceApp}>
                    <span>{SOURCE_APP_LABELS[s.sourceApp]}</span>
                    <span className={styles.muted}>
                      {s.coveredUntil ? (
                        <>
                          up to <DateText iso={s.coveredUntil} />
                        </>
                      ) : (
                        <>
                          imported <DateText iso={s.lastImportedAt} />
                        </>
                      )}
                    </span>
                  </li>
                ))}
                {d.openReviewCount > 0 && (
                  <li>
                    <Link href={PAGE_ROUTES.review}>{d.openReviewCount} item{d.openReviewCount > 1 ? "s" : ""} need review</Link>
                  </li>
                )}
                {t.uncategorizedCount > 0 && (
                  <li>
                    <Link href={txLink({ categoryId: "none", kind: "expense" })}>{t.uncategorizedCount} uncategorised payments</Link>
                  </li>
                )}
                {t.unclassifiedOutflowMinor > 0 && (
                  <li>
                    <Link href={txLink({ kind: "unknown", direction: "debit" })}>{formatInr(t.unclassifiedOutflowMinor)} paid out, not yet classified</Link>
                  </li>
                )}
                {t.unclassifiedInflowMinor > 0 && (
                  <li>
                    <Link href={txLink({ kind: "unknown", direction: "credit" })}>{formatInr(t.unclassifiedInflowMinor)} received, not yet classified</Link>
                    <span className={styles.muted}>friend repayment, refund or income?</span>
                  </li>
                )}
                {t.failedOrPendingCount > 0 && (
                  <li>
                    <Link href={txLink({ status: "failed" })}>{t.failedOrPendingCount} failed or pending payments</Link>
                    <span className={styles.muted}>not counted in totals</span>
                  </li>
                )}
              </ul>
              <div className={styles.cta}>
                <ButtonLink href={PAGE_ROUTES.imports} variant="secondary" size="sm">
                  Import newer statements
                </ButtonLink>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
