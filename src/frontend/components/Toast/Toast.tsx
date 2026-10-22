"use client";

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import type { Tone } from "@/shared/constants/labels";
import styles from "./Toast.module.css";

type ToastItem = { id: number; message: string; tone: Tone };
type ToastApi = { show: (message: string, tone?: Tone) => void };

const ToastContext = createContext<ToastApi | null>(null);
const DISMISS_MS = 4500;
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (message: string, tone: Tone = "neutral") => {
      const id = nextId++;
      setItems((list) => [...list.slice(-3), { id, message, tone }]);
      setTimeout(() => dismiss(id), DISMISS_MS);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext value={api}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx(styles.toast, styles[t.tone])}>
            <span>{t.message}</span>
            <button type="button" className={styles.close} onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const ctx = use(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
