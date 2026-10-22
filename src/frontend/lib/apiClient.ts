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
};

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

  let res: Response;
  try {
    res = await fetch(withQuery(url, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("NETWORK", "Could not reach the server. Check your connection.", 0);
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
