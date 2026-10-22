import "server-only";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { Db } from "@/backend/supabase/clients";
import { getEnv } from "@/backend/config/env";
import { AppError } from "@/backend/errors/AppError";
import { API_ROUTES } from "@/backend/constants/routes.constants";
import { ProfilesRepository } from "@/backend/repositories/profiles.repository";
import type { AuthContext } from "@/backend/http/middleware/auth";
import type { LoginInput, MeDto, RealtimeTokenDto, ResendInput, SignupInput, SignupResultDto } from "@/shared/schemas/auth";

/** What an email link brought back to the callback. */
export type EmailLinkResult = { kind: "code"; code: string } | { kind: "token"; tokenHash: string; type: EmailOtpType } | { kind: "error"; reason: string };

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["signup", "email", "invite", "magiclink", "recovery", "email_change"];

/**
 * Reads the callback's query: a PKCE `code`, a `token_hash` + `type` (works on any device and
 * survives email scanners opening the link first), or Supabase's `error_code` (e.g. otp_expired).
 */
export function readEmailLink(params: URLSearchParams): EmailLinkResult {
  const errorCode = params.get("error_code") ?? params.get("error");
  if (errorCode) return { kind: "error", reason: errorCode };
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  if (tokenHash && type && EMAIL_OTP_TYPES.includes(type)) return { kind: "token", tokenHash, type };
  const code = params.get("code");
  if (code) return { kind: "code", code };
  return { kind: "error", reason: "missing_code" };
}

/** Where confirmation links should land: the site the user signed up on. */
const callbackUrl = (origin: string) => `${origin || getEnv().APP_URL}${API_ROUTES.auth.callback}`;

/** Sign-in happens server-side so the browser never holds Supabase keys; session cookies are set on the response. */
export function authService(db: Db) {
  return {
    async signup(input: SignupInput, origin: string): Promise<SignupResultDto> {
      const { data, error } = await db.auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: { display_name: input.displayName }, emailRedirectTo: callbackUrl(origin) },
      });
      // Supabase deliberately returns a generic response for existing emails; we mirror that.
      if (error) throw new AppError("VALIDATION", { message: error.message, internal: { code: error.code } });
      return { needsEmailConfirmation: !data.session };
    },

    /** Sends a fresh confirmation link (the old one expired or was already used). */
    async resendConfirmation(input: ResendInput, origin: string): Promise<void> {
      const { error } = await db.auth.resend({ type: "signup", email: input.email, options: { emailRedirectTo: callbackUrl(origin) } });
      // Same answer whether or not the address exists, so this can't be used to probe accounts.
      if (error && error.status !== 429) return;
      if (error) throw new AppError("RATE_LIMITED", { internal: { code: error.code } });
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

    /** The signed-in user's access token for the browser's Realtime socket (RLS applies to it). */
    async realtimeToken(auth: AuthContext): Promise<RealtimeTokenDto> {
      const { data, error } = await db.auth.getSession();
      if (error || !data.session) throw new AppError("UNAUTHENTICATED");
      const env = getEnv();
      return {
        url: env.SUPABASE_URL,
        publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
        accessToken: data.session.access_token,
        userId: auth.userId,
        expiresAt: (data.session.expires_at ?? Math.floor(Date.now() / 1000) + 300) * 1000,
      };
    },

    /** Email-confirmation landing: turns the link into a session cookie. False when it can't. */
    async completeEmailLink(link: EmailLinkResult): Promise<boolean> {
      if (link.kind === "code") return !(await db.auth.exchangeCodeForSession(link.code)).error;
      if (link.kind === "token") return !(await db.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })).error;
      return false;
    },
  };
}
