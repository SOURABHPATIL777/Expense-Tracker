import Link from "next/link";
import { cx } from "@/frontend/lib/cx";
import { PAGE_ROUTES } from "@/shared/constants/routes";
import type { ImportDto } from "@/shared/schemas/imports";
import styles from "./ProcessingPill.module.css";

/** "Reading <file>…" with a spinner while statements are being imported; links to the first one. */
export function ProcessingPill({ imports, className }: { imports: ImportDto[]; className?: string }) {
  const first = imports[0];
  if (!first) return null;
  const more = imports.length - 1;
  return (
    <Link href={PAGE_ROUTES.importReview(first.id)} className={cx(styles.pill, className)} title={first.fileName} aria-live="polite">
      <span className={styles.spinner} aria-hidden />
      <span className={styles.text}>
        <span className={styles.verb}>{first.status === "processing" ? "Matching" : "Reading"}</span> <span className={styles.name}>{first.fileName}</span>
      </span>
      {more > 0 && <span className={styles.more}>+{more}</span>}
    </Link>
  );
}
