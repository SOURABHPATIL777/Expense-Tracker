import type { ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import type { Tone } from "@/shared/constants/labels";
import styles from "./Alert.module.css";

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={cx(styles.alert, styles[tone])} role={tone === "danger" ? "alert" : "status"}>
      {title && <strong className={styles.title}>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  );
}
