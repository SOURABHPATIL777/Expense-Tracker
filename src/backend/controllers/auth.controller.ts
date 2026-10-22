import "server-only";
import { NextResponse } from "next/server";
import { withHandler, created, noContent } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { RATE_LIMITS } from "@/backend/constants/security.constants";
import { PAGE_ROUTES } from "@/backend/constants/routes.constants";
import { authService, readEmailLink } from "@/backend/services/auth.service";
import { loginSchema, resendSchema, signupSchema } from "@/shared/schemas/auth";

const authRateLimit = { bucket: "auth", policy: RATE_LIMITS.AUTH, by: "ip" as const };

/** The site the request came to (production, a preview or localhost), for links sent by email. */
const originOf = (req: Request) => new URL(req.url).origin;

export const authController = {
  signup: withHandler({ auth: AUTH_MODES.PUBLIC, body: signupSchema, rateLimit: authRateLimit }, async ({ db, body, req }) =>
    created(await authService(db).signup(body, originOf(req))),
  ),

  resend: withHandler({ auth: AUTH_MODES.PUBLIC, body: resendSchema, rateLimit: authRateLimit }, async ({ db, body, req }) => {
    await authService(db).resendConfirmation(body, originOf(req));
    return noContent();
  }),

  login: withHandler({ auth: AUTH_MODES.PUBLIC, body: loginSchema, rateLimit: authRateLimit }, async ({ db, body }) => {
    await authService(db).login(body);
    return noContent();
  }),

  logout: withHandler({ auth: AUTH_MODES.PUBLIC }, async ({ db }) => {
    await authService(db).logout();
    return noContent();
  }),

  me: withHandler({ auth: AUTH_MODES.SESSION }, async ({ db, auth }) => authService(db).me(auth)),

  realtime: withHandler({ auth: AUTH_MODES.USER }, async ({ db, auth }) => authService(db).realtimeToken(auth)),

  /** Email links land here; every outcome is a redirect to a page, never a JSON error. */
  callback: withHandler({ auth: AUTH_MODES.PUBLIC }, async ({ db, req }) => {
    const ok = await authService(db).completeEmailLink(readEmailLink(new URL(req.url).searchParams));
    const target = ok ? PAGE_ROUTES.dashboard : `${PAGE_ROUTES.login}?error=link_expired`;
    return NextResponse.redirect(new URL(target, req.url));
  }),
};
