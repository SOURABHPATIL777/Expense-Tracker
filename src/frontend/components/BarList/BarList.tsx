import styles from "./BarList.module.css";

export type BarItem = {
  key: string;
  label: string;
  value: number;
  /** Identity colour shown as a small dot beside the label (never on the bar or text). */
  dotColor?: string | null;
  /** Secondary detail for the tooltip, e.g. "12 payments". */
  detail?: string;
};

type BarListProps = {
  items: BarItem[];
  formatValue: (v: number) => string;
  /** Accessible name, e.g. "Spending by category". */
  label: string;
};

/**
 * Single-series horizontal bars (magnitude → one sequential hue). Every value is printed at the
 * bar tip, so the list doubles as its own table view; hover/focus adds the share of total.
 */
export function BarList({ items, formatValue, label }: BarListProps) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul className={styles.list} aria-label={label}>
      {items.map((item) => {
        const share = Math.round((item.value / total) * 100);
        const tip = `${formatValue(item.value)} · ${share}% of total${item.detail ? ` · ${item.detail}` : ""}`;
        return (
          <li key={item.key} className={styles.row} tabIndex={0} title={tip} aria-label={`${item.label}: ${tip}`}>
            <span className={styles.label}>
              <span className={styles.dot} style={{ background: item.dotColor ?? "var(--color-border-strong)" }} aria-hidden />
              <span className={styles.name}>{item.label}</span>
            </span>
            <span className={styles.track} aria-hidden>
              <span className={styles.bar} style={{ width: `${Math.max(1, (item.value / max) * 100)}%` }} />
            </span>
            <span className={styles.value}>{formatValue(item.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
