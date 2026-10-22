import Link from "next/link";
import type { ReactNode } from "react";
import { PAGE_ROUTES } from "@/shared/constants/routes";
import styles from "./AuthCard.module.css";

/** Centered card used by the sign-in, sign-up and guest pages. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className={styles.page}>
      <Link href={PAGE_ROUTES.home} className={styles.brand}>
        <span className={styles.logo} aria-hidden>
          ₹
        </span>
        UPI Spend
      </Link>
      <section className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </header>
        {children}
      </section>
      {footer && <p className={styles.footer}>{footer}</p>}
    </main>
  );
}
