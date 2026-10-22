import type { NextRequest } from "next/server";
import { handleProxy } from "@/backend/http/proxy";

export function proxy(request: NextRequest) {
  return handleProxy(request);
}

export const config = {
  // Pages only: API routes authenticate themselves, static assets need no session.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
