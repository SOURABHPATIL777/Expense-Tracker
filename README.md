# UPI Spend Tracker

Track spending from **PhonePe, Google Pay and Paytm** (plus bank statements). It separates your personal expenses from own-account transfers, shared bills and refunds you're still waiting for.

- **Stack:** Next.js 16 (App Router, Cache Components) · Supabase (Postgres, Auth, Storage, RLS) · Vercel
- **AI:** Vercel AI SDK with a configurable provider per task: OpenAI (GPT), Google (Gemini), xAI (Grok) or self-hosted Ollama.
- **Principle:** money math, matching and settlement are deterministic SQL/TypeScript. LLMs only suggest categories and write explanations.

## Project layout

```
src/
  app/        Next.js routing shell only: page.tsx re-exports a frontend page, route.ts hands off to a backend controller
  frontend/   UI: pages/<page>/<Page>.tsx + <Page>.module.css, components/, hooks/, lib/apiClient.ts
  backend/    server-only: config, constants, http (withHandler), controllers → services → repositories, domain, import, llm, jobs
  shared/     enums, labels, routes, limits and zod DTO schemas used by both sides
supabase/migrations/   SQL schema, RLS policies and RPC functions
tests/unit/            vitest unit tests (+ fixtures/)
```

Layer rules are enforced by ESLint (`no-restricted-imports`):
- The frontend never imports backend code or Supabase. It calls `/api/v1/*` through `apiClient`.
- Backend modules import `server-only`, so leaking one into a client bundle fails the build.

Duplicate code is checked by `jscpd` as part of `npm run lint`.

## Getting started

```bash
cp .env.example .env.local     # fill in Supabase + CRON_SECRET (+ any LLM keys)
npm install
npm run db:link                # one-time: link the hosted Supabase project
npm run db:push                # apply supabase/migrations
npm run dev
```

Node 20.9+ is required; Node 22+ is recommended (supabase-js is deprecating Node 20).

## File storage (Cloudflare R2)

Statements are uploaded **directly from the browser to the private R2 bucket** `expense-statements` using
a presigned PUT URL (valid 10 minutes). Credentials never reach the browser. Object keys are
`<user_id>/<import_id>/<file name>`.

Every object is tracked in the `uploaded_files` table (`user_id`, `file_name`, `file_key`, `status`):

| Status | Meaning |
| --- | --- |
| `uploaded` | Upload confirmed (size checked) and the file is at rest, waiting for processing, a password or a column mapping |
| `processing` | The import job is reading it |
| `deleted` | Removed from R2 (after a successful import or when the import is deleted); the row is kept as a record |

**One-time bucket setup:** R2 → `expense-statements` → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://<your-vercel-domain>"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Keep the bucket private (no public r2.dev access and no custom public domain).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint (including layer boundaries) + jscpd duplicate check |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm test` | Unit tests |
| `npm run check` | All of the above |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run rls:check` | Row-level-security smoke test against the linked project |
