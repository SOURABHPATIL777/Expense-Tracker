"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { Button } from "@/frontend/components/Button/Button";
import { StatCard } from "@/frontend/components/StatCard/StatCard";
import { StatusBadge, Badge } from "@/frontend/components/StatusBadge/StatusBadge";
import { DataTable, type Column } from "@/frontend/components/DataTable/DataTable";
import { DateText } from "@/frontend/components/DateText/DateText";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { Alert } from "@/frontend/components/Alert/Alert";
import { Form } from "@/frontend/components/Form/Form";
import { FormField } from "@/frontend/components/Form/FormField";
import { Select } from "@/frontend/components/Select/Select";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { ConfirmDialog } from "@/frontend/components/ConfirmDialog/ConfirmDialog";
import { ColumnMapper } from "@/frontend/components/ColumnMapper/ColumnMapper";
import { useApi } from "@/frontend/hooks/useApi";
import { usePaginatedList } from "@/frontend/hooks/usePaginatedList";
import { usePolling } from "@/frontend/hooks/usePolling";
import { useMutation } from "@/frontend/hooks/useMutation";
import { api } from "@/frontend/lib/apiClient";
import { formatDate } from "@/frontend/lib/format";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { IMPORT_STATUS_LABELS, SOURCE_APP_LABELS, type LabelMap } from "@/shared/constants/labels";
import { SOURCE_CONFIG } from "@/shared/constants/sources";
import type { ImportStatus } from "@/shared/constants/enums";
import { passwordSchema, type ImportDto, type ImportRowDto } from "@/shared/schemas/imports";
import styles from "./ImportReviewPage.module.css";

const IN_PROGRESS = new Set<ImportStatus>(["uploaded", "queued", "parsing", "processing"]);

const ROW_STATUS_LABELS: LabelMap<string> = {
  pending: { label: "Waiting", tone: "neutral" },
  accepted: { label: "New", tone: "success" },
  linked: { label: "Matched existing", tone: "info" },
  duplicate: { label: "Already imported", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  rejected: { label: "Couldn't read", tone: "danger" },
};

const ROW_FILTERS = [
  { value: "accepted", label: "New" },
  { value: "linked", label: "Matched existing" },
  { value: "duplicate", label: "Already imported" },
  { value: "rejected", label: "Couldn't read" },
];

const rowColumns: Column<ImportRowDto>[] = [
  { key: "row", header: "#", width: "3.5rem", render: (r) => r.rowIndex + 1 },
  { key: "date", header: "Date", render: (r) => <DateText iso={r.occurredAt} /> },
  { key: "who", header: "Details", render: (r) => r.counterparty ?? r.error ?? "—" },
  { key: "ref", header: "UTR", hideOnMobile: true, render: (r) => r.reference ?? "—" },
  { key: "amount", header: "Amount", align: "right", render: (r) => (r.amountMinor !== null ? <MoneyText minor={r.amountMinor} direction={r.direction ?? undefined} /> : "—") },
  { key: "status", header: "Result", align: "right", render: (r) => <StatusBadge value={r.status} map={ROW_STATUS_LABELS} /> },
];

export default function ImportReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [rowFilter, setRowFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const imp = useApi<ImportDto>(API_ROUTES.import(id));
  const rows = usePaginatedList<ImportRowDto>(API_ROUTES.importRows(id), { status: rowFilter });
  const inProgress = imp.data ? IN_PROGRESS.has(imp.data.status) : true;

  usePolling(imp.reload, inProgress);
  usePolling(rows.reload, inProgress, 4000);

  const remove = useMutation(() => api.del(API_ROUTES.import(id)), {
    successMessage: "Import deleted",
    onSuccess: () => router.replace(PAGE_ROUTES.imports),
  });

  if (imp.error) return <Alert tone="danger">{imp.error.message}</Alert>;
  if (!imp.data) return <Skeleton lines={6} />;
  const d = imp.data;
  const source = SOURCE_CONFIG[d.sourceApp];
  const refresh = () => {
    imp.reload();
    rows.reload();
  };

  return (
    <>
      <PageHeader
        title={d.fileName}
        description={
          <>
            {SOURCE_APP_LABELS[d.sourceApp]}
            {d.periodStart && ` · ${formatDate(d.periodStart)} – ${formatDate(d.periodEnd)}`}
          </>
        }
        actions={
          <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
            Delete import
          </Button>
        }
      />

      <div className={styles.stack}>
        <div className={styles.statusLine}>
          <StatusBadge value={d.status} map={IMPORT_STATUS_LABELS} />
          {d.presetLabel && <span className={styles.muted}>Read as: {d.presetLabel}</span>}
          {d.presetVerified === false && <Badge tone="warning">Layout not yet verified, please check the rows</Badge>}
        </div>

        {d.errorMessage && <Alert tone={d.status === "failed" ? "danger" : "warning"}>{d.errorMessage}</Alert>}

        <div className={styles.stats}>
          <StatCard label="New transactions" value={d.counts.imported} tone="success" />
          <StatCard label="Matched to existing" value={d.counts.linked} hint="Same UTR from another source" tone="info" />
          <StatCard label="Already imported" value={d.counts.duplicates} />
          <StatCard label="Need review" value={d.counts.review} tone={d.counts.review ? "warning" : "neutral"} />
          <StatCard label="Unreadable rows" value={d.counts.skipped} tone={d.counts.skipped ? "danger" : "neutral"} />
        </div>

        {d.status === "needs_password" && (
          <Card title="This file is password protected" description={source.passwordHint ?? "Enter the password used to open this statement."}>
            <Form schema={passwordSchema} submitLabel="Unlock and import" onSubmit={async (v) => {
              await api.post(API_ROUTES.importPassword(id), v);
              refresh();
            }}>
              <FormField name="password" label="Statement password" type="password" autoComplete="off" hint="Used once to open the file. It is never stored." />
            </Form>
          </Card>
        )}

        {(d.status === "needs_mapping" || (d.status === "failed" && d.errorCode !== "UNSUPPORTED_FILE" && /\.(csv|xlsx?)$/i.test(d.fileName))) && (
          <Card title="Map your columns" description="Tell us which column is which. We'll remember this layout next time.">
            <ColumnMapper importId={id} onApplied={refresh} />
          </Card>
        )}

        <Card
          title="Rows in this file"
          padded={false}
          actions={<Select placeholder="All rows" options={ROW_FILTERS} value={rowFilter} onChange={(e) => setRowFilter(e.target.value)} />}
        >
          <DataTable
            columns={rowColumns}
            rows={rows.rows}
            rowKey={(r) => r.id}
            loading={rows.loading}
            error={rows.error}
            empty={{ title: inProgress ? "Reading your file…" : "No rows to show" }}
            pagination={{ page: rows.page, pageSize: rows.pageSize, total: rows.total, onPageChange: rows.setPage }}
          />
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this import?"
        message="Transactions that came only from this file are deleted too. Transactions also found in another import are kept."
        confirmLabel="Delete"
        destructive
        pending={remove.pending}
        onConfirm={remove.run}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
