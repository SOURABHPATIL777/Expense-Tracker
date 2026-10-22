"use client";

import { useId, type InputHTMLAttributes } from "react";
import { Select, type Option } from "@/frontend/components/Select/Select";
import { useFieldError } from "./Form";
import styles from "./FormField.module.css";

type FieldProps = {
  name: string;
  label: string;
  hint?: string;
  type?: "text" | "email" | "password" | "number" | "date" | "datetime-local" | "textarea" | "select" | "checkbox";
  options?: readonly Option[];
  placeholder?: string;
  defaultValue?: string | number;
  defaultChecked?: boolean;
  required?: boolean;
  autoComplete?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  step?: string;
  min?: string;
  max?: string;
};

/** Label + control + hint + error, wired to the enclosing <Form>. */
export function FormField({ name, label, hint, type = "text", options = [], placeholder, defaultValue, defaultChecked, ...rest }: FieldProps) {
  const id = useId();
  const error = useFieldError(name);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const common = { id, name, "aria-invalid": Boolean(error), "aria-describedby": describedBy };

  if (type === "checkbox") {
    return (
      <div className={styles.field}>
        <label className={styles.checkbox}>
          {/* Unchecked boxes are absent from FormData; the hidden input makes them "false". */}
          <input type="hidden" name={name} value="false" />
          <input type="checkbox" {...common} value="true" defaultChecked={defaultChecked} />
          <span>{label}</span>
        </label>
        {hint && !error && <span id={`${id}-hint`} className={styles.hint}>{hint}</span>}
        {error && <span id={`${id}-error`} className={styles.error}>{error}</span>}
      </div>
    );
  }

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {type === "select" ? (
        <Select {...common} options={options} placeholder={placeholder} defaultValue={defaultValue} />
      ) : type === "textarea" ? (
        <textarea {...common} className={styles.textarea} placeholder={placeholder} defaultValue={defaultValue} rows={3} />
      ) : (
        <input {...common} {...rest} type={type} className={styles.input} placeholder={placeholder} defaultValue={defaultValue} />
      )}
      {hint && !error && <span id={`${id}-hint`} className={styles.hint}>{hint}</span>}
      {error && <span id={`${id}-error`} className={styles.error}>{error}</span>}
    </div>
  );
}
