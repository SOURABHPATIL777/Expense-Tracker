import "server-only";
import { z } from "zod";
import type { Db } from "@/backend/supabase/clients";
import { TABLES, PG_ERROR } from "@/backend/constants/db.constants";
import { HEADERS } from "@/backend/constants/security.constants";
import { AppError, unwrapMaybe } from "@/backend/errors/AppError";

const keySchema = z.string().min(8).max(128).regex(/^[\w-]+$/);

/** Reads the required `Idempotency-Key` header sent by apiClient on retry-sensitive writes. */
export function readIdempotencyKey(req: Request): string {
  const raw = req.headers.get(HEADERS.IDEMPOTENCY_KEY);
  if (!raw) throw new AppError("VALIDATION", { message: "Idempotency-Key header is required." });
  const parsed = keySchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", { message: "Idempotency-Key header is malformed." });
  return parsed.data;
}

/**
 * Runs `fn` at most once per (user, scope, key). A retry with the same key returns the stored
 * result instead of repeating the side effect.
 */
export async function withIdempotency<T>(db: Db, userId: string, scope: string, key: string, fn: () => Promise<T>): Promise<T> {
  const existing = unwrapMaybe(
    await db.from(TABLES.IDEMPOTENCY_KEYS).select("response").eq("user_id", userId).eq("scope", scope).eq("key", key).maybeSingle(),
    "idempotency.lookup",
  ) as { response: T } | null;
  if (existing) return existing.response;

  const result = await fn();
  const { error } = await db.from(TABLES.IDEMPOTENCY_KEYS).insert({ user_id: userId, scope, key, response: result });
  // A concurrent duplicate already stored its result; ours is equivalent.
  if (error && error.code !== PG_ERROR.UNIQUE_VIOLATION) throw new AppError("INTERNAL", { internal: error });
  return result;
}
