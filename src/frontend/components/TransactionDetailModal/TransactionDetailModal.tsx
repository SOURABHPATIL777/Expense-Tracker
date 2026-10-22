"use client";

import { useState } from "react";
import { Modal } from "@/frontend/components/Modal/Modal";
import { Form } from "@/frontend/components/Form/Form";
import { FormField } from "@/frontend/components/Form/FormField";
import { Button } from "@/frontend/components/Button/Button";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { DateText } from "@/frontend/components/DateText/DateText";
import { Badge, StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { ExpectRefundModal } from "@/frontend/components/ExpectRefundModal/ExpectRefundModal";
import { useToast } from "@/frontend/components/Toast/Toast";
import { optionsFrom, type Option } from "@/frontend/components/Select/Select";
import { useApi } from "@/frontend/hooks/useApi";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import { TRANSACTION_KINDS, type SourceApp } from "@/shared/constants/enums";
import { SOURCE_APP_LABELS, TRANSACTION_KIND_LABELS, TRANSACTION_STATUS_LABELS } from "@/shared/constants/labels";
import { transactionEditFormSchema, type TransactionDetailDto } from "@/shared/schemas/transactions";
import type { z } from "zod";
import styles from "./TransactionDetailModal.module.css";

const CATEGORY_SOURCE_TEXT: Record<string, string> = {
  rule: "Set by one of your rules",
  merchant_map: "Learned from your earlier choice for this merchant",
  llm: "Suggested by AI",
  user: "Set by you",
  system: "Default",
};

type Props = { id: string | null; categoryOptions: Option[]; onClose: () => void; onChanged: () => void };

export function TransactionDetailModal({ id, categoryOptions, onClose, onChanged }: Props) {
  const toast = useToast();
  const detail = useApi<TransactionDetailDto>(id ? API_ROUTES.transaction(id) : null);
  const [refundFor, setRefundFor] = useState<TransactionDetailDto | null>(null);
  const t = detail.data && detail.data.id === id ? detail.data : undefined;

  async function save(values: z.infer<typeof transactionEditFormSchema>) {
    if (!t) return;
    await api.patch(API_ROUTES.transaction(t.id), values);
    toast.show("Saved. Similar payments from this merchant will follow your choice.", "success");
    detail.reload();
    onChanged();
  }

  async function unlock() {
    if (!t) return;
    await api.patch(API_ROUTES.transaction(t.id), { userLocked: false });
    toast.show("Rules and AI can update this transaction again", "success");
    detail.reload();
  }

  return (
    <>
      <Modal open={id !== null && refundFor === null} title="Transaction" onClose={onClose}>
        {!t ? (
          <Skeleton lines={6} />
        ) : (
          <div className={styles.body}>
            <div className={styles.head}>
              <div>
                <strong className={styles.merchant}>{t.merchant ?? "Unknown merchant"}</strong>
                <DateText iso={t.occurredAt} withTime />
              </div>
              <MoneyText minor={t.amountMinor} direction={t.direction} strong />
            </div>

            <div className={styles.badges}>
              <StatusBadge value={t.status} map={TRANSACTION_STATUS_LABELS} />
              <StatusBadge value={t.kind} map={TRANSACTION_KIND_LABELS} />
              {t.reconciliation === "reconciled" && <Badge tone="success">Matched across sources</Badge>}
              {t.userLocked && <Badge tone="info">Edited by you</Badge>}
            </div>

            <dl className={styles.facts}>
              {t.referenceId && (
                <>
                  <dt>UTR</dt>
                  <dd>{t.referenceId}</dd>
                </>
              )}
              {t.counterpartyVpa && (
                <>
                  <dt>UPI ID</dt>
                  <dd>{t.counterpartyVpa}</dd>
                </>
              )}
              {t.narration && (
                <>
                  <dt>Statement text</dt>
                  <dd>{t.narration}</dd>
                </>
              )}
              {t.categorySource && (
                <>
                  <dt>Category</dt>
                  <dd>
                    {CATEGORY_SOURCE_TEXT[t.categorySource]}
                    {t.categorySource === "llm" && t.categoryConfidence !== null && ` (${Math.round(t.categoryConfidence * 100)}% sure)`}
                  </dd>
                </>
              )}
              <dt>Seen in</dt>
              <dd>
                {t.sources.map((s) => (
                  <span key={s.importId} className={styles.source}>
                    {SOURCE_APP_LABELS[s.sourceApp as SourceApp] ?? s.sourceApp}
                    {s.fileName && ` · ${s.fileName}`}
                  </span>
                ))}
              </dd>
            </dl>

            <Form key={t.id} schema={transactionEditFormSchema} onSubmit={save} submitLabel="Save" layout="grid">
              <FormField name="categoryId" label="Category" type="select" placeholder="Uncategorised" options={categoryOptions} defaultValue={t.categoryId ?? ""} />
              <FormField name="transactionKind" label="Counts as" type="select" options={optionsFrom(TRANSACTION_KINDS, TRANSACTION_KIND_LABELS)} defaultValue={t.kind} />
              <FormField name="note" label="Note" defaultValue={t.note ?? ""} />
            </Form>

            <div className={styles.actions}>
              {t.direction === "debit" && !t.openRefundId && (
                <Button variant="secondary" onClick={() => setRefundFor(t)}>
                  Expect a refund
                </Button>
              )}
              {t.openRefundId && <Badge tone="warning">Refund being tracked</Badge>}
              {t.userLocked && (
                <Button variant="ghost" onClick={unlock}>
                  Let rules &amp; AI decide again
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <ExpectRefundModal
        tx={refundFor}
        onClose={() => setRefundFor(null)}
        onCreated={() => {
          setRefundFor(null);
          detail.reload();
        }}
      />
    </>
  );
}
