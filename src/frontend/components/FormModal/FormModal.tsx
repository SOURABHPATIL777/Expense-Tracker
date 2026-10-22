"use client";

import type { ReactNode } from "react";
import type { ZodType, z } from "zod";
import { Modal } from "@/frontend/components/Modal/Modal";
import { Form } from "@/frontend/components/Form/Form";
import styles from "./FormModal.module.css";

type FormModalProps<S extends ZodType> = {
  open: boolean;
  title: string;
  schema: S;
  onSubmit: (values: z.infer<S>) => Promise<unknown>;
  onClose: () => void;
  submitLabel?: string;
  intro?: ReactNode;
  children: ReactNode;
};

/** Modal + Form: every create/edit dialog in the app. */
export function FormModal<S extends ZodType>({ open, title, schema, onSubmit, onClose, submitLabel = "Save", intro, children }: FormModalProps<S>) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      {intro && <div className={styles.intro}>{intro}</div>}
      <Form schema={schema} onSubmit={onSubmit} submitLabel={submitLabel}>
        {children}
      </Form>
    </Modal>
  );
}
