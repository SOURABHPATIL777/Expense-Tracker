import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { getEnv } from "@/backend/config/env";
import { AppError } from "@/backend/errors/AppError";
import { API_ROUTES } from "@/backend/constants/routes.constants";
import { ProfilesRepository } from "@/backend/repositories/profiles.repository";
import type { AuthContext } from "@/backend/http/middleware/auth";
import type { LoginInput, MeDto, SignupInput, SignupResultDto } from "@/shared/schemas/auth";

/** Sign-in happens server-side so the browser never holds Supabase keys; session cookies are set on the response. */
export function authService(db: Db) {
  return {
    async signup(input: SignupInput): Promise<SignupResultDto> {
      const { data, error } = await db.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: { display_name: input.displayName },
          emailRedirectTo: `${getEnv().APP_URL}${API_ROUTES.auth.callback}`,
        },
      });
      // Supabase deliberately returns a generic response for existing emails; we mirror that.
      if (error) throw new AppError("VALIDATION", { message: error.message, internal: { code: error.code } });
      return { needsEmailConfirmation: !data.session };
    },

    async login(input: LoginInput): Promise<void> {
      const { error } = await db.auth.signInWithPassword({ email: input.email, password: input.password });
      if (error) throw new AppError("UNAUTHENTICATED", { message: "Incorrect email or password.", internal: { code: error.code } });
    },

    async logout(): Promise<void> {
      await db.auth.signOut();
    },

    async me(auth: AuthContext): Promise<MeDto> {
      const profile = auth.isAnonymous ? null : await new ProfilesRepository(db).find(auth.userId);
      return { id: auth.userId, email: auth.email, displayName: profile?.display_name ?? null, isAnonymous: auth.isAnonymous };
    },

    /** Email-confirmation / magic-link landing: exchanges the PKCE code for a session cookie. */
    async exchangeCode(code: string): Promise<boolean> {
      const { error } = await db.auth.exchangeCodeForSession(code);
      return !error;
    },
  };
}
