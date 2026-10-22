import "server-only";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { createUserClient, type Db } from "@/backend/supabase/clients";
import { AppError } from "@/backend/errors/AppError";
import { childLogger, type Logger } from "@/backend/logger/logger";
import { AUTH_MODES, type AuthMode } from "@/backend/constants/enums.constants";
import { HEADERS, type RateLimitPolicy } from "@/backend/constants/security.constants";
import { assertAuth, readAuth, type AuthContext } from "./middleware/auth";
import { assertSameOrigin } from "./middleware/origin";
import { assertCronSecret } from "./middleware/cronAuth";
import { clientIp, enforceRateLimit } from "./middleware/rateLimit";
import { kickWorkerOpportunistically } from "@/backend/jobs/worker";
import type { ApiFailure, ApiSuccess, PageMeta } from "@/shared/schemas/common";

type Infer<S> = S extends ZodType ? z.infer<S> : undefined;

type HandlerOptions<B, Q, P> = {
  auth: AuthMode;
  body?: B;
  query?: Q;
  params?: P;
  rateLimit?: { bucket: string; policy: RateLimitPolicy; by?: "user" | "ip" };
  /** Extra response headers (e.g. guest no-store). */
  headers?: ReadonlyArray<{ key: string; value: string }>;
};

type AuthFor<M extends AuthMode> = M extends typeof AUTH_MODES.USER | typeof AUTH_MODES.SESSION ? AuthContext : AuthContext | null;

export type HandlerContext<B, Q, P, M extends AuthMode = AuthMode> = {
  req: NextRequest;
  requestId: string;
  log: Logger;
  db: Db;
  auth: AuthFor<M>;
  body: Infer<B>;
  query: Infer<Q>;
  params: Infer<P>;
};

/** Return from a handler to control status/meta; plain values become `{ data }` with 200. */
export class HttpResult<T> {
  constructor(
    readonly data: T,
    readonly status = 200,
    readonly meta?: PageMeta,
  ) {}
}
export const created = <T>(data: T) => new HttpResult(data, 201);
export const paged = <T>(data: T, meta: PageMeta) => new HttpResult(data, 200, meta);
export const noContent = () => new HttpResult(null, 204);

type RouteContext = { params: Promise<Record<string, string | string[]>> };

/**
 * The single wrapper every API route goes through: request id, auth, CSRF, rate limiting,
 * zod validation, consistent JSON envelope, error mapping and structured logging.
 */
export function withHandler<
  M extends AuthMode,
  B extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
  P extends ZodType | undefined = undefined,
>(options: HandlerOptions<B, Q, P> & { auth: M }, handler: (ctx: HandlerContext<B, Q, P, M>) => Promise<unknown>) {
  return async function route(req: NextRequest, routeCtx: RouteContext): Promise<Response> {
    const requestId = req.headers.get(HEADERS.REQUEST_ID) ?? randomUUID();
    const started = performance.now();
    const log = childLogger({ requestId, method: req.method, path: req.nextUrl.pathname });
    const extraHeaders = options.headers ?? [];

    try {
      if (options.auth === AUTH_MODES.CRON) assertCronSecret(req);
      else assertSameOrigin(req);

      const db = await createUserClient();
      const auth = options.auth === AUTH_MODES.CRON ? null : await readAuth(db);
      assertAuth(options.auth, auth);

      if (options.rateLimit) {
        const subject = options.rateLimit.by === "ip" || !auth ? clientIp(req) : auth.userId;
        await enforceRateLimit(options.rateLimit.bucket, subject, options.rateLimit.policy);
      }

      const params = options.params ? parseOrThrow(options.params, await routeCtx.params) : undefined;
      const query = options.query ? parseOrThrow(options.query, Object.fromEntries(req.nextUrl.searchParams)) : undefined;
      const body = options.body ? parseOrThrow(options.body, await readJson(req)) : undefined;

      const result = await handler({ req, requestId, log, db, auth, body, query, params } as HandlerContext<B, Q, P, M>);
      // Signed-in traffic doubles as the job scheduler (see kickWorkerOpportunistically).
      if (options.auth === AUTH_MODES.USER) kickWorkerOpportunistically();
      const response = toResponse(result, requestId, extraHeaders);
      log.info({ status: response.status, ms: Math.round(performance.now() - started), userId: auth?.userId }, "request");
      return response;
    } catch (err) {
      const appError = err instanceof AppError ? err : new AppError("INTERNAL", { cause: err });
      const level = appError.status >= 500 ? "error" : "warn";
      log[level](
        { status: appError.status, code: appError.code, internal: appError.internal, err: appError.cause ?? undefined },
        appError.message,
      );
      const payload: ApiFailure = {
        error: { code: appError.code, message: appError.message, requestId, details: appError.details },
      };
      return json(payload, appError.status, requestId, extraHeaders);
    }
  };
}

function parseOrThrow<S extends ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", { details: z.flattenError(parsed.error) });
  return parsed.data;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION", { message: "Request body must be valid JSON." });
  }
}

function toResponse(result: unknown, requestId: string, headers: HandlerOptions<unknown, unknown, unknown>["headers"]): Response {
  if (result instanceof Response) {
    result.headers.set(HEADERS.REQUEST_ID, requestId);
    return result;
  }
  if (result instanceof HttpResult) {
    if (result.status === 204) return new Response(null, { status: 204, headers: { [HEADERS.REQUEST_ID]: requestId } });
    const body: ApiSuccess<unknown> = result.meta ? { data: result.data, meta: result.meta } : { data: result.data };
    return json(body, result.status, requestId, headers);
  }
  return json({ data: result ?? null } satisfies ApiSuccess<unknown>, 200, requestId, headers);
}

function json(body: unknown, status: number, requestId: string, headers: HandlerOptions<unknown, unknown, unknown>["headers"] = []) {
  const res = Response.json(body, { status });
  res.headers.set(HEADERS.REQUEST_ID, requestId);
  res.headers.set("Cache-Control", "private, no-store");
  for (const { key, value } of headers ?? []) res.headers.set(key, value);
  return res;
}
