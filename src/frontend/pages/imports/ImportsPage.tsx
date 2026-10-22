"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { DataTable, type Column } from "@/frontend/components/DataTable/DataTable";
import { DateText } from "@/frontend/components/DateText/DateText";
import { FileDropzone } from "@/frontend/components/FileDropzone/FileDropzone";
import { Select } from "@/frontend/components/Select/Select";
import { SourcePicker } from "@/frontend/components/SourcePicker/SourcePicker";
import { StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { Alert } from "@/frontend/components/Alert/Alert";
import { useApi } from "@/frontend/hooks/useApi";
import { usePaginatedList } from "@/frontend/hooks/usePaginatedList";
import { useMutation } from "@/frontend/hooks/useMutation";
import { uploadStatement, type UploadStage } from "@/frontend/lib/uploadStatement";
import { formatDate } from "@/frontend/lib/format";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { IMPORT_STATUS_LABELS, SOURCE_APP_LABELS } from "@/shared/constants/labels";
import { acceptedExtensions } from "@/shared/constants/sources";
import type { SourceApp } from "@/shared/constants/enums";
import type { AccountDto } from "@/shared/schemas/accounts";
import type { ImportDto } from "@/shared/schemas/imports";
import styles from "./ImportsPage.module.css";

const STAGE_LABELS: Record<UploadStage, string> = {
  hashing: "Checking file…",
  registering: "Preparing upload…",
  uploading: "Uploading securely…",
  queuing: "Starting import…",
};

const columns: Column<ImportDto>[] = [
  {
    key: "file",
    header: "File",
    render: (i) => (
      <div className={styles.file}>
        <strong>{i.fileName}</strong>
        <span className={styles.muted}>{SOURCE_APP_LABELS[i.sourceApp]}</span>
      </div>
    ),
  },
  { key: "status", header: "Status", render: (i) => <StatusBadge value={i.status} map={IMPORT_STATUS_LABELS} /> },
  {
    key: "period",
    header: "Period",
    hideOnMobile: true,
    render: (i) => (i.periodStart ? `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}` : "—"),
  },
  { key: "rows", header: "New / linked", align: "right", hideOnMobile: true, render: (i) => `${i.counts.imported} / ${i.counts.linked}` },
  { key: "created", header: "Uploaded", align: "right", render: (i) => <DateText iso={i.createdAt} /> },
];

export default function ImportsPage() {
  const router = useRouter();
  const [source, setSource] = useState<SourceApp | null>(null);
  const [accountId, setAccountId] = useState("");
  const [stage, setStage] = useState<UploadStage>();
  const accounts = useApi<AccountDto[]>(API_ROUTES.accounts);
  const history = usePaginatedList<ImportDto>(API_ROUTES.imports);

  const upload = useMutation(
    (file: File) => uploadStatement(file, { sourceApp: source!, accountId, onStage: setStage }),
    { onSuccess: (imp) => router.push(PAGE_ROUTES.importReview(imp.id)) },
  );

  const accountOptions = (accounts.data ?? []).map((a) => ({ value: a.id, label: a.label }));

  return (
    <>
      <PageHeader title="Imports" description="Upload statements from your UPI apps or bank. Payments that appear in both are matched by UTR, not double counted." />

      <div className={styles.layout}>
        <Card title="New import" description="1. Choose where the statement is from  2. Upload the file">
          <div className={styles.stack}>
            <SourcePicker value={source} onChange={setSource} />
            {accountOptions.length > 0 && (
              <Select label="Account (optional)" placeholder="Not linked to an account" options={accountOptions} value={accountId} onChange={(e) => setAccountId(e.target.value)} />
            )}
            {source ? (
              <FileDropzone onFile={(f) => upload.run(f)} disabled={upload.pending} accept={acceptedExtensions(source)} />
            ) : (
              <Alert tone="neutral">Pick PhonePe, Google Pay, Paytm or your bank to continue.</Alert>
            )}
            {upload.pending && stage && <p className={styles.stage}>{STAGE_LABELS[stage]}</p>}
          </div>
        </Card>

        <Card title="Import history" padded={false}>
          <DataTable
            columns={columns}
            rows={history.rows}
            rowKey={(i) => i.id}
            loading={history.loading}
            error={history.error}
            onRowClick={(i) => router.push(PAGE_ROUTES.importReview(i.id))}
            empty={{ title: "No imports yet", description: "Your first statement will show up here." }}
            pagination={{ page: history.page, pageSize: history.pageSize, total: history.total, onPageChange: history.setPage }}
          />
        </Card>
      </div>
    </>
  );
}
