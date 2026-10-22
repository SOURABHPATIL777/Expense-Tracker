"use client";

import { cx } from "@/frontend/lib/cx";
import styles from "./SegmentedControl.module.css";

type SegmentedControlProps<V extends string> = {
  label: string;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (value: V) => void;
  /** White-on-brand styling for use on the gradient hero. */
  onBrand?: boolean;
};

/** Pill toggle for a few mutually exclusive options; scrolls sideways on narrow screens. */
export function SegmentedControl<V extends string>({ label, options, value, onChange, onBrand }: SegmentedControlProps<V>) {
  return (
    <div className={cx(styles.group, onBrand && styles.onBrand)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx(styles.option, o.value === value && styles.selected)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
