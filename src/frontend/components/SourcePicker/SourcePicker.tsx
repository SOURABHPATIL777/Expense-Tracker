"use client";

import { cx } from "@/frontend/lib/cx";
import { Select, optionsFrom } from "@/frontend/components/Select/Select";
import { BANKS, UPI_APPS, type SourceApp } from "@/shared/constants/enums";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import { FILE_FORMATS, SOURCE_CONFIG } from "@/shared/constants/sources";
import styles from "./SourcePicker.module.css";

const isBank = (v: SourceApp) => (BANKS as readonly string[]).includes(v);

/** UPI apps as primary choices; banks in a dropdown. Shows per-source export instructions from SOURCE_CONFIG. */
export function SourcePicker({ value, onChange }: { value: SourceApp | null; onChange: (v: SourceApp) => void }) {
  const config = value ? SOURCE_CONFIG[value] : null;
  return (
    <div className={styles.picker}>
      <div className={styles.apps} role="radiogroup" aria-label="UPI app">
        {UPI_APPS.map((app) => (
          <button
            key={app}
            type="button"
            role="radio"
            aria-checked={value === app}
            className={cx(styles.app, value === app && styles.selected)}
            onClick={() => onChange(app)}
          >
            {SOURCE_APP_LABELS[app]}
          </button>
        ))}
      </div>
      <Select
        label="…or a bank statement"
        placeholder="Choose bank"
        options={optionsFrom(BANKS, SOURCE_APP_LABELS)}
        value={value && isBank(value) ? value : ""}
        onChange={(e) => e.target.value && onChange(e.target.value as SourceApp)}
      />
      {config && (
        <div className={styles.help}>
          <p>
            <strong>How to get it:</strong> {config.howToExport}
          </p>
          <p className={styles.formats}>Accepted: {config.formats.map((f) => FILE_FORMATS[f].label).join(", ")}</p>
        </div>
      )}
    </div>
  );
}
