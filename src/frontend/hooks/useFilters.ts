"use client";

import { useCallback, useState } from "react";

/** Small filter-state helper shared by every list page. */
export function useFilters<F extends Record<string, string>>(initial: F) {
  const [filters, setFilters] = useState<F>(initial);
  const set = useCallback(<K extends keyof F>(key: K, value: F[K]) => setFilters((f) => ({ ...f, [key]: value })), []);
  const reset = useCallback(() => setFilters(initial), [initial]);
  return { filters, set, reset };
}
