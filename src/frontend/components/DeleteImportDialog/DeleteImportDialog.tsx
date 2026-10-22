"use client";

import { Modal } from "@/frontend/components/Modal/Modal";
import { Button } from "@/frontend/components/Button/Button";
import { ConfirmDialog } from "@/frontend/components/ConfirmDialog/ConfirmDialog";
import { useMutation } from "@/frontend/hooks/useMutation";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import type { ImportDeleteMode } from "@/shared/constants/enums";
import type { ImportDto } from "@/shared/schemas/imports";
import styles from "./DeleteImportDialog.module.css";

type DeleteImportDialogProps = {
  /** The import to delete; the dialog is closed when null. */
  imp: ImportDto | null;
  onClose: () => void;
  onDeleted: (mode: ImportDeleteMode) => void;
};

const SUCCESS: Record<ImportDeleteMode, string> = { file: "File deleted, transactions kept", all: "File and its transactions deleted" };

/**
 * Deleting a statement. A completed import offers two choices, with "Delete file only" (keep the
 * transactions) as the highlighted default; anything else is a single confirmation.
 */
export function DeleteImportDialog({ imp, onClose, onDeleted }: DeleteImportDialogProps) {
  const remove = useMutation((id: string, mode: ImportDeleteMode) => api.del(API_ROUTES.import(id), { query: { mode } }).then(() => mode), {
    successMessage: (mode) => SUCCESS[mode],
    onSuccess: (mode) => {
      onClose();
      onDeleted(mode);
    },
  });
  const open = imp !== null;
  const processed = imp?.status === "completed";

  if (!processed || imp?.fileDeletedAt) {
    return (
      <ConfirmDialog
        open={open}
        title={imp?.fileDeletedAt ? "Delete these transactions?" : "Delete this file?"}
        message={
          imp?.fileDeletedAt
            ? "The statement file is already deleted. This removes the import and the transactions that came only from it; transactions also found in another import are kept."
            : "The file is removed, along with anything it partly imported."
        }
        confirmLabel={imp?.fileDeletedAt ? "Delete transactions" : "Delete"}
        destructive
        pending={remove.pending}
        onConfirm={() => imp && remove.run(imp.id, "all")}
        onCancel={onClose}
      />
    );
  }

  return (
    <Modal
      open={open}
      title="Delete this statement?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={remove.pending}>
            Cancel
          </Button>
          <Button variant="secondary" className={styles.dangerText} onClick={() => remove.run(imp.id, "all")} disabled={remove.pending}>
            Delete transactions too
          </Button>
          <Button onClick={() => remove.run(imp.id, "file")} loading={remove.pending} autoFocus>
            Delete file only
          </Button>
        </>
      }
    >
      <ul className={styles.choices}>
        <li className={styles.recommended}>
          <strong>Delete file only</strong> (recommended): the statement file is removed; its {imp.counts.imported} transactions stay in your records.
        </li>
        <li>
          <strong>Delete transactions too</strong>: also removes the transactions that came only from this file. Transactions also found in another import are
          kept.
        </li>
      </ul>
    </Modal>
  );
}
