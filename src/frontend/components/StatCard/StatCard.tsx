import type { ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import type { Tone } from "@/shared/constants/labels";
import styles from "./StatCard.module.css";

type StatCardProps = { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; loading?: boolean };

export function StatCard({ label, value, hint, tone = "neutral", loading }: StatCardProps) {
  return (
    <div className={cx(styles.card, styles[tone])}>
      <span className={styles.label}>{label}</span>
      <span className={cx(styles.value, "tabular", loading && styles.loading)}>{loading ? " " : value}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
