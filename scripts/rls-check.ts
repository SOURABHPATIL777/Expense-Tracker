/**
 * Row-level-security smoke test against the REAL Supabase project in .env.local (or .env).
 * Creates two throwaway users and one anonymous guest, checks isolation, then deletes them.
 *   npm run rls:check
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile?.(file);
const url = process.env.SUPABASE_URL;
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !publishable || !secret) {
  console.error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });
const client = () => createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
const created: string[] = [];

async function user(): Promise<{ id: string; db: SupabaseClient }> {
  const email = `rls-check-${randomBytes(6).toString("hex")}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  created.push(data.user.id);
  const db = client();
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
  return { id: data.user.id, db };
}

function check(name: string, ok: boolean, detail?: string) {
  results.push({ check: name, ok, detail });
}

async function main() {
  const a = await user();
  const b = await user();
  const guest = client();
  const anon = await guest.auth.signInAnonymously();
  if (anon.error || !anon.data.user) throw new Error(`anonymous sign-in: ${anon.error?.message} (enable it in Auth settings)`);
  created.push(anon.data.user.id);

  const tx = await a.db
    .from("transactions")
    .insert({ user_id: a.id, amount_minor: 12345, direction: "debit", occurred_at: new Date().toISOString(), source_app: "phonepe" })
    .select("id")
    .single();
  check("owner can insert a transaction", !tx.error, tx.error?.message);

  const cats = await a.db.from("categories").select("id");
  check("signup seeded default categories", (cats.data?.length ?? 0) >= 15, `${cats.data?.length ?? 0} categories`);

  const bRead = await b.db.from("transactions").select("id").eq("id", tx.data?.id ?? "");
  check("another user cannot read it", (bRead.data?.length ?? 0) === 0);

  const bWrite = await b.db.from("transactions").insert({ user_id: a.id, amount_minor: 1, direction: "debit", occurred_at: new Date().toISOString(), source_app: "gpay" });
  check("another user cannot write as the owner", Boolean(bWrite.error));

  for (const table of ["transactions", "imports", "uploaded_files", "shared_expenses", "expense_participants", "payment_claims", "llm_configs"]) {
    const r = await guest.from(table).select("*").limit(1);
    check(`guest sees nothing in ${table}`, (r.data?.length ?? 0) === 0, r.error?.message);
  }
  const gWrite = await guest.from("categories").insert({ user_id: anon.data.user.id, name: "guest" });
  check("guest cannot write owner tables", Boolean(gWrite.error));

  const jobs = await a.db.rpc("claim_jobs", { p_limit: 1, p_lock_seconds: 1 });
  check("users cannot call service-only functions", Boolean(jobs.error), jobs.error?.message);

  const share = await guest.rpc("guest_get_share");
  check("guest share view works and is empty without an invite", !share.error && Array.isArray(share.data) && share.data.length === 0, share.error?.message);
}

main()
  .catch((err) => check("script ran", false, (err as Error).message))
  .finally(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    console.table(results);
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll ${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  });
