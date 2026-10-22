"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Query } from "@/frontend/lib/apiClient";
import type { PageMeta } from "@/shared/schemas/common";

export type ApiState<T> = {
  data: T | undefined;
  meta: PageMeta | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
};

type Snapshot<T> = { key: string | null; data?: T; meta?: PageMeta; error?: ApiError };

/** The single data-fetching hook. Pass `null` as the url to skip fetching. Previous data stays visible while reloading. */
export function useApi<T>(url: string | null, query?: Query): ApiState<T> {
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ key: null });
  const queryKey = JSON.stringify(query ?? {});
  const requestKey = url ? `${url}|${queryKey}|${version}` : null;

  useEffect(() => {
    if (!url || !requestKey) return;
    const controller = new AbortController();
    api
      .get<T>(url, { query: JSON.parse(queryKey) as Query, signal: controller.signal })
      .then((res) => setSnapshot({ key: requestKey, data: res.data, meta: res.meta }))
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        const error = err instanceof ApiError ? err : new ApiError("UNKNOWN", String(err), 0);
        setSnapshot((prev) => ({ ...prev, key: requestKey, error }));
      });
    return () => controller.abort();
  }, [url, queryKey, requestKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return {
    data: snapshot.data,
    meta: snapshot.meta,
    error: snapshot.error,
    loading: requestKey !== null && snapshot.key !== requestKey,
    reload,
  };
}
