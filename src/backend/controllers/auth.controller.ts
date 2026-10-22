import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { withHandler, created, noContent } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { RATE_LIMITS } from "@/backend/constants/security.constants";
import { PAGE_ROUTES } from "@/backend/constants/routes.constants";
import { authService } from "@/backend/services/auth.service";
import { loginSchema, signupSchema } from "@/shared/schemas/auth";

const authRateLimit = { bucket: "auth", policy: RATE_LIMITS.AUTH, by: "ip" as const };

export const authController = {
  signup: withHandler({ auth: AUTH_MODES.PUBLIC, body: signupSchema, rateLimit: authRateLimit }, async ({ db, body }) =>
    created(await authService(db).signup(body)),
  ),

  login: withHandler({ auth: AUTH_MODES.PUBLIC, body: loginSchema, rateLimit: authRateLimit }, async ({ db, body }) => {
    await authService(db).login(body);
    return noContent();
  }),

  logout: withHandler({ auth: AUTH_MODES.PUBLIC }, async ({ db }) => {
    await authService(db).logout();
    return noContent();
  }),

  me: withHandler({ auth: AUTH_MODES.SESSION }, async ({ db, auth }) => authService(db).me(auth)),

  callback: withHandler(
    { auth: AUTH_MODES.PUBLIC, query: z.object({ code: z.string().min(1).max(512) }) },
    async ({ db, query, req }) => {
      const ok = await authService(db).exchangeCode(query.code);
      const target = ok ? PAGE_ROUTES.dashboard : `${PAGE_ROUTES.login}?error=link`;
      return NextResponse.redirect(new URL(target, req.url));
    },
  ),
};
