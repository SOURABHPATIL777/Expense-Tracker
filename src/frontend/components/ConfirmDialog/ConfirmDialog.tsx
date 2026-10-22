"use client";

import type { ReactNode } from "react";
import { Modal } from "@/frontend/components/Modal/Modal";
import { Button } from "@/frontend/components/Button/Button";
import styles from "./ConfirmDialog.module.css";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", destructive, pending, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.message}>{message}</div>
    </Modal>
  );
}
