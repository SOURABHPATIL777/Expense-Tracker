# UPI Spend Tracker

Track spending from **PhonePe, Google Pay and Paytm** (plus bank statements) and see what you *actually* spent.

- Your personal spending is kept separate from transfers between your own accounts, money you paid on behalf of friends, and refunds you're still waiting for.
- Split a payment and send each friend a **private link**. They can agree and report paying you without signing up.

**Stack:** Next.js 16 (App Router, Cache Components) · Supabase (Postgres, Auth, RLS) · Cloudflare R2 (statement files) · Vercel · Vercel AI SDK with a per-task choice of OpenAI, Gemini, Grok or self-hosted Ollama.

**Principle:** money math, matching and settlement are deterministic SQL/TypeScript. AI only suggests categories and writes explanations, and it is optional.

## What it does

| Area | Details |
| --- | --- |
| Import | CSV, Excel or PDF from PhonePe, Google Pay, Paytm, HDFC, ICICI, SBI and all public-sector banks. Unknown CSV/Excel layouts → column mapper, remembered as a template. PDF passwords are used once and never stored. |
| Reconciliation | The same payment from the app and the bank is matched by UTR into one transaction. Amount + time near-matches go to review and are never merged automatically. Re-imports are deduplicated. |
| Classification | Order: your rules → merchants you've corrected before → optional AI. Own transfers, refunds, reversals and card bills are detected from the statement itself. Anything you edit is locked against rules/AI. |
| Dashboard | Personal spending · all money out · paid for others · own transfers · income · refunds · owed to you · money expected back, plus categories and data completeness. |
| Refunds | Track expected refunds and get matching credits suggested after each import. You confirm the match. An AI can draft a support message. |
| Splits | Equal, exact or percent splits. Each person gets a private link (32-byte token, only its hash is stored, 7-day expiry, one device). Statuses: agreed / questioned / reported paid, and you confirm received. Edits ask for reconfirmation. |

## Project layout

```
src/
  app/        routing shell only: page.tsx re-exports a frontend page, route.ts hands off to a controller
  frontend/   pages/<page>/<Page>.tsx + .module.css, components/, hooks/, lib/apiClient.ts
  backend/    server-only: config, constants, http/withHandler, controllers → services → repositories,
              domain (matching, allocation, rules), import (readers, engine, presets), llm, jobs
  shared/     enums, labels, routes, limits, per-source formats (sources.ts), zod DTO schemas, money & split math
supabase/migrations/   one core migration: schema, RLS, SQL functions
tests/unit/            vitest unit tests        tests/db/   SQL + RLS tests on PGlite (no Docker needed)
scripts/               rls-check.ts (live RLS smoke test), mkroute.sh (route generator)
```

- **Layer rules are enforced by ESLint.** The frontend never imports backend code or Supabase; it calls `/api/v1/*` through `apiClient`. Backend files import `server-only`.
- **jscpd** fails lint on duplicated code.
- **Add a bank or app** by writing a config file in `src/backend/import/presets/`. No parser code is needed.
- **Accepted formats and export instructions** per source live in `src/shared/constants/sources.ts`.

## Local development

```bash
cp .env.example .env.local      # fill in the values below
npm install
npm run db:link && npm run db:push
npm run dev
```

Node 20.9+ is required; Node 22+ is recommended.

| Script | Purpose |
| --- | --- |
| `npm run check` | lint (+ boundaries, duplicates) → typecheck → all tests |
| `npm test` | unit + PGlite database tests |
| `npm run rls:check` | live RLS smoke test against the project in `.env.local` (creates and deletes throwaway users) |
| `npm run db:push` / `db:types` | apply migrations / generate DB types |

## Deploying

### 1. Supabase
1. Create a project and copy its URL, **publishable key** and **secret key**.
2. **Authentication → Sign In / Providers:**
   - enable **Email**;
   - enable **Anonymous sign-ins** (guest split links need it);
   - turn on CAPTCHA protection for abuse resistance.
3. **Authentication → URL configuration:**
   - Site URL = your app URL;
   - add `https://<app>/api/v1/auth/callback` to the allowed redirect URLs.
4. Apply the schema: `npm run db:link` (asks for the DB password), then `npm run db:push`.
5. Run `npm run rls:check`. Every check should pass.

### 2. Cloudflare R2
1. Use the private bucket `expense-statements`. Keep public access off.
2. Create an API token with **Object Read & Write** scoped to that bucket.
3. Under **Settings → CORS policy**, add:
   ```json
   [{ "AllowedOrigins": ["http://localhost:3000", "https://<your-domain>"],
      "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
4. Optional: add a lifecycle rule that deletes objects older than 7 days. This cleans up uploads that were started but never confirmed. Successful imports already delete their file.

### 3. Vercel
1. Import the GitHub repo. Framework: **Next.js**. Leave Root Directory empty and Output Directory unset.
2. Set the variables from `.env.example` under Settings → Environment Variables (Production, and Preview if you use PR previews). `APP_URL` must be the Vercel domain.
3. **Every push to `main` deploys to production automatically**; pull requests get preview URLs.
4. **Schema changes:** apply migrations before (or as) you push code that needs them.
   - Locally: `npm run db:push`.
   - Or set `SUPABASE_PROJECT_ID` (variable) plus `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` (secrets) in a GitHub `production` environment. The CI workflow then applies pending migrations on every push to `main`.
5. **No cron is needed.** Background jobs run in the app itself:
   - Uploads, column mappings and "re-apply rules" start the worker right after the response, via `after()`.
   - Every signed-in API request also starts a short worker pass, at most once a minute per instance, to pick up retried or interrupted jobs.
6. After deploying, check `GET /api/v1/health` returns `ok`.

### 4. AI models (optional)
- **Cloud providers:** set `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` and/or `XAI_API_KEY`.
- **Ollama:** a deployed app cannot reach `localhost` on your laptop. Run Ollama on a server behind an authenticated gateway and list it in `OLLAMA_ENDPOINTS=name=https://host/api`. Optionally set `OLLAMA_API_KEY` for a bearer token.
  - Users choose endpoints by name and can never enter a URL.
  - Models tagged `:cloud` (e.g. `glm-5.2:cloud`) count as cloud processing.
- **Enabling a model:** users enable models per task under **Settings → AI models**. A model must pass a live structured-output check before it can be saved. Cloud models also require the user to tick "Allow cloud processing".

## Security & privacy notes

- **Never asked for:** UPI PIN, OTP or bank password. Statements are uploaded by the user.
- **Row-level security:** RLS is on every table, and owner policies exclude anonymous sessions. Guests reach data only through `SECURITY DEFINER` functions that check their `guest_access` row and return only their own share.
- **What reaches an AI model:** account numbers, phone numbers, emails and long references are removed first. Statement text is passed to the model as untrusted data. Totals are computed in SQL; the model only explains them.
- **Guest links:**
  - links are redeemed only by an explicit POST, never on GET, so chat previews don't consume them;
  - guest pages and APIs send `no-referrer` and `no-store`;
  - redemption is rate-limited, and the token is removed from the URL after use.
- **Logging:** logs are structured JSON with tokens, cookies and personal data redacted. Security-relevant changes are written to `audit_events`.

## Import presets: verification status

Every built-in preset is **marked unverified**. Each was written from a published layout and tested only against synthetic fixtures (`tests/fixtures/synthetic`). To verify one:

1. Add an anonymised real export under `tests/fixtures/real/`.
2. Add a test for it next to `tests/unit/import/engine.test.ts`.
3. Set `verified: true` on the preset.

Imports read with an unverified preset show a "please check the rows" badge.
