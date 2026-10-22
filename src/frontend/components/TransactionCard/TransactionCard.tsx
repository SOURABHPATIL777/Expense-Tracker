import type { ReactNode } from "react";
import { MoneyText } from "@/frontend/components/MoneyText/MoneyText";
import { DateText } from "@/frontend/components/DateText/DateText";
import { CategoryChip } from "@/frontend/components/CategoryChip/CategoryChip";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import type { SourceApp } from "@/shared/constants/enums";
import type { CategoryDto } from "@/shared/schemas/categories";
import type { TransactionSummaryDto } from "@/shared/schemas/review";
import styles from "./TransactionCard.module.css";

/** Compact transaction summary used in review items and matching dialogs. */
export function TransactionCard({ tx, category, label }: { tx: TransactionSummaryDto; category?: CategoryDto | null; label?: ReactNode }) {
  return (
    <div className={styles.card}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.top}>
        <strong className={styles.merchant}>{tx.merchant ?? "Unknown merchant"}</strong>
        <MoneyText minor={tx.amountMinor} direction={tx.direction} strong />
      </div>
      <div className={styles.meta}>
        <DateText iso={tx.occurredAt} withTime />
        <span>{SOURCE_APP_LABELS[tx.sourceApp as SourceApp] ?? tx.sourceApp}</span>
        {tx.referenceId && <span>UTR {tx.referenceId}</span>}
      </div>
      {category !== undefined && <CategoryChip category={category} />}
    </div>
  );
}
