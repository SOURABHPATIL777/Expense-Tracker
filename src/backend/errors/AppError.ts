import "server-only";
import { ERRORS, type ErrorCode } from "@/backend/constants/errors.constants";
import { PG_ERROR } from "@/backend/constants/db.constants";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Internal context for logs; never sent to the client. */
  readonly internal?: unknown;

  constructor(code: ErrorCode, options: { message?: string; details?: unknown; internal?: unknown; cause?: unknown } = {}) {
    super(options.message ?? ERRORS[code].message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERRORS[code].status;
    this.details = options.details;
    this.internal = options.internal;
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", { message: `${what} not found.` });
export const invalidState = (message?: string) => new AppError("INVALID_STATE", { message });
export const validationError = (details: unknown, message?: string) => new AppError("VALIDATION", { details, message });

type PgLikeError = { code?: string; message?: string; details?: string; hint?: string };

/** Maps a Supabase/PostgREST error to an AppError. Custom SQL errors raise `P0001` with `APP:<CODE>` text. */
export function fromDbError(error: PgLikeError, context?: string): AppError {
  const internal = { context, ...error };
  const appCode = error.message?.match(/^APP:([A-Z_]+)/)?.[1];
  if (appCode && appCode in ERRORS) return new AppError(appCode as ErrorCode, { internal });
  switch (error.code) {
    case PG_ERROR.UNIQUE_VIOLATION:
      return new AppError("CONFLICT", { internal });
    case PG_ERROR.NO_ROWS:
      return new AppError("NOT_FOUND", { internal });
    case PG_ERROR.INSUFFICIENT_PRIVILEGE:
      return new AppError("FORBIDDEN", { internal });
    case PG_ERROR.FOREIGN_KEY_VIOLATION:
    case PG_ERROR.CHECK_VIOLATION:
      return new AppError("VALIDATION", { internal });
    default:
      return new AppError("INTERNAL", { internal });
  }
}

/** Unwraps a Supabase `{ data, error }` result, throwing an AppError on failure. */
export function unwrap<T>(result: { data: T | null; error: PgLikeError | null }, context: string): T {
  if (result.error) throw fromDbError(result.error, context);
  if (result.data === null) throw new AppError("NOT_FOUND", { internal: { context } });
  return result.data;
}

/** Like `unwrap` but allows `null` data (e.g. `maybeSingle`). */
export function unwrapMaybe<T>(result: { data: T | null; error: PgLikeError | null }, context: string): T | null {
  if (result.error) throw fromDbError(result.error, context);
  return result.data;
}
