"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { DataTable, type Column } from "@/frontend/components/DataTable/DataTable";
import { DateText } from "@/frontend/components/DateText/DateText";
import { FileDropzone } from "@/frontend/components/FileDropzone/FileDropzone";
import { StatusBadge, Badge } from "@/frontend/components/StatusBadge/StatusBadge";
import { usePaginatedList } from "@/frontend/hooks/usePaginatedList";
import { useMutation } from "@/frontend/hooks/useMutation";
import { uploadStatement, type UploadStage } from "@/frontend/lib/uploadStatement";
import { formatDate } from "@/frontend/lib/format";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { IMPORT_STATUS_LABELS, SOURCE_APP_LABELS } from "@/shared/constants/labels";
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
        <span className={styles.muted}>
          {i.sourceApp ? SOURCE_APP_LABELS[i.sourceApp] : "Detecting source…"}
          {i.readByAi && " · read by AI"}
        </span>
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
  const [stage, setStage] = useState<UploadStage>();
  const history = usePaginatedList<ImportDto>(API_ROUTES.imports);

  const upload = useMutation((file: File) => uploadStatement(file, { onStage: setStage }), {
    onSuccess: (imp) => router.push(PAGE_ROUTES.importReview(imp.id)),
  });

  return (
    <>
      <PageHeader
        title="Imports"
        description="Drop a statement and it's imported automatically: we recognise the app or bank and its layout. Payments that appear in both your UPI app and bank are matched by UTR, not double counted."
      />

      <div className={styles.layout}>
        <Card title="New import">
          <div className={styles.stack}>
            <FileDropzone onFile={(f) => upload.run(f)} disabled={upload.pending} hint="PhonePe, Google Pay, Paytm or any bank · CSV, Excel or PDF · up to 10 MB" />
            {upload.pending && stage && <p className={styles.stage}>{STAGE_LABELS[stage]}</p>}
            <p className={styles.muted}>
              <Badge>Tip</Badge> Unfamiliar layouts are worked out by AI the first time and remembered for everyone after that.
            </p>
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
