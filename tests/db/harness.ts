import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// Minimal stand-ins for the parts of Supabase's auth/storage schemas our migrations use.
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    email text,
    is_anonymous boolean not null default false,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  grant all on storage.objects to authenticated, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  alter table storage.objects enable row level security;

  create publication supabase_realtime;
`;

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  /** Creates an auth user (fires the on_auth_user_created trigger like Supabase does). */
  async function createUser(opts: { anonymous?: boolean; name?: string } = {}): Promise<string> {
    const id = crypto.randomUUID();
    await db.query(`insert into auth.users (id, email, is_anonymous, raw_user_meta_data) values ($1, $2, $3, $4)`, [
      id,
      opts.anonymous ? null : `${id.slice(0, 8)}@example.com`,
      opts.anonymous ?? false,
      JSON.stringify({ display_name: opts.name ?? "Test User" }),
    ]);
    return id;
  }

  /** Runs `fn` as the given user through PostgREST's role + JWT claims, inside a rolled-back transaction. */
  async function as<T>(userId: string, fn: (q: typeof db.query) => Promise<T>, opts: { anonymous?: boolean } = {}): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: "authenticated", is_anonymous: opts.anonymous ?? false }),
      ]);
      await tx.exec("set local role authenticated");
      return fn(tx.query.bind(tx) as typeof db.query);
    });
  }

  return { db, createUser, as };
}
