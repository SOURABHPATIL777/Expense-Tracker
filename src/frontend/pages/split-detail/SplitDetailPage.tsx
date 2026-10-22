"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { Button } from "@/frontend/components/Button/Button";
import { DataTable, type Column } from "@/frontend/components/DataTable/DataTable";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { DateText } from "@/frontend/components/DateText/DateText";
import { StatCard } from "@/frontend/components/StatCard/StatCard";
import { Badge, StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { Alert } from "@/frontend/components/Alert/Alert";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { Modal } from "@/frontend/components/Modal/Modal";
import { FormModal } from "@/frontend/components/FormModal/FormModal";
import { FormField } from "@/frontend/components/Form/FormField";
import { ConfirmDialog } from "@/frontend/components/ConfirmDialog/ConfirmDialog";
import { TransactionCard } from "@/frontend/components/TransactionCard/TransactionCard";
import { ShareLinkCard } from "@/frontend/components/ShareLinkCard/ShareLinkCard";
import { SplitEditor } from "@/frontend/components/SplitEditor/SplitEditor";
import { useApi } from "@/frontend/hooks/useApi";
import { useMutation } from "@/frontend/hooks/useMutation";
import { api } from "@/frontend/lib/apiClient";
import { formatInr, minorToMajorString } from "@/frontend/lib/format";
import { API_ROUTES } from "@/shared/constants/routes";
import { CLAIM_STATUS_LABELS, PARTICIPANT_RESPONSE_LABELS, SHARED_EXPENSE_STATUS_LABELS } from "@/shared/constants/labels";
import { rupeesField } from "@/shared/schemas/formFields";
import type { InviteDto, ParticipantDto, SplitDetailDto } from "@/shared/schemas/splits";
import { z } from "zod";
import styles from "./SplitDetailPage.module.css";

const EVENT_TEXT: Record<string, string> = {
  created: "created the split",
  edited: "edited the split",
  link_issued: "created a private link",
  link_revoked: "turned off the link",
  link_opened: "opened their link",
  agreed: "agreed to their share",
  questioned: "questioned their share",
  payment_reported: "reported paying",
  payment_confirmed: "payment confirmed",
  payment_not_received: "payment marked not received",
  payment_recorded: "payment recorded",
  settled: "everyone has paid",
  close: "closed the split",
  cancel: "cancelled the split",
  reopen: "reopened the split",
};

const paymentFormSchema = z.object({ amountMinor: rupeesField });

export default function SplitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const split = useApi<SplitDetailDto>(API_ROUTES.split(id));
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState<(InviteDto & { name: string }) | null>(null);
  const [paying, setPaying] = useState<ParticipantDto | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<"close" | "cancel" | null>(null);
  const s = split.data;
  const nameOf = (pid: string) => s?.participants.find((p) => p.id === pid)?.displayName ?? "Someone";

  const after = { onSuccess: split.reload };
  const issue = useMutation(async (p: ParticipantDto) => {
    const { data } = await api.post<InviteDto>(API_ROUTES.splitInvite(id, p.id));
    setLink({ ...data, name: p.displayName });
    split.reload();
  });
  const revoke = useMutation((p: ParticipantDto) => api.del(API_ROUTES.splitInvite(id, p.id)), { successMessage: "Link turned off", ...after });
  const resolve = useMutation((claimId: string, action: "confirm" | "reject", matchTransactionId?: string) =>
    api.post(API_ROUTES.splitClaim(id, claimId), { action, matchTransactionId }), { successMessage: "Updated", ...after });
  const record = useMutation((participantId: string, amountMinor: number, matchTransactionId?: string) =>
    api.post(API_ROUTES.splitPayments(id), { participantId, amountMinor, matchTransactionId }), { successMessage: "Payment recorded", ...after });
  const setStatus = useMutation((action: "close" | "cancel" | "reopen") => api.post(API_ROUTES.splitStatus(id), { action }), {
    successMessage: "Updated",
    onSuccess: () => {
      setConfirmStatus(null);
      split.reload();
    },
  });

  if (split.error) return <Alert tone="danger">{split.error.message}</Alert>;
  if (!s) return <Skeleton lines={8} />;
  const open = s.status === "open";

  const columns: Column<ParticipantDto>[] = [
    {
      key: "name",
      header: "Person",
      render: (p) => (
        <div className={styles.person}>
          <strong>{p.isOwner ? "You" : p.displayName}</strong>
          {!p.isOwner && (
            <span className={styles.badges}>
              <StatusBadge value={p.response} map={PARTICIPANT_RESPONSE_LABELS} />
              {p.needsReconfirm && <Badge tone="warning">Needs to reconfirm</Badge>}
              {p.link.opened ? <Badge tone="info">Link opened</Badge> : p.link.active && <Badge>Link sent</Badge>}
            </span>
          )}
        </div>
      ),
    },
    { key: "share", header: "Share", align: "right", render: (p) => <MoneyText minor={p.shareMinor} /> },
    { key: "paid", header: "Paid", align: "right", hideOnMobile: true, render: (p) => (p.isOwner ? "—" : <MoneyText minor={p.confirmedMinor} />) },
    { key: "owed", header: "Owes", align: "right", render: (p) => (p.isOwner ? "—" : <MoneyText minor={p.outstandingMinor} strong={p.outstandingMinor > 0} />) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) =>
        !p.isOwner &&
        open && (
          <div className={styles.rowActions}>
            <Button size="sm" variant="secondary" onClick={() => issue.run(p)} loading={issue.pending}>
              {p.link.active ? "New link" : "Get link"}
            </Button>
            {p.link.active && (
              <Button size="sm" variant="ghost" onClick={() => revoke.run(p)}>
                Turn off link
              </Button>
            )}
            {p.outstandingMinor > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setPaying(p)}>
                Record payment
              </Button>
            )}
          </div>
        ),
    },
  ];

  const reported = s.claims.filter((c) => c.status === "reported");

  return (
    <>
      <PageHeader
        title={s.title}
        description={
          <>
            <StatusBadge value={s.status} map={SHARED_EXPENSE_STATUS_LABELS} /> · created <DateText iso={s.createdAt} />
          </>
        }
        actions={
          open ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit split
              </Button>
              <Button variant="ghost" onClick={() => setConfirmStatus("close")}>
                Close
              </Button>
              <Button variant="ghost" onClick={() => setConfirmStatus("cancel")}>
                Cancel split
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setStatus.run("reopen")} loading={setStatus.pending}>
              Reopen
            </Button>
          )
        }
      />

      <div className={styles.stack}>
        <div className={styles.kpis}>
          <StatCard label="Total" value={formatInr(s.totalMinor)} />
          <StatCard label="Your share" value={formatInr(s.ownerShareMinor)} tone="info" hint="Counted as your spending" />
          <StatCard label="Still owed to you" value={formatInr(s.outstandingMinor)} tone={s.outstandingMinor ? "warning" : "success"} />
        </div>

        {s.transaction && <TransactionCard tx={s.transaction} label="Original payment" />}

        {reported.length > 0 && (
          <Card title="Payments to check" description="They say they've paid. Confirm only once you can see the money.">
            <ul className={styles.list}>
              {reported.map((c) => (
                <li key={c.id}>
                  <span>
                    <strong>{nameOf(c.participantId)}</strong> reported <MoneyText minor={c.amountMinor} /> · <DateText iso={c.reportedAt} />
                    {c.note && <em className={styles.muted}> “{c.note}”</em>}
                  </span>
                  <span className={styles.rowActions}>
                    <Button size="sm" onClick={() => resolve.run(c.id, "confirm")}>
                      Received
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resolve.run(c.id, "reject")}>
                      Not received
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {s.repaymentSuggestions.length > 0 && (
          <Card title="Possible repayments" description="Credits in your imports that match what someone owes.">
            <ul className={styles.list}>
              {s.repaymentSuggestions.map((r) => (
                <li key={`${r.participantId}-${r.transaction.id}`}>
                  <TransactionCard tx={r.transaction} label={`From ${nameOf(r.participantId)}?`} />
                  <Button size="sm" onClick={() => record.run(r.participantId, r.transaction.amountMinor, r.transaction.id)}>
                    Yes, mark paid
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="People" padded={false}>
          <DataTable columns={columns} rows={s.participants} rowKey={(p) => p.id} />
        </Card>

        <Card title="History">
          <ol className={styles.timeline}>
            {s.events.map((e, i) => (
              <li key={i}>
                <DateText iso={e.at} withTime /> — {e.actor === "owner" ? "You" : (e.participantName ?? "Guest")}{" "}
                {EVENT_TEXT[e.action] ?? e.action}
                {e.message && <em className={styles.muted}> “{e.message}”</em>}
              </li>
            ))}
            {s.claims
              .filter((c) => c.status !== "reported")
              .map((c) => (
                <li key={c.id}>
                  <DateText iso={c.reportedAt} withTime /> — {nameOf(c.participantId)} <MoneyText minor={c.amountMinor} />{" "}
                  <StatusBadge value={c.status} map={CLAIM_STATUS_LABELS} />
                </li>
              ))}
          </ol>
        </Card>
      </div>

      {editing && <SplitEditor open existing={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); split.reload(); }} />}

      <Modal open={link !== null} title="Private link" onClose={() => setLink(null)}>
        {link && <ShareLinkCard name={link.name} url={link.url} expiresAt={link.expiresAt} />}
      </Modal>

      <FormModal
        open={paying !== null}
        title={`Record payment from ${paying?.displayName ?? ""}`}
        schema={paymentFormSchema}
        submitLabel="Record"
        onClose={() => setPaying(null)}
        onSubmit={async (v) => {
          if (!paying) return;
          await record.run(paying.id, v.amountMinor);
          setPaying(null);
        }}
      >
        <FormField name="amountMinor" label="Amount received (₹)" inputMode="decimal" defaultValue={paying ? minorToMajorString(paying.outstandingMinor) : ""} />
      </FormModal>

      <ConfirmDialog
        open={confirmStatus !== null}
        title={confirmStatus === "cancel" ? "Cancel this split?" : "Close this split?"}
        message={
          confirmStatus === "cancel"
            ? "The whole payment counts as your spending again and everyone's links stop working."
            : "Nobody will be able to respond or report payments until you reopen it."
        }
        confirmLabel={confirmStatus === "cancel" ? "Cancel split" : "Close"}
        destructive={confirmStatus === "cancel"}
        pending={setStatus.pending}
        onConfirm={() => confirmStatus && setStatus.run(confirmStatus)}
        onCancel={() => setConfirmStatus(null)}
      />
    </>
  );
}
