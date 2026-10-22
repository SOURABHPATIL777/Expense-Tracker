"use client";

import { useState } from "react";
import { useApi } from "./useApi";
import type { Query } from "@/frontend/lib/apiClient";
import { PAGINATION } from "@/shared/constants/limits";

/** Paged list backed by useApi; resets to page 1 whenever filters change. */
export function usePaginatedList<T>(url: string, filters: Query = {}, pageSize: number = PAGINATION.DEFAULT_PAGE_SIZE) {
  const filterKey = JSON.stringify(filters);
  const [pageState, setPageState] = useState({ page: 1, filterKey });
  // Derived reset: a new filter set always starts from the first page.
  const page = pageState.filterKey === filterKey ? pageState.page : 1;
  const state = useApi<T[]>(url, { ...filters, page, pageSize });
  return {
    ...state,
    rows: state.data ?? [],
    page,
    pageSize,
    total: state.meta?.total ?? 0,
    setPage: (next: number) => setPageState({ page: next, filterKey }),
  };
}
