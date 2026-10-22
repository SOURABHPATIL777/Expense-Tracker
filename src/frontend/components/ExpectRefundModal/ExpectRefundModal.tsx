"use client";

import { FormModal } from "@/frontend/components/FormModal/FormModal";
import { FormField } from "@/frontend/components/Form/FormField";
import { useToast } from "@/frontend/components/Toast/Toast";
import { api } from "@/frontend/lib/apiClient";
import { formatInr, minorToMajorString } from "@/frontend/lib/format";
import { API_ROUTES } from "@/shared/constants/routes";
import { refundFormSchema } from "@/shared/schemas/refunds";
import type { TransactionSummaryDto } from "@/shared/schemas/review";
import type { z } from "zod";
import styles from "./ExpectRefundModal.module.css";

type Props = { tx: TransactionSummaryDto | null; onClose: () => void; onCreated: () => void };

/** "I'm waiting for money back on this payment": used from transactions and the refunds page. */
export function ExpectRefundModal({ tx, onClose, onCreated }: Props) {
  const toast = useToast();
  async function submit(values: z.infer<typeof refundFormSchema>) {
    if (!tx) return;
    await api.post(API_ROUTES.refunds, { transactionId: tx.id, ...values });
    toast.show("Refund tracking started. We'll suggest matching credits as they arrive.", "success");
    onCreated();
  }
  return (
    <FormModal
      open={tx !== null}
      title="Expect a refund"
      schema={refundFormSchema}
      onSubmit={submit}
      onClose={onClose}
      submitLabel="Start tracking"
      intro={
        tx && (
          <span className={styles.intro}>
            {tx.merchant ?? "This payment"} · {formatInr(tx.amountMinor)}. We only suggest matching credits; you confirm when the money is back.
          </span>
        )
      }
    >
      <FormField name="expectedAmountMinor" label="Amount you expect back (₹)" inputMode="decimal" defaultValue={tx ? minorToMajorString(tx.amountMinor) : ""} />
      <FormField name="expectedBy" label="Expected by (optional)" type="date" />
      <FormField name="orderRef" label="Order / ticket number (optional)" />
      <FormField name="note" label="Note (optional)" type="textarea" placeholder="e.g. order cancelled, item returned" />
    </FormModal>
  );
}
