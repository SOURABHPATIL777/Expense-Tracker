import type { InputHTMLAttributes } from "react";
import { cx } from "@/frontend/lib/cx";
import styles from "./TextInput.module.css";

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { label?: string };

/** Standalone (non-form) input for filter bars; FormField covers inputs inside forms. */
export function TextInput({ label, className, ...rest }: TextInputProps) {
  const input = <input className={cx(styles.input, className)} {...rest} />;
  if (!label) return input;
  return (
    <label className={styles.labelled}>
      <span className={styles.label}>{label}</span>
      {input}
    </label>
  );
}
