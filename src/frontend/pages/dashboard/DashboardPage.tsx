"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/frontend/components/Card/Card";
import { StatCard } from "@/frontend/components/StatCard/StatCard";
import { SegmentedControl } from "@/frontend/components/SegmentedControl/SegmentedControl";
import { DonutChart } from "@/frontend/components/DonutChart/DonutChart";
import { OTHER_KEY } from "@/frontend/components/DonutChart/geometry";
import { Alert } from "@/frontend/components/Alert/Alert";
import { EmptyState } from "@/frontend/components/EmptyState/EmptyState";
import { Button, ButtonLink } from "@/frontend/components/Button/Button";
import { DateText } from "@/frontend/components/DateText/DateText";
import { Icon } from "@/frontend/components/Icon/Icon";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { useApi } from "@/frontend/hooks/useApi";
import { useMutation } from "@/frontend/hooks/useMutation";
import { formatInr } from "@/frontend/lib/format";
import { api, withQuery } from "@/frontend/lib/apiClient";
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from "@/frontend/lib/periods";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import type { OverviewDto, OverviewTotalsDto, SummaryDto } from "@/shared/schemas/reports";
import styles from "./DashboardPage.module.css";

/** Where the money that left your accounts went. Fixed order, so each part keeps its colour. */
const outflowParts = (t: OverviewTotalsDto) => [
  { key: "personal", label: "Your spending", value: t.personalExpenseMinor, color: "var(--chart-1)" },
  { key: "others", label: "Paid for others", value: t.othersShareMinor, color: "var(--chart-2)" },
  { key: "own", label: "Own transfers & card bills", value: t.ownTransfersMinor, color: "var(--chart-3)" },
  { key: "unknown", label: "Not yet classified", value: t.unclassifiedOutflowMinor, color: "var(--chart-4)" },
];

const OUTFLOW_FILTERS: Record<string, Record<string, string>> = {
  personal: { kind: "expense" },
  own: { kind: "self_transfer" },
  unknown: { kind: "unknown", direction: "debit" },
};

export default function DashboardPage() {
  const router = useRouter();
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
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label.toLowerCase() ?? "";

  const periodPicker = <SegmentedControl label="Period" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} onBrand />;

  if (overview.error) return <Alert tone="danger">{overview.error.message}</Alert>;
  if (!d || !t) {
    return (
      <div className={styles.stack}>
        <div className={styles.heroSkeleton} />
        <Skeleton lines={8} />
      </div>
    );
  }

  if (t.transactionCount === 0 && d.sources.length === 0) {
    return (
      <div className={styles.stack}>
        <section className={styles.hero}>
          <p className={styles.heroEyebrow}>Welcome</p>
          <h1 className={styles.heroTitle}>See what you really spend</h1>
          <p className={styles.heroSub}>Import a PhonePe, Google Pay, Paytm or bank statement. Transfers, card bills and money friends owe you are kept apart.</p>
          <div className={styles.heroActions}>
            <ButtonLink href={PAGE_ROUTES.imports} variant="secondary" className={styles.heroButton}>
              <Icon name="upload" size={18} /> Import statements
            </ButtonLink>
          </div>
        </section>
      </div>
    );
  }

  const checklist = [
    d.openReviewCount > 0 && { href: PAGE_ROUTES.review, text: `${d.openReviewCount} item${d.openReviewCount > 1 ? "s" : ""} need review`, tone: "warning" },
    t.uncategorizedCount > 0 && { href: txLink({ categoryId: "none", kind: "expense" }), text: `${t.uncategorizedCount} uncategorised payment${t.uncategorizedCount > 1 ? "s" : ""}`, tone: "info" },
    t.unclassifiedInflowMinor > 0 && { href: txLink({ kind: "unknown", direction: "credit" }), text: `${formatInr(t.unclassifiedInflowMinor)} received, not yet classified`, tone: "info" },
    t.failedOrPendingCount > 0 && { href: txLink({ status: "failed" }), text: `${t.failedOrPendingCount} failed or pending (not counted)`, tone: "neutral" },
  ].filter(Boolean) as Array<{ href: string; text: string; tone: string }>;

  return (
    <div className={styles.stack}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>{periodPicker}</div>
        <p className={styles.heroEyebrow}>You spent {periodLabel}</p>
        <p className={`${styles.heroAmount} tabular`}>{formatInr(t.personalExpenseMinor)}</p>
        <p className={styles.heroSub}>
          Your own share. {formatInr(t.cashOutflowMinor)} left your accounts in total.
        </p>
        <div className={styles.chips}>
          <span className={styles.chip}>
            <Icon name="arrowDown" size={14} /> Income <strong className="tabular">{formatInr(t.incomeMinor)}</strong>
          </span>
          <span className={styles.chip}>
            <Icon name="refund" size={14} /> Refunds <strong className="tabular">{formatInr(t.refundsReceivedMinor)}</strong>
          </span>
          <span className={styles.chip}>
            <Icon name="users" size={14} /> Owed to you <strong className="tabular">{formatInr(d.owedToYouMinor)}</strong>
          </span>
        </div>
      </section>

      {overview.stale && <p className={styles.muted}>Showing the last loaded numbers. Reconnecting…</p>}

      {checklist.length > 0 && (
        <ul className={styles.todo} aria-label="Things to check">
          {checklist.map((c) => (
            <li key={c.text}>
              <Link href={c.href} className={styles.todoItem} data-tone={c.tone}>
                <Icon name="alert" size={16} />
                <span>{c.text}</span>
                <Icon name="chevronRight" size={16} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.charts}>
        <Card title="Spending by category" description="Your share of successful payments. Tap a category to see its payments.">
          {d.categories.length ? (
            <DonutChart
              label="Spending by category"
              formatValue={formatInr}
              centerLabel="Spent"
              items={d.categories.map((c) => ({ key: c.categoryId ?? "none", label: c.name, value: c.totalMinor, color: c.color }))}
              onSelect={(key) => key !== OTHER_KEY && router.push(txLink({ categoryId: key }))}
            />
          ) : (
            <EmptyState icon="pie" title="No spending in this period" />
          )}
        </Card>

        <Card title="Where your money went" description="Everything that left your accounts, split by what it was.">
          {t.cashOutflowMinor > 0 ? (
            <DonutChart
              label="Where your money went"
              formatValue={formatInr}
              centerLabel="Money out"
              items={outflowParts(t)}
              onSelect={(key) => OUTFLOW_FILTERS[key] && router.push(txLink(OUTFLOW_FILTERS[key]))}
            />
          ) : (
            <EmptyState icon="pie" title="No payments in this period" />
          )}
        </Card>
      </div>

      <div className={styles.kpis}>
        <StatCard label="Paid for others" value={formatInr(t.othersShareMinor)} tone={t.othersShareMinor ? "warning" : "neutral"} hint="Split shares + reimbursable" />
        <StatCard label="Between your accounts" value={formatInr(t.ownTransfersMinor)} hint="Own transfers & card bills" />
        <StatCard label="Owed to you" value={formatInr(d.owedToYouMinor)} tone={d.owedToYouMinor ? "warning" : "neutral"} hint="Across open splits" />
        <StatCard
          label="Refunds expected"
          value={formatInr(d.refunds.expectedMinor)}
          tone={d.refunds.overdueCount ? "danger" : d.refunds.openCount ? "warning" : "neutral"}
          hint={d.refunds.openCount ? `${d.refunds.openCount} waiting${d.refunds.suggestedCount ? `, ${d.refunds.suggestedCount} possible match` : ""}` : "Nothing pending"}
        />
      </div>

      <div className={styles.columns}>
        <Card
          title={
            <span className={styles.aiTitle}>
              <Icon name="sparkles" size={18} /> In plain words
            </span>
          }
          description="An AI explanation of these totals. Every figure comes from your data."
          actions={
            <Button variant="secondary" size="sm" onClick={() => explain.run()} loading={explain.pending}>
              {summary?.key === rangeKey ? "Refresh" : "Explain"}
            </Button>
          }
        >
          {explain.error ? (
            <Alert tone="warning">{explain.error.message}</Alert>
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
            <p className={styles.muted}>Tap Explain for a short summary of this period.</p>
          )}
        </Card>

        <Card title="Your statements" description="How up to date these numbers are.">
          <ul className={styles.sources}>
            {d.sources.map((s) => (
              <li key={s.sourceApp}>
                <span className={styles.sourceIcon} aria-hidden>
                  <Icon name="file" size={16} />
                </span>
                <span className={styles.sourceName}>{SOURCE_APP_LABELS[s.sourceApp]}</span>
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
          </ul>
          <div className={styles.cta}>
            <ButtonLink href={PAGE_ROUTES.imports} variant="secondary" size="sm">
              <Icon name="upload" size={16} /> Import newer statements
            </ButtonLink>
          </div>
        </Card>
      </div>
    </div>
  );
}
