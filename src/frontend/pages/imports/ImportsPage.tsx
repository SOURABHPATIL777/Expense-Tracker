"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { Button } from "@/frontend/components/Button/Button";
import { DataTable, type Column } from "@/frontend/components/DataTable/DataTable";
import { DateText } from "@/frontend/components/DateText/DateText";
import { FileDropzone } from "@/frontend/components/FileDropzone/FileDropzone";
import { Icon } from "@/frontend/components/Icon/Icon";
import { RowActions } from "@/frontend/components/RowActions/RowActions";
import { DeleteImportDialog } from "@/frontend/components/DeleteImportDialog/DeleteImportDialog";
import { StatusBadge, Badge } from "@/frontend/components/StatusBadge/StatusBadge";
import { usePaginatedList } from "@/frontend/hooks/usePaginatedList";
import { useUploadQueue } from "@/frontend/hooks/useUploadQueue";
import { useImportEvents } from "@/frontend/hooks/useImportEvents";
import type { UploadItem, UploadItemStatus } from "@/frontend/lib/uploadQueue";
import type { UploadStage } from "@/frontend/lib/uploadStatement";
import { formatDate } from "@/frontend/lib/format";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { IMPORT_STATUS_LABELS, SOURCE_APP_LABELS, type LabelMap } from "@/shared/constants/labels";
import type { ImportDto } from "@/shared/schemas/imports";
import styles from "./ImportsPage.module.css";

const STAGE_LABELS: Record<UploadStage, string> = {
  hashing: "Checking file…",
  registering: "Preparing…",
  uploading: "Uploading securely…",
  queuing: "Starting import…",
};

const UPLOAD_STATUS: LabelMap<UploadItemStatus> = {
  queued: { label: "Waiting", tone: "neutral" },
  uploading: { label: "Uploading", tone: "info" },
  done: { label: "Uploaded", tone: "success" },
  error: { label: "Failed", tone: "danger" },
};

const SOURCES = ["PhonePe", "Google Pay", "Paytm", "Any bank"];

const columns = (onDelete: (i: ImportDto) => void): Column<ImportDto>[] => [
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
        {i.fileDeletedAt && <Badge>File deleted</Badge>}
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
  { key: "actions", header: "", align: "right", width: "5rem", render: (i) => <RowActions onDelete={() => onDelete(i)} /> },
];

function uploadDetail(item: UploadItem): string {
  if (item.status === "error") return item.error ?? "Upload failed.";
  if (item.stage) return STAGE_LABELS[item.stage];
  if (item.status !== "done") return "Waiting to upload";
  // The same statement uploaded again updates the transactions it brought in.
  return item.import?.status === "completed" ? "Already imported: updating its transactions" : "Reading in the background";
}

function UploadRow({ item, onRetry }: { item: UploadItem; onRetry: () => void }) {
  return (
    <li className={styles.uploadRow}>
      <span className={styles.fileIcon} aria-hidden>
        <Icon name="file" size={18} />
      </span>
      <span className={styles.uploadText}>
        <strong>{item.file.name}</strong>
        <span className={item.status === "error" ? styles.errorText : styles.muted}>{uploadDetail(item)}</span>
      </span>
      <span className={styles.uploadActions}>
        <StatusBadge value={item.status} map={UPLOAD_STATUS} />
        {item.import && (
          <Link href={PAGE_ROUTES.importReview(item.import.id)} className={styles.open}>
            Open
          </Link>
        )}
        {item.existingImportId && (
          <Link href={PAGE_ROUTES.importReview(item.existingImportId)} className={styles.open}>
            View
          </Link>
        )}
        {item.status === "error" && !item.existingImportId && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </span>
      {item.status === "uploading" && <span className={styles.progress} aria-hidden />}
    </li>
  );
}

export default function ImportsPage() {
  const router = useRouter();
  const [deleting, setDeleting] = useState<ImportDto | null>(null);
  const history = usePaginatedList<ImportDto>(API_ROUTES.imports);
  const uploads = useUploadQueue();
  /** A single file picked on its own opens its review page once uploaded, as before. */
  const solo = useRef<string | null>(null);
  const reloadHistory = history.reload;
  const doneCount = uploads.items.filter((i) => i.status === "done").length;

  useEffect(() => {
    if (doneCount) reloadHistory();
  }, [doneCount, reloadHistory]);
  // Status changes (reading → completed) arrive over the socket.
  useImportEvents(reloadHistory);

  useEffect(() => {
    const item = uploads.items.find((i) => i.id === solo.current);
    if (item?.status === "done" && item.import) router.push(PAGE_ROUTES.importReview(item.import.id));
  }, [uploads.items, router]);

  function onFiles(files: File[]) {
    const single = files.length === 1 && uploads.items.length === 0;
    const ids = uploads.add(files);
    solo.current = single ? ids[0] : null;
  }

  const finished = uploads.items.some((i) => i.status === "done" || i.status === "error");

  return (
    <>
      <PageHeader
        title="Imports"
        description="Add one or more statements and they're imported automatically. Payments that appear in both your UPI app and your bank are matched by UTR, never counted twice."
      />

      <div className={styles.layout}>
        <div className={styles.stack}>
          <Card>
            <div className={styles.stack}>
              <FileDropzone onFiles={onFiles} hint="CSV, Excel, PDF, HTML or JSON · up to 10 MB each · pick several at once" />
              <ul className={styles.sources} aria-label="Supported sources">
                {SOURCES.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className={styles.tip}>
                <Icon name="sparkles" size={16} /> New layouts are worked out by AI the first time, then remembered.
              </p>
            </div>
          </Card>

          {uploads.items.length > 0 && (
            <Card
              title={uploads.busy ? "Uploading…" : "Uploads"}
              actions={
                finished && !uploads.busy ? (
                  <Button variant="ghost" size="sm" onClick={uploads.clearFinished}>
                    Clear
                  </Button>
                ) : undefined
              }
              padded={false}
            >
              <ul className={styles.uploads}>
                {uploads.items.map((item) => (
                  <UploadRow key={item.id} item={item} onRetry={() => uploads.retry(item.id)} />
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card title="Import history" padded={false}>
          <DataTable
            columns={columns(setDeleting)}
            rows={history.rows}
            rowKey={(i) => i.id}
            loading={history.loading}
            error={history.error}
            onRowClick={(i) => router.push(PAGE_ROUTES.importReview(i.id))}
            empty={{ title: "No imports yet", description: "Your statements will show up here." }}
            pagination={{ page: history.page, pageSize: history.pageSize, total: history.total, onPageChange: history.setPage }}
          />
        </Card>
      </div>

      <DeleteImportDialog imp={deleting} onClose={() => setDeleting(null)} onDeleted={history.reload} />
    </>
  );
}
