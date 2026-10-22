import type { ReactNode } from "react";
import { Icon, type IconName } from "@/frontend/components/Icon/Icon";
import styles from "./EmptyState.module.css";

type EmptyStateProps = { title: string; description?: ReactNode; action?: ReactNode; icon?: IconName };

export function EmptyState({ title, description, action, icon = "sparkles" }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.badge} aria-hidden>
        <Icon name={icon} size={26} />
      </span>
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
