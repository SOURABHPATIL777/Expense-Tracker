import type { ApiFailure, ApiSuccess, PageMeta } from "@/shared/schemas/common";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field errors from a 422 validation response, keyed by field name. */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return d?.fieldErrors ?? {};
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

type RequestOptions = {
  body?: unknown;
  query?: Query;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Retry when the request never got a response. Defaults to true for GET and keyed (idempotent) writes. */
  retry?: boolean;
};

/** Waits before each retry of a request that got no response (a dropped connection, a cold start). */
const RETRY_DELAYS_MS = [400, 1200];

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

export type ApiResult<T> = { data: T; meta?: PageMeta };

export function withQuery(url: string, query?: Query): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(method: string, url: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const retries = (opts.retry ?? (method === "GET" || Boolean(opts.idempotencyKey))) ? RETRY_DELAYS_MS : [];
  let res: Response | undefined;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await fetch(withQuery(url, opts.query), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: "same-origin",
        // A redirect here is never ours (API routes don't redirect): typically a hosting login page.
        redirect: "manual",
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      if (attempt >= retries.length) throw new ApiError("NETWORK", "Could not reach the server. Check your connection and try again.", 0);
      await sleep(retries[attempt], opts.signal);
    }
  }

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new ApiError("SESSION_REDIRECT", "Your session for this site has expired. Reload the page to sign in again.", res.status);
  }

  if (res.status === 204) return { data: null as T };
  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiFailure | null;
  if (!res.ok || !json || "error" in json) {
    const e = json && "error" in json ? json.error : undefined;
    throw new ApiError(e?.code ?? "UNKNOWN", e?.message ?? "Unexpected server response.", res.status, e?.requestId, e?.details);
  }
  return { data: json.data, meta: json.meta };
}

/** The only way the frontend talks to the backend. Paths come from `API_ROUTES`. */
export const api = {
  get: <T>(url: string, opts?: Omit<RequestOptions, "body">) => request<T>("GET", url, opts),
  post: <T>(url: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => request<T>("POST", url, { ...opts, body: body ?? {} }),
  patch: <T>(url: string, body: unknown, opts?: Omit<RequestOptions, "body">) => request<T>("PATCH", url, { ...opts, body }),
  put: <T>(url: string, body: unknown, opts?: Omit<RequestOptions, "body">) => request<T>("PUT", url, { ...opts, body }),
  del: <T = null>(url: string, opts?: Omit<RequestOptions, "body">) => request<T>("DELETE", url, opts),
};

export const newIdempotencyKey = () => crypto.randomUUID();
