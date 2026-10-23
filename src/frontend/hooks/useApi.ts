"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Query } from "@/frontend/lib/apiClient";
import type { PageMeta } from "@/shared/schemas/common";

export type ApiState<T> = {
  data: T | undefined;
  meta: PageMeta | undefined;
  /** Set only when there is nothing to show for this request. */
  error: ApiError | undefined;
  /** The last refresh failed but earlier data for the same request is still shown (e.g. a dropped poll). */
  stale: boolean;
  loading: boolean;
  reload: () => void;
};

type Snapshot<T> = { key: string | null; dataKey: string | null; data?: T; meta?: PageMeta; error?: ApiError };
type CacheEntry = { data: unknown; meta?: PageMeta };

/**
 * Last response per request, kept for the tab's lifetime: revisiting a page shows its data at once
 * while a fresh copy loads in the background (stale-while-revalidate). Bounded; cleared on sign-out.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_MAX_ENTRIES = 60;

function remember(key: string, entry: CacheEntry) {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/** Forget every cached response (on sign-out, so the next account never sees the last one's data). */
export function clearApiCache(): void {
  cache.clear();
}

/** The single data-fetching hook. Pass `null` as the url to skip fetching. Previous data stays visible while reloading. */
export function useApi<T>(url: string | null, query?: Query): ApiState<T> {
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ key: null, dataKey: null });
  const queryKey = JSON.stringify(query ?? {});
  /** What is being fetched; `requestKey` adds the reload counter. */
  const dataKey = url ? `${url}|${queryKey}` : null;
  const requestKey = dataKey ? `${dataKey}|${version}` : null;

  useEffect(() => {
    if (!dataKey || !requestKey || !url) return;
    const controller = new AbortController();
    api
      .get<T>(url, { query: JSON.parse(queryKey) as Query, signal: controller.signal })
      .then((res) => {
        remember(dataKey, { data: res.data, meta: res.meta });
        setSnapshot({ key: requestKey, dataKey, data: res.data, meta: res.meta });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        const error = err instanceof ApiError ? err : new ApiError("UNKNOWN", String(err), 0);
        setSnapshot((prev) => ({ ...prev, key: requestKey, error }));
      });
    return () => controller.abort();
  }, [url, queryKey, dataKey, requestKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const fresh = snapshot.data !== undefined && snapshot.dataKey === dataKey;
  const cached = !fresh && dataKey ? cache.get(dataKey) : undefined;
  // This request's own data first, then the cached copy from an earlier visit, then whatever was
  // shown before (e.g. the previous filter's rows while the new ones load).
  const shown: { data?: T; meta?: PageMeta } = fresh ? snapshot : cached ? { data: cached.data as T, meta: cached.meta } : snapshot;
  const hasCurrentData = fresh || cached !== undefined;
  return {
    data: shown.data,
    meta: shown.meta,
    // A failed refresh of data already on screen is "stale", not an error that replaces the page.
    error: hasCurrentData ? undefined : snapshot.error,
    stale: hasCurrentData && Boolean(snapshot.error) && snapshot.key === requestKey,
    loading: requestKey !== null && snapshot.key !== requestKey,
    reload,
  };
}
