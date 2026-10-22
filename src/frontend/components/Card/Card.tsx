import type { ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import styles from "./Card.module.css";

type CardProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  padded?: boolean;
  className?: string;
};

export function Card({ title, description, actions, children, padded = true, className }: CardProps) {
  return (
    <section className={cx(styles.card, className)}>
      {(title || actions) && (
        <header className={styles.header}>
          <div>
            {title && <h2 className={styles.title}>{title}</h2>}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={cx(padded && styles.body)}>{children}</div>
    </section>
  );
}
