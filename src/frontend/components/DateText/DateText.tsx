import { formatDate, formatDateTime } from "@/frontend/lib/format";
import styles from "./DateText.module.css";

export function DateText({ iso, withTime }: { iso: string | null | undefined; withTime?: boolean }) {
  if (!iso) return <span className={styles.date}>—</span>;
  return (
    <time className={styles.date} dateTime={iso} title={formatDateTime(iso)}>
      {withTime ? formatDateTime(iso) : formatDate(iso)}
    </time>
  );
}
