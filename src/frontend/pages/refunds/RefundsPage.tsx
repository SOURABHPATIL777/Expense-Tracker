"use client";

import { useState } from "react";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { Button } from "@/frontend/components/Button/Button";
import { Select, optionsFrom } from "@/frontend/components/Select/Select";
import { StatusBadge, Badge } from "@/frontend/components/StatusBadge/StatusBadge";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { DateText } from "@/frontend/components/DateText/DateText";
import { EmptyState } from "@/frontend/components/EmptyState/EmptyState";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { Alert } from "@/frontend/components/Alert/Alert";
import { Modal } from "@/frontend/components/Modal/Modal";
import { Pagination } from "@/frontend/components/Pagination/Pagination";
import { TransactionCard } from "@/frontend/components/TransactionCard/TransactionCard";
import { ExpectRefundModal } from "@/frontend/components/ExpectRefundModal/ExpectRefundModal";
import { useToast } from "@/frontend/components/Toast/Toast";
import { usePaginatedList } from "@/frontend/hooks/usePaginatedList";
import { useMutation } from "@/frontend/hooks/useMutation";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import { REFUND_STATUSES } from "@/shared/constants/enums";
import { REFUND_STATUS_LABELS } from "@/shared/constants/labels";
import type { RefundActionInput, RefundDto, RefundMessageDto } from "@/shared/schemas/refunds";
import type { TransactionDto } from "@/shared/schemas/transactions";
import styles from "./RefundsPage.module.css";

const FAILED_PREVIEW = 5;

function RefundCard({ r, act, onDraft, busy }: { r: RefundDto; act: (r: RefundDto, a: RefundActionInput) => void; onDraft: (r: RefundDto) => void; busy: boolean }) {
  const waiting = r.status === "open" || r.status === "suggested";
  return (
    <Card
      title={
        <span className={styles.title}>
          <StatusBadge value={r.status} map={REFUND_STATUS_LABELS} />
          {r.overdue && <Badge tone="danger">Overdue</Badge>}
        </span>
      }
      actions={
        waiting ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => onDraft(r)}>
              Draft support message
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(r, { action: "close" })}>
              Stop tracking
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(r, { action: "reopen" })}>
            Reopen
          </Button>
        )
      }
    >
      <div className={styles.body}>
        <div className={styles.facts}>
          <span>
            Expecting <MoneyText minor={r.expectedAmountMinor} strong />
          </span>
          {r.expectedBy && (
            <span className={styles.muted}>
              by <DateText iso={r.expectedBy} />
            </span>
          )}
          {r.orderRef && <span className={styles.muted}>Ref {r.orderRef}</span>}
        </div>
        {r.transaction && <TransactionCard tx={r.transaction} label="Original payment" />}
        {r.note && <p className={styles.note}>{r.note}</p>}

        {r.match && <TransactionCard tx={r.match} label="Refund received" />}
        {waiting && r.suggestions.length > 0 && (
          <div className={styles.suggestions}>
            <p className={styles.muted}>Possible refunds in your records. Confirm only if you&apos;re sure:</p>
            {r.suggestions.map((s) => (
              <div key={s.id} className={styles.suggestion}>
                <TransactionCard tx={s} />
                <Button size="sm" loading={busy} onClick={() => act(r, { action: "confirm", matchTransactionId: s.id })}>
                  This is the refund
                </Button>
              </div>
            ))}
          </div>
        )}
        {waiting && r.suggestions.length === 0 && <p className={styles.muted}>No matching credit found in your imported records yet.</p>}
      </div>
    </Card>
  );
}

export default function RefundsPage() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const refunds = usePaginatedList<RefundDto>(API_ROUTES.refunds, { status });
  const failed = usePaginatedList<TransactionDto>(API_ROUTES.transactions, { status: "failed", direction: "debit" }, FAILED_PREVIEW);
  const [busyId, setBusyId] = useState<string>();
  const [trackTx, setTrackTx] = useState<TransactionDto | null>(null);
  const [draft, setDraft] = useState<{ refund: RefundDto; message?: string } | null>(null);

  const act = useMutation(
    async (r: RefundDto, input: RefundActionInput) => {
      setBusyId(r.id);
      try {
        await api.post(API_ROUTES.refund(r.id), input);
      } finally {
        setBusyId(undefined);
      }
    },
    { successMessage: "Updated", onSuccess: refunds.reload },
  );

  const drafting = useMutation(async (r: RefundDto) => {
    setDraft({ refund: r });
    const { data } = await api.post<RefundMessageDto>(API_ROUTES.refundMessage(r.id));
    setDraft({ refund: r, message: data.message });
  });

  async function copy() {
    if (!draft?.message) return;
    await navigator.clipboard.writeText(draft.message);
    toast.show("Copied", "success");
  }

  return (
    <>
      <PageHeader
        title="Refunds expected"
        description="Money you're waiting to get back. We suggest matching credits from your imports; nothing is marked received until you confirm."
        actions={<Select aria-label="Status" placeholder="All refunds" options={optionsFrom(REFUND_STATUSES, REFUND_STATUS_LABELS)} value={status} onChange={(e) => setStatus(e.target.value)} />}
      />
      <div className={styles.stack}>
        {failed.rows.length > 0 && (
          <Card title="Failed payments" description="If money left your account for any of these, track a refund." padded={false}>
            <ul className={styles.failed}>
              {failed.rows.map((t) => (
                <li key={t.id}>
                  <TransactionCard tx={t} />
                  <Button variant="secondary" size="sm" onClick={() => setTrackTx(t)}>
                    Track refund
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {refunds.error && <Alert tone="danger">{refunds.error.message}</Alert>}
        {refunds.loading && refunds.rows.length === 0 ? (
          <Skeleton lines={6} />
        ) : refunds.rows.length === 0 ? (
          <Card>
            <EmptyState title="No refunds tracked" description="Open a payment on the Transactions page and choose “Expect a refund”." />
          </Card>
        ) : (
          <>
            {refunds.rows.map((r) => (
              <RefundCard key={r.id} r={r} act={(x, a) => void act.run(x, a)} onDraft={(x) => void drafting.run(x)} busy={busyId === r.id} />
            ))}
            <Pagination page={refunds.page} pageSize={refunds.pageSize} total={refunds.total} onPageChange={refunds.setPage} />
          </>
        )}
      </div>

      <ExpectRefundModal
        tx={trackTx}
        onClose={() => setTrackTx(null)}
        onCreated={() => {
          setTrackTx(null);
          refunds.reload();
        }}
      />

      <Modal
        open={draft !== null}
        title="Support message"
        onClose={() => setDraft(null)}
        footer={
          <Button onClick={copy} disabled={!draft?.message}>
            Copy message
          </Button>
        }
      >
        {drafting.error ? (
          <Alert tone="warning">{drafting.error.message} You can turn on the refund-message model in Settings → AI models.</Alert>
        ) : draft?.message ? (
          <>
            <pre className={styles.message}>{draft.message}</pre>
            <p className={styles.muted}>AI-drafted. Check the details and fill any [placeholders] before sending.</p>
          </>
        ) : (
          <Skeleton lines={5} />
        )}
      </Modal>
    </>
  );
}
