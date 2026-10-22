"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/frontend/lib/apiClient";
import { useToast } from "@/frontend/components/Toast/Toast";

type Options<R> = {
  /** Toast shown on success; omit for silent mutations. */
  successMessage?: string | ((result: R) => string);
  onSuccess?: (result: R) => void;
  /** Set false when the caller renders the error itself (e.g. inline form errors). */
  toastErrors?: boolean;
};

/** Wraps any API write with pending/error state and consistent toasts. */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>, options: Options<R> = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError>();
  const toast = useToast();
  const { successMessage, onSuccess, toastErrors = true } = options;

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(undefined);
      try {
        const result = await fn(...args);
        if (successMessage) toast.show(typeof successMessage === "function" ? successMessage(result) : successMessage, "success");
        onSuccess?.(result);
        return result;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError("UNKNOWN", String(err), 0);
        setError(apiError);
        if (toastErrors) toast.show(apiError.message, "danger");
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn, successMessage, onSuccess, toastErrors, toast],
  );

  return { run, pending, error };
}
