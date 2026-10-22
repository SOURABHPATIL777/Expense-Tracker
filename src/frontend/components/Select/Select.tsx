import type { SelectHTMLAttributes } from "react";
import { cx } from "@/frontend/lib/cx";
import styles from "./Select.module.css";

export type Option = { value: string; label: string };

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  options: readonly Option[];
  placeholder?: string;
  /** Visible label for standalone (filter-bar) usage; FormField supplies its own. */
  label?: string;
};

export function Select({ options, placeholder, label, className, ...rest }: SelectProps) {
  const select = (
    <select className={cx(styles.select, className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (!label) return select;
  return (
    <label className={styles.labelled}>
      <span className={styles.label}>{label}</span>
      {select}
    </label>
  );
}

/** Builds options from an enum tuple and its label map. */
export function optionsFrom<T extends string>(values: readonly T[], labels: Record<T, string | { label: string }>): Option[] {
  return values.map((value) => {
    const l = labels[value];
    return { value, label: typeof l === "string" ? l : l.label };
  });
}
