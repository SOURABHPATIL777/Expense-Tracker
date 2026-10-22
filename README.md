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
