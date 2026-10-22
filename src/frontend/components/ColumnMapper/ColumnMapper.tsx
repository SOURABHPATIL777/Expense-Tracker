"use client";

import { useState } from "react";
import { api } from "@/frontend/lib/apiClient";
import { useApi } from "@/frontend/hooks/useApi";
import { useMutation } from "@/frontend/hooks/useMutation";
import { Button } from "@/frontend/components/Button/Button";
import { Select, type Option } from "@/frontend/components/Select/Select";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { Alert } from "@/frontend/components/Alert/Alert";
import { cx } from "@/frontend/lib/cx";
import { API_ROUTES } from "@/shared/constants/routes";
import { DATE_FORMAT_OPTIONS, type ImportPreviewDto, type MappableField, type MappingInput } from "@/shared/schemas/imports";
import styles from "./ColumnMapper.module.css";

const FIELD_LABELS: Record<MappableField, { label: string; required?: boolean }> = {
  date: { label: "Date", required: true },
  time: { label: "Time" },
  narration: { label: "Description / narration" },
  counterparty: { label: "Paid to / received from" },
  vpa: { label: "UPI ID" },
  reference: { label: "UTR / reference no." },
  appTransactionId: { label: "App transaction ID" },
  balance: { label: "Balance" },
  note: { label: "Note / remarks" },
};

type AmountMode = MappingInput["amount"]["mode"];
const AMOUNT_MODES: Option[] = [
  { value: "split", label: "Separate debit and credit columns" },
  { value: "signed", label: "One amount column (− paid / + received, or Dr/Cr)" },
  { value: "typed", label: "Amount column + a type column (e.g. DEBIT / CREDIT)" },
];

const PREVIEW_DATA_ROWS = 6;
const toList = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);

/** Maps an unrecognised CSV/Excel layout once; the mapping is saved as a template for next time. */
export function ColumnMapper({ importId, onApplied }: { importId: string; onApplied: () => void }) {
  const preview = useApi<ImportPreviewDto>(API_ROUTES.importPreview(importId));
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [columns, setColumns] = useState<Partial<Record<MappableField, number>>>({});
  const [mode, setMode] = useState<AmountMode>("split");
  const [amountCols, setAmountCols] = useState<{ debit?: number; credit?: number; amount?: number; type?: number }>({});
  const [typeValues, setTypeValues] = useState({ debit: "DEBIT, DR, Paid", credit: "CREDIT, CR, Received" });
  const [dateFormat, setDateFormat] = useState<string>(DATE_FORMAT_OPTIONS[0]);
  const [saveTemplate, setSaveTemplate] = useState(true);

  const submit = useMutation((body: MappingInput) => api.post(API_ROUTES.importMapping(importId), body), {
    successMessage: "Mapping saved. Reading your file…",
    onSuccess: onApplied,
  });

  if (preview.error) return <Alert tone="danger">{preview.error.message}</Alert>;
  if (!preview.data) return <Skeleton lines={6} />;

  const rows = preview.data.rows;
  const hdr = headerRow ?? preview.data.suggestedHeaderRow;
  const header = rows[hdr] ?? [];
  const columnOptions: Option[] = header.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }));
  const pick = (v: string) => (v === "" ? undefined : Number(v));

  const amount = ((): MappingInput["amount"] | null => {
    if (mode === "split" && amountCols.debit !== undefined && amountCols.credit !== undefined) {
      return { mode, debit: amountCols.debit, credit: amountCols.credit };
    }
    if (mode === "signed" && amountCols.amount !== undefined) return { mode, amount: amountCols.amount };
    if (mode === "typed" && amountCols.amount !== undefined && amountCols.type !== undefined) {
      return { mode, amount: amountCols.amount, type: amountCols.type, debitValues: toList(typeValues.debit), creditValues: toList(typeValues.credit) };
    }
    return null;
  })();
  const ready = columns.date !== undefined && amount !== null;

  function apply() {
    if (!ready || !amount) return;
    submit.run({
      headerRowIndex: hdr,
      columns: { ...columns, date: columns.date! },
      amount,
      dateFormat: dateFormat as MappingInput["dateFormat"],
      saveTemplate,
    });
  }

  const amountField = (key: keyof typeof amountCols, label: string) => (
    <Select key={key} label={label} placeholder="Choose column" options={columnOptions} value={amountCols[key]?.toString() ?? ""} onChange={(e) => setAmountCols((a) => ({ ...a, [key]: pick(e.target.value) }))} />
  );

  return (
    <div className={styles.mapper}>
      <div className={styles.previewWrap}>
        <table className={styles.preview}>
          <tbody>
            {rows.slice(hdr, hdr + PREVIEW_DATA_ROWS + 1).map((row, i) => (
              <tr key={i} className={cx(i === 0 && styles.headerRow)}>
                {row.map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.grid}>
        <Select
          label="Row with column names"
          options={rows.slice(0, 25).map((r, i) => ({ value: String(i), label: `Row ${i + 1}: ${r.filter(Boolean).slice(0, 3).join(" | ")}` }))}
          value={String(hdr)}
          onChange={(e) => {
            setHeaderRow(Number(e.target.value));
            setColumns({});
            setAmountCols({});
          }}
        />
        <Select label="Date format" options={DATE_FORMAT_OPTIONS.map((f) => ({ value: f, label: f }))} value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} />
      </div>

      <fieldset className={styles.fieldset}>
        <legend>Which column holds…</legend>
        <div className={styles.grid}>
          {(Object.keys(FIELD_LABELS) as MappableField[]).map((field) => (
            <Select
              key={field}
              label={`${FIELD_LABELS[field].label}${FIELD_LABELS[field].required ? " *" : ""}`}
              placeholder={FIELD_LABELS[field].required ? "Choose column" : "— not in file —"}
              options={columnOptions}
              value={columns[field]?.toString() ?? ""}
              onChange={(e) => setColumns((c) => ({ ...c, [field]: pick(e.target.value) }))}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Amounts *</legend>
        <div className={styles.grid}>
          <Select label="Layout" options={AMOUNT_MODES} value={mode} onChange={(e) => setMode(e.target.value as AmountMode)} />
          {mode === "split" && [amountField("debit", "Debit / withdrawal"), amountField("credit", "Credit / deposit")]}
          {mode !== "split" && amountField("amount", "Amount")}
          {mode === "typed" && amountField("type", "Type column")}
        </div>
        {mode === "typed" && (
          <div className={styles.grid}>
            <label className={styles.text}>
              <span>Values meaning money out</span>
              <input className={styles.input} value={typeValues.debit} onChange={(e) => setTypeValues((t) => ({ ...t, debit: e.target.value }))} />
            </label>
            <label className={styles.text}>
              <span>Values meaning money in</span>
              <input className={styles.input} value={typeValues.credit} onChange={(e) => setTypeValues((t) => ({ ...t, credit: e.target.value }))} />
            </label>
          </div>
        )}
      </fieldset>

      <label className={styles.checkbox}>
        <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} />
        Remember this layout for future files
      </label>

      <div>
        <Button onClick={apply} disabled={!ready} loading={submit.pending}>
          Import with this mapping
        </Button>
      </div>
    </div>
  );
}
