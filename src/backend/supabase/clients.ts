import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/backend/config/env";

export type Db = SupabaseClient;

/**
 * Request-scoped client acting as the signed-in user (RLS applies).
 * Create one per request; never share across requests.
 */
export async function createUserClient(): Promise<Db> {
  const env = getEnv();
  const cookieStore = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
      },
    },
  });
}

let adminClient: Db | undefined;

/**
 * Service-role client that BYPASSES RLS. Only the job worker, invite redemption and
 * rate limiting may use it, and every query must scope by user explicitly.
 */
export function getAdminClient(): Db {
  if (adminClient) return adminClient;
  const env = getEnv();
  adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient;
}
