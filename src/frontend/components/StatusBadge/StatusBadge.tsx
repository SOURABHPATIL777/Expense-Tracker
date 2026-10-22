import { cx } from "@/frontend/lib/cx";
import type { LabelMap, Tone } from "@/shared/constants/labels";
import styles from "./StatusBadge.module.css";

/** Renders any enum value through its shared label map so wording and colours stay consistent. */
export function StatusBadge<T extends string>({ value, map }: { value: T; map: LabelMap<T> }) {
  const entry = map[value] ?? { label: value, tone: "neutral" as Tone };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cx(styles.badge, styles[tone])}>{children}</span>;
}
