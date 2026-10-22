import "server-only";
import { getAdminClient } from "@/backend/supabase/clients";
import { RPC } from "@/backend/constants/db.constants";
import type { RateLimitPolicy } from "@/backend/constants/security.constants";
import { AppError } from "@/backend/errors/AppError";
import { logger } from "@/backend/logger/logger";

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Fixed-window counter stored in Postgres (works across serverless instances). */
export async function enforceRateLimit(bucket: string, subject: string, policy: RateLimitPolicy): Promise<void> {
  const { data, error } = await getAdminClient().rpc(RPC.RATE_LIMIT_HIT, {
    p_key: `${bucket}:${subject}`,
    p_window_seconds: policy.windowSeconds,
    p_max: policy.max,
  });
  if (error) {
    // Fail open on limiter outages so the app stays usable; the outage is logged loudly.
    logger.error({ err: error, bucket }, "rate limiter unavailable");
    return;
  }
  if (data === false) throw new AppError("RATE_LIMITED");
}
