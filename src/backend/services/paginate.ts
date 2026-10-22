import "server-only";
import type { PageMeta, PaginationQuery } from "@/shared/schemas/common";

/** Inclusive row range for PostgREST `.range(from, to)`. */
export function pageRange({ page, pageSize }: PaginationQuery): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

export function pageMeta({ page, pageSize }: PaginationQuery, total: number): PageMeta {
  return { page, pageSize, total };
}
