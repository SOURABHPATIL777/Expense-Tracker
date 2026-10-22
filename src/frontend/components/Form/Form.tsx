"use client";

import { createContext, use, useState, type FormEvent, type ReactNode } from "react";
import { z, type ZodType } from "zod";
import { ApiError } from "@/frontend/lib/apiClient";
import { Button } from "@/frontend/components/Button/Button";
import { Alert } from "@/frontend/components/Alert/Alert";
import styles from "./Form.module.css";

type FieldErrors = Record<string, string[] | undefined>;
const FormErrorsContext = createContext<FieldErrors>({});

export const useFieldError = (name: string) => use(FormErrorsContext)[name]?.[0];

type FormProps<S extends ZodType> = {
  schema: S;
  onSubmit: (values: z.infer<S>) => Promise<unknown>;
  children: ReactNode;
  submitLabel: string;
  /** Extra buttons rendered next to submit. */
  secondaryActions?: ReactNode;
  /** Reset native inputs after a successful submit. */
  resetOnSuccess?: boolean;
  layout?: "stack" | "grid";
};

/**
 * Every form in the app: collects field values, validates with a zod schema (the same field
 * schemas the API uses), shows per-field errors, and maps server 422 errors back onto fields.
 */
export function Form<S extends ZodType>({
  schema,
  onSubmit,
  children,
  submitLabel,
  secondaryActions,
  resetOnSuccess,
  layout = "stack",
}: FormProps<S>) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form).entries());
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      setErrors(z.flattenError(parsed.error).fieldErrors as FieldErrors);
      return;
    }
    setErrors({});
    setFormError(undefined);
    setPending(true);
    try {
      await onSubmit(parsed.data);
      if (resetOnSuccess) form.reset();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setFormError(err.message);
      } else {
        setFormError("Something went wrong.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <FormErrorsContext value={errors}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className={layout === "grid" ? styles.grid : styles.stack}>{children}</div>
        <div className={styles.actions}>
          <Button type="submit" loading={pending}>
            {submitLabel}
          </Button>
          {secondaryActions}
        </div>
      </form>
    </FormErrorsContext>
  );
}
