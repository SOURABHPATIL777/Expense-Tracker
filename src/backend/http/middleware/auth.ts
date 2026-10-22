import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { AppError } from "@/backend/errors/AppError";
import { AUTH_MODES, type AuthMode } from "@/backend/constants/enums.constants";

export type AuthContext = {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
};

/** Verifies the session JWT (signature + expiry) and returns the identity. Never trusts request bodies. */
export async function readAuth(db: Db): Promise<AuthContext | null> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const claims = data.claims;
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" && claims.email ? claims.email : null,
    isAnonymous: claims.is_anonymous === true,
  };
}

export function assertAuth(mode: AuthMode, auth: AuthContext | null): void {
  if (mode === AUTH_MODES.PUBLIC) return;
  if (!auth) throw new AppError("UNAUTHENTICATED");
  if (mode === AUTH_MODES.USER && auth.isAnonymous) throw new AppError("FORBIDDEN");
}
