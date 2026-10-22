"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { DataTable, type Column } from "@/frontend/components/DataTable/DataTable";
import { FilterBar } from "@/frontend/components/FilterBar/FilterBar";
import { Select, optionsFrom } from "@/frontend/components/Select/Select";
import { TextInput } from "@/frontend/components/TextInput/TextInput";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { DateText } from "@/frontend/components/DateText/DateText";
import { CategoryChip } from "@/frontend/components/CategoryChip/CategoryChip";
import { Badge, StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { TransactionDetailModal } from "@/frontend/components/TransactionDetailModal/TransactionDetailModal";
import { usePaginatedList } from "@/frontend/hooks/usePaginatedList";
import { useCategories } from "@/frontend/hooks/useCategories";
import { useFilters } from "@/frontend/hooks/useFilters";
import { API_ROUTES } from "@/shared/constants/routes";
import { DIRECTIONS, SOURCE_APPS, TRANSACTION_KINDS, TRANSACTION_STATUSES, type SourceApp } from "@/shared/constants/enums";
import { SOURCE_APP_LABELS, TRANSACTION_KIND_LABELS, TRANSACTION_STATUS_LABELS } from "@/shared/constants/labels";
import type { TransactionDto } from "@/shared/schemas/transactions";
import styles from "./TransactionsPage.module.css";

const DIRECTION_OPTIONS = DIRECTIONS.map((d) => ({ value: d, label: d === "debit" ? "Money out" : "Money in" }));

const EMPTY_FILTERS = { search: "", from: "", to: "", direction: "", kind: "", status: "", categoryId: "", sourceApp: "", review: "" };

export default function TransactionsPage() {
  const params = useSearchParams();
  // Deep links from the dashboard (e.g. ?categoryId=none&from=…) seed the filters once.
  const initial = useMemo(() => ({ ...EMPTY_FILTERS, ...Object.fromEntries([...params.entries()].filter(([k]) => k in EMPTY_FILTERS)) }), [params]);
  const { filters, set, reset } = useFilters<typeof EMPTY_FILTERS>(initial);
  const list = usePaginatedList<TransactionDto>(API_ROUTES.transactions, filters);
  const cats = useCategories();
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<TransactionDto>[] = [
    { key: "date", header: "Date", width: "8rem", render: (t) => <DateText iso={t.occurredAt} /> },
    {
      key: "merchant",
      header: "Merchant",
      render: (t) => (
        <div className={styles.merchant}>
          <span className={styles.name}>{t.merchant ?? t.narration ?? "—"}</span>
          <span className={styles.sub}>
            {SOURCE_APP_LABELS[t.sourceApp as SourceApp] ?? t.sourceApp}
            {t.reconciliation === "reconciled" && " · matched across sources"}
          </span>
        </div>
      ),
    },
    { key: "category", header: "Category", hideOnMobile: true, render: (t) => <CategoryChip category={t.categoryId ? cats.byId.get(t.categoryId) : null} /> },
    {
      key: "kind",
      header: "Counts as",
      hideOnMobile: true,
      render: (t) => (
        <div className={styles.badges}>
          <StatusBadge value={t.kind} map={TRANSACTION_KIND_LABELS} />
          {t.status !== "success" && <StatusBadge value={t.status} map={TRANSACTION_STATUS_LABELS} />}
          {t.reviewStatus === "needs_review" && <Badge tone="warning">Review</Badge>}
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", render: (t) => <MoneyText minor={t.amountMinor} direction={t.direction} muted={t.status === "failed"} /> },
  ];

  return (
    <>
      <PageHeader title="Transactions" description="Click any row to fix its category or type. Your changes are remembered for that merchant." />
      <Card padded={false}>
        <FilterBar onReset={reset}>
          <TextInput label="Search" placeholder="Merchant, UPI ID or UTR" value={filters.search} onChange={(e) => set("search", e.target.value)} />
          <TextInput label="From" type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />
          <TextInput label="To" type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />
          <Select label="Direction" placeholder="All" options={DIRECTION_OPTIONS} value={filters.direction} onChange={(e) => set("direction", e.target.value)} />
          <Select label="Counts as" placeholder="All" options={optionsFrom(TRANSACTION_KINDS, TRANSACTION_KIND_LABELS)} value={filters.kind} onChange={(e) => set("kind", e.target.value)} />
          <Select label="Category" placeholder="All" options={[{ value: "none", label: "Uncategorised" }, ...cats.options]} value={filters.categoryId} onChange={(e) => set("categoryId", e.target.value)} />
          <Select label="Status" placeholder="All" options={optionsFrom(TRANSACTION_STATUSES, TRANSACTION_STATUS_LABELS)} value={filters.status} onChange={(e) => set("status", e.target.value)} />
          <Select label="Source" placeholder="All" options={optionsFrom(SOURCE_APPS, SOURCE_APP_LABELS)} value={filters.sourceApp} onChange={(e) => set("sourceApp", e.target.value)} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={list.rows}
          rowKey={(t) => t.id}
          loading={list.loading}
          error={list.error}
          onRowClick={(t) => setOpenId(t.id)}
          empty={{ title: "No transactions match", description: "Import a statement or change the filters." }}
          pagination={{ page: list.page, pageSize: list.pageSize, total: list.total, onPageChange: list.setPage }}
        />
      </Card>
      <TransactionDetailModal id={openId} categoryOptions={cats.options} onClose={() => setOpenId(null)} onChanged={list.reload} />
    </>
  );
}
