"use client";

import type { ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import { EmptyState } from "@/frontend/components/EmptyState/EmptyState";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { Alert } from "@/frontend/components/Alert/Alert";
import { Pagination, type PaginationProps } from "@/frontend/components/Pagination/Pagination";
import styles from "./DataTable.module.css";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  /** Hidden below the tablet breakpoint to keep rows readable on phones. */
  hideOnMobile?: boolean;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: { message: string } | null;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  onRowClick?: (row: T) => void;
  pagination?: PaginationProps;
  caption?: string;
};

/** The one table used by every list in the app. Below 640px each row becomes a card (labels from the headers). */
export function DataTable<T>({ columns, rows, rowKey, loading, error, empty, onRowClick, pagination, caption }: DataTableProps<T>) {
  if (error) return <Alert tone="danger" title="Could not load data">{error.message}</Alert>;
  if (loading && rows.length === 0) return <Skeleton lines={5} />;
  if (rows.length === 0) return <EmptyState title={empty?.title ?? "Nothing here yet"} description={empty?.description} action={empty?.action} />;

  return (
    <div className={styles.wrap}>
      <div className={cx(styles.scroller, loading && styles.refreshing)}>
        <table className={styles.table}>
          {caption && <caption className="visually-hidden">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" style={{ width: c.width }} className={cx(styles[c.align ?? "left"], c.hideOnMobile && styles.mobileHidden)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cx(onRowClick && styles.clickable)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} data-label={c.header || undefined} className={cx(styles[c.align ?? "left"], c.hideOnMobile && styles.mobileHidden)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && <Pagination {...pagination} />}
    </div>
  );
}
