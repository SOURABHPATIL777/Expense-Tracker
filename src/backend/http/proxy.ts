import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getEnv } from "@/backend/config/env";
import { PAGE_ROUTES, PROTECTED_PAGE_PREFIXES } from "@/backend/constants/routes.constants";

const isProtected = (path: string) => PROTECTED_PAGE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
const isAuthPage = (path: string) => path === PAGE_ROUTES.login || path === PAGE_ROUTES.signup;

/**
 * Runs before every page request: refreshes the Supabase session cookies and performs an
 * optimistic redirect for signed-out visitors. Real authorization happens again in the API.
 */
export async function handleProxy(request: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const isUser = Boolean(claims?.sub) && claims?.is_anonymous !== true;
  const path = request.nextUrl.pathname;

  if (isProtected(path) && !isUser) return redirectKeepingCookies(request, response, PAGE_ROUTES.login, path);
  if ((isAuthPage(path) || path === PAGE_ROUTES.home) && isUser) {
    return redirectKeepingCookies(request, response, PAGE_ROUTES.dashboard);
  }
  return response;
}

function redirectKeepingCookies(request: NextRequest, from: NextResponse, to: string, next?: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
