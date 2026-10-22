"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { Button } from "@/frontend/components/Button/Button";
import { Select, optionsFrom } from "@/frontend/components/Select/Select";
import { DataTable, type Column } from "@/frontend/components/DataTable/DataTable";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { DateText } from "@/frontend/components/DateText/DateText";
import { StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { SplitEditor } from "@/frontend/components/SplitEditor/SplitEditor";
import { usePaginatedList } from "@/frontend/hooks/usePaginatedList";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { SHARED_EXPENSE_STATUSES } from "@/shared/constants/enums";
import { SHARED_EXPENSE_STATUS_LABELS } from "@/shared/constants/labels";
import type { SplitSummaryDto } from "@/shared/schemas/splits";
import styles from "./SplitsPage.module.css";

const columns: Column<SplitSummaryDto>[] = [
  {
    key: "title",
    header: "Expense",
    render: (s) => (
      <div className={styles.title}>
        <strong>{s.title}</strong>
        <span className={styles.muted}>
          {s.participantCount} people · {s.agreedCount}/{s.participantCount - 1} agreed
        </span>
      </div>
    ),
  },
  { key: "date", header: "Created", hideOnMobile: true, render: (s) => <DateText iso={s.createdAt} /> },
  { key: "total", header: "Total", align: "right", hideOnMobile: true, render: (s) => <MoneyText minor={s.totalMinor} /> },
  { key: "mine", header: "Your share", align: "right", hideOnMobile: true, render: (s) => <MoneyText minor={s.ownerShareMinor} /> },
  { key: "owed", header: "Still owed", align: "right", render: (s) => <MoneyText minor={s.outstandingMinor} strong={s.outstandingMinor > 0} /> },
  { key: "status", header: "", align: "right", render: (s) => <StatusBadge value={s.status} map={SHARED_EXPENSE_STATUS_LABELS} /> },
];

export default function SplitsPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const list = usePaginatedList<SplitSummaryDto>(API_ROUTES.splits, { status });

  return (
    <>
      <PageHeader
        title="Splits"
        description="Share a payment with friends. Each person gets a private link: they can agree and report paying you without signing up."
        actions={
          <>
            <Select aria-label="Status" placeholder="All" options={optionsFrom(SHARED_EXPENSE_STATUSES, SHARED_EXPENSE_STATUS_LABELS)} value={status} onChange={(e) => setStatus(e.target.value)} />
            <Button onClick={() => setCreating(true)}>New split</Button>
          </>
        }
      />
      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={list.rows}
          rowKey={(s) => s.id}
          loading={list.loading}
          error={list.error}
          onRowClick={(s) => router.push(PAGE_ROUTES.split(s.id))}
          empty={{
            title: "No splits yet",
            description: "Open a payment on the Transactions page and choose “Split this payment”, or create one here for cash.",
          }}
          pagination={{ page: list.page, pageSize: list.pageSize, total: list.total, onPageChange: list.setPage }}
        />
      </Card>
      {creating && <SplitEditor open onClose={() => setCreating(false)} onSaved={(s) => router.push(PAGE_ROUTES.split(s.id))} />}
    </>
  );
}
