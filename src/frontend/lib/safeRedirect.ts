import { PAGE_ROUTES } from "@/shared/constants/routes";

/** Only same-site relative paths are allowed as post-login destinations (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback: string = PAGE_ROUTES.dashboard): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
