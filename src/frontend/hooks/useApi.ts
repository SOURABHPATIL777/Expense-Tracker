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
      .then((res) => setSnapshot({ key: requestKey, dataKey, data: res.data, meta: res.meta }))
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        const error = err instanceof ApiError ? err : new ApiError("UNKNOWN", String(err), 0);
        setSnapshot((prev) => ({ ...prev, key: requestKey, error }));
      });
    return () => controller.abort();
  }, [url, queryKey, dataKey, requestKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // A failed refresh of data already on screen is "stale", not an error that replaces the page.
  const hasCurrentData = snapshot.data !== undefined && snapshot.dataKey === dataKey;
  return {
    data: snapshot.data,
    meta: snapshot.meta,
    error: hasCurrentData ? undefined : snapshot.error,
    stale: hasCurrentData && Boolean(snapshot.error),
    loading: requestKey !== null && snapshot.key !== requestKey,
    reload,
  };
}
