"use client";

import { Button } from "@/frontend/components/Button/Button";
import styles from "./RowActions.module.css";

/** Edit/Delete buttons for a table row; clicks don't bubble to the row's own click handler. */
export function RowActions({ onEdit, onDelete, disabledDelete }: { onEdit?: () => void; onDelete?: () => void; disabledDelete?: boolean }) {
  return (
    <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
      {onEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
      )}
      {onDelete && (
        <Button variant="ghost" size="sm" onClick={onDelete} disabled={disabledDelete}>
          Delete
        </Button>
      )}
    </div>
  );
}
