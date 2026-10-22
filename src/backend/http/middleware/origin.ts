import "server-only";
import { getEnv } from "@/backend/config/env";
import { AppError } from "@/backend/errors/AppError";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF defence for cookie-authenticated writes: the Origin header must be our own app. */
export function assertSameOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  const allowed = new URL(getEnv().APP_URL).origin;
  const requestOrigin = new URL(req.url).origin;
  if (!origin || (origin !== allowed && origin !== requestOrigin)) throw new AppError("BAD_ORIGIN");
}
