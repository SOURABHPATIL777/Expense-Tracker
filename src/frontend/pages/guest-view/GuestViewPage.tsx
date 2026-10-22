"use client";

import { useState } from "react";
import { z } from "zod";
import { AuthCard } from "@/frontend/components/AuthCard/AuthCard";
import { Button } from "@/frontend/components/Button/Button";
import { Alert } from "@/frontend/components/Alert/Alert";
import { Form } from "@/frontend/components/Form/Form";
import { FormField } from "@/frontend/components/Form/FormField";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { DateText } from "@/frontend/components/DateText/DateText";
import { StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { useApi } from "@/frontend/hooks/useApi";
import { useMutation } from "@/frontend/hooks/useMutation";
import { api, newIdempotencyKey } from "@/frontend/lib/apiClient";
import { minorToMajorString } from "@/frontend/lib/format";
import { API_ROUTES } from "@/shared/constants/routes";
import { CLAIM_STATUS_LABELS, PARTICIPANT_RESPONSE_LABELS } from "@/shared/constants/labels";
import { rupeesField } from "@/shared/schemas/formFields";
import type { GuestShareDto } from "@/shared/schemas/splits";
import styles from "./GuestViewPage.module.css";

const paymentForm = z.object({ amountMinor: rupeesField, note: z.string().trim().max(300).optional() });
const questionForm = z.object({ message: z.string().trim().min(1, "Tell them what looks wrong").max(500) });

function ShareCard({ share, onChanged }: { share: GuestShareDto; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  // One key per form instance: a double-submit or network retry can't record the payment twice.
  const [paymentKey, setPaymentKey] = useState(newIdempotencyKey);
  const outstanding = Math.max(0, share.shareMinor - share.confirmedMinor - share.reportedMinor);
  const open = share.status === "open";

  const respond = useMutation(
    (response: "agreed" | "questioned", message?: string) =>
      api.post(API_ROUTES.guest.respond, { participantId: share.participantId, response, version: share.version, message }),
    { successMessage: "Thanks, your response was sent", onSuccess: onChanged },
  );

  return (
    <section className={styles.card}>
      <p className={styles.from}>
        <strong>{share.ownerName}</strong> shared <strong>{share.title}</strong> · <DateText iso={share.occurredAt} />
      </p>
      <div className={styles.amounts}>
        <div>
          <span className={styles.label}>Total</span>
          <MoneyText minor={share.totalMinor} />
        </div>
        <div>
          <span className={styles.label}>Your share</span>
          <span className={styles.big}>
            <MoneyText minor={share.shareMinor} strong />
          </span>
        </div>
        <div>
          <span className={styles.label}>Still to pay</span>
          <MoneyText minor={outstanding} />
        </div>
      </div>

      {share.needsReconfirm && <Alert tone="warning">The amount changed after you agreed. Please check it and agree again.</Alert>}
      {!open && <Alert tone="info">This split is {share.status}. No further changes are possible.</Alert>}

      {open && (
        <div className={styles.respond}>
          <span className={styles.label}>
            Your response: <StatusBadge value={share.needsReconfirm ? "pending" : share.responseStatus} map={PARTICIPANT_RESPONSE_LABELS} />
          </span>
          {(share.responseStatus !== "agreed" || share.needsReconfirm) && (
            <div className={styles.buttons}>
              <Button onClick={() => respond.run("agreed")} loading={respond.pending}>
                Agree
              </Button>
              <Button variant="secondary" onClick={() => setAsking((a) => !a)}>
                Question this amount
              </Button>
            </div>
          )}
          {asking && (
            <Form schema={questionForm} submitLabel="Send question" onSubmit={async (v) => { await respond.run("questioned", v.message); setAsking(false); }}>
              <FormField name="message" label="What looks wrong?" type="textarea" />
            </Form>
          )}
        </div>
      )}

      {open && outstanding > 0 && (
        <details className={styles.pay}>
          <summary>Already paid them?</summary>
          <Form
            key={paymentKey}
            schema={paymentForm}
            submitLabel="Report payment"
            onSubmit={async (v) => {
              await api.post(API_ROUTES.guest.payment, { participantId: share.participantId, ...v }, { idempotencyKey: paymentKey });
              setPaymentKey(newIdempotencyKey());
              onChanged();
            }}
          >
            <FormField name="amountMinor" label="Amount you paid (₹)" inputMode="decimal" defaultValue={minorToMajorString(outstanding)} />
            <FormField name="note" label="Note (optional)" placeholder="e.g. paid via GPay" />
          </Form>
          <p className={styles.fine}>{share.ownerName} confirms once the money arrives.</p>
        </details>
      )}

      {share.claims.length > 0 && (
        <ul className={styles.claims}>
          {share.claims.map((c) => (
            <li key={c.id}>
              <MoneyText minor={c.amountMinor} /> · <DateText iso={c.reportedAt} /> <StatusBadge value={c.status} map={CLAIM_STATUS_LABELS} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function GuestViewPage() {
  const shares = useApi<GuestShareDto[]>(API_ROUTES.guest.share);
  return (
    <AuthCard title="Your shared expenses" subtitle="Only your part is shown here.">
      {shares.error ? (
        <Alert tone="warning">
          {shares.error.status === 401 ? "Open the link you were sent to see your share." : shares.error.message}
        </Alert>
      ) : !shares.data ? (
        <Skeleton lines={5} />
      ) : shares.data.length === 0 ? (
        <Alert tone="info">Nothing to show. The link may have been turned off or replaced; ask for a new one.</Alert>
      ) : (
        <div className={styles.list}>
          {shares.data.map((s) => (
            <ShareCard key={s.participantId} share={s} onChanged={shares.reload} />
          ))}
        </div>
      )}
    </AuthCard>
  );
}
