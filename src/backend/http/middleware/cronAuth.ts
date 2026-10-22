import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/backend/config/env";
import { AppError } from "@/backend/errors/AppError";
import { HEADERS } from "@/backend/constants/security.constants";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function assertCronSecret(req: Request): void {
  const header = req.headers.get(HEADERS.CRON_AUTH) ?? "";
  const expected = Buffer.from(`Bearer ${getEnv().CRON_SECRET}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AppError("UNAUTHENTICATED");
  }
}
