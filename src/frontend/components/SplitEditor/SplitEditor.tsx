"use client";

import { useState } from "react";
import { Modal } from "@/frontend/components/Modal/Modal";
import { Button } from "@/frontend/components/Button/Button";
import { Select } from "@/frontend/components/Select/Select";
import { TextInput } from "@/frontend/components/TextInput/TextInput";
import { Alert } from "@/frontend/components/Alert/Alert";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { useMutation } from "@/frontend/hooks/useMutation";
import { api } from "@/frontend/lib/apiClient";
import { minorToMajorString, parseAmountToMinor } from "@/frontend/lib/format";
import { API_ROUTES } from "@/shared/constants/routes";
import { SPLIT } from "@/shared/constants/limits";
import type { SplitMethod } from "@/shared/constants/enums";
import { allocateSplit, SplitError } from "@/shared/utils/splitAllocation";
import type { SplitDetailDto } from "@/shared/schemas/splits";
import type { TransactionSummaryDto } from "@/shared/schemas/review";
import styles from "./SplitEditor.module.css";

type Row = { key: string; id?: string; name: string; isOwner: boolean; value: string };

const METHOD_OPTIONS: Array<{ value: SplitMethod; label: string }> = [
  { value: "equal", label: "Equally" },
  { value: "exact", label: "By exact amounts" },
  { value: "percent", label: "By percentage" },
];

let rowSeq = 0;
const newRow = (over: Partial<Row> = {}): Row => ({ key: `r${rowSeq++}`, name: "", isOwner: false, value: "", ...over });

function initialRows(existing?: SplitDetailDto): Row[] {
  if (!existing) return [newRow({ name: "You", isOwner: true }), newRow()];
  return existing.participants.map((p) =>
    newRow({ id: p.id, name: p.displayName, isOwner: p.isOwner, value: existing.method === "exact" ? minorToMajorString(p.shareMinor) : "" }),
  );
}

/** Values as the API expects: paise for exact, percent for percent. */
function parseValue(method: SplitMethod, raw: string): number | undefined {
  if (method === "equal" || raw.trim() === "") return undefined;
  if (method === "exact") return parseAmountToMinor(raw) ?? undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (split: SplitDetailDto) => void;
  /** Splitting an imported payment: the total is fixed to it. */
  transaction?: TransactionSummaryDto | null;
  existing?: SplitDetailDto;
};

/** Create or edit a split; previews everyone's share with the same function the server uses. */
export function SplitEditor({ open, onClose, onSaved, transaction, existing }: Props) {
  const fixedTotal = existing?.transactionId ? existing.totalMinor : transaction?.amountMinor;
  const [title, setTitle] = useState(existing?.title ?? transaction?.merchant ?? "");
  const [totalText, setTotalText] = useState(fixedTotal ? minorToMajorString(fixedTotal) : existing ? minorToMajorString(existing.totalMinor) : "");
  const [method, setMethod] = useState<SplitMethod>(existing?.method ?? "equal");
  const [rows, setRows] = useState<Row[]>(() => initialRows(existing));

  const totalMinor = fixedTotal ?? parseAmountToMinor(totalText) ?? 0;
  let preview: number[] | null = null;
  let problem: string | null = null;
  try {
    preview = allocateSplit(totalMinor, method, rows.map((r) => parseValue(method, r.value)));
  } catch (err) {
    problem = err instanceof SplitError ? err.message : "Check the amounts.";
  }
  if (!problem && rows.some((r) => !r.name.trim())) problem = "Give everyone a name.";
  if (!problem && !title.trim()) problem = "Add a title.";

  const save = useMutation(
    async () => {
      const body = {
        title: title.trim(),
        totalMinor,
        method,
        participants: rows.map((r) => ({ id: r.id, displayName: r.name.trim(), isOwner: r.isOwner, value: parseValue(method, r.value) })),
        ...(existing ? {} : { transactionId: transaction?.id }),
      };
      const res = existing ? await api.put<SplitDetailDto>(API_ROUTES.split(existing.id), body) : await api.post<SplitDetailDto>(API_ROUTES.splits, body);
      return res.data;
    },
    { successMessage: existing ? "Split updated. Anyone who agreed will be asked to reconfirm." : "Split created", onSuccess: onSaved },
  );

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Modal
      open={open}
      title={existing ? "Edit split" : "Split a payment"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.run()} disabled={Boolean(problem)} loading={save.pending}>
            {existing ? "Save changes" : "Create split"}
          </Button>
        </>
      }
    >
      <div className={styles.editor}>
        <div className={styles.grid}>
          <TextInput label="What was it for?" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner at …" />
          <TextInput
            label="Total (₹)"
            inputMode="decimal"
            value={totalText}
            onChange={(e) => setTotalText(e.target.value)}
            disabled={fixedTotal !== undefined}
          />
          <Select label="Split" options={METHOD_OPTIONS} value={method} onChange={(e) => setMethod(e.target.value as SplitMethod)} />
        </div>

        <ul className={styles.rows}>
          {rows.map((r, i) => (
            <li key={r.key} className={styles.row}>
              <TextInput aria-label="Name" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} disabled={r.isOwner} placeholder="Name" />
              {method !== "equal" && (
                <TextInput
                  aria-label={method === "exact" ? "Amount" : "Percent"}
                  inputMode="decimal"
                  value={r.value}
                  placeholder={method === "exact" ? "₹" : "%"}
                  onChange={(e) => update(r.key, { value: e.target.value })}
                  className={styles.value}
                />
              )}
              <span className={styles.share}>{preview ? <MoneyText minor={preview[i]} /> : "—"}</span>
              {!r.isOwner && (
                <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.name || "person"}`}>
                  ×
                </Button>
              )}
            </li>
          ))}
        </ul>
        {rows.length < SPLIT.MAX_PARTICIPANTS && (
          <div>
            <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newRow()])}>
              Add person
            </Button>
          </div>
        )}
        {problem ? <Alert tone="warning">{problem}</Alert> : <p className={styles.hint}>Only your share counts as your spending. Others&apos; shares show as money owed to you.</p>}
      </div>
    </Modal>
  );
}
