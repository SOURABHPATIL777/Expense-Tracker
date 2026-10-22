import { Button } from "@/frontend/components/Button/Button";
import styles from "./Pagination.module.css";

export type PaginationProps = { page: number; pageSize: number; total: number; onPageChange: (page: number) => void };

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <span className={styles.summary}>
        {first}–{last} of {total}
      </span>
      <div className={styles.buttons}>
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
