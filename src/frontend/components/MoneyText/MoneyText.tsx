import { cx } from "@/frontend/lib/cx";
import { formatInr } from "@/frontend/lib/format";
import type { Direction } from "@/shared/constants/enums";
import styles from "./MoneyText.module.css";

type MoneyTextProps = {
  minor: number;
  /** When given, credits render with a "+" and success colour, debits with "−". */
  direction?: Direction;
  muted?: boolean;
  strong?: boolean;
};

export function MoneyText({ minor, direction, muted, strong }: MoneyTextProps) {
  const sign = direction === "credit" ? "+" : direction === "debit" ? "−" : "";
  return (
    <span className={cx("tabular", styles.money, direction && styles[direction], muted && styles.muted, strong && styles.strong)}>
      {sign}
      {formatInr(Math.abs(minor))}
    </span>
  );
}
