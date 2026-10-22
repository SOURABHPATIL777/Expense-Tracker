"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Modal.module.css";

type ModalProps = { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode };

/** Native <dialog>: focus trapping, Escape-to-close and inert background come from the browser. */
export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} aria-labelledby="modal-title">
      <header className={styles.header}>
        <h2 id="modal-title" className={styles.title}>
          {title}
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className={styles.body}>{open && children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </dialog>
  );
}
