# UPI Spend Tracker

Track spending from **PhonePe, Google Pay and Paytm** (plus bank statements) and see what you *actually* spent.

- Your personal spending is kept separate from transfers between your own accounts, money you paid on behalf of friends, and refunds you're still waiting for.
- Split a payment and send each friend a **private link**. They can agree and report paying you without signing up.

**Stack:** Next.js 16 (App Router, Cache Components) · Supabase (Postgres, Auth, RLS) · Cloudflare R2 (statement files) · Vercel · Ollama (via the Vercel AI SDK), configured in code.

**Principle:** money math, matching and settlement are deterministic SQL/TypeScript. AI works out unfamiliar statement layouts, reads unknown PDFs, categorises merchants nobody has mapped yet, and writes explanations. Everything it produces is checked against the source text before it's used.

## What it does

| Area | Details |
| --- | --- |
| Import | Drop any CSV, Excel, PDF, HTML or JSON statement (several at once). **Files are parsed on the server, never sent to AI.** Every sheet, section and page is read: tables (PDFs rebuilt from text positions) are mapped from their header names, statements that aren't tables (UPI-app PDFs, activity pages) by a record parser, and the bank or app is recognised from the statement's own header (IFSC, name). Every mapping is proved on the file, with running balances reconciled. Only a header that can't be mapped locally goes to AI, as the header plus at most 5 redacted rows, and the result is saved so it never needs AI again. Files that don't look like statements are rejected. PDF passwords are used once and never stored. |
| Reconciliation | The same payment in a UPI-app statement and a bank statement becomes one transaction: matched by UTR (zero padding ignored), or without one by amount, direction and a posting window of −1 to +3 days, plus payee, UPI ID or time when there's a choice. Uncertain cases go to review. Overlapping or re-exported statements (PDF then Excel) aren't imported twice, and rows within one file are never treated as duplicates. |
| Classification | Order: your rules → own transfers/refunds/card bills from the statement → **category map** (your own corrections first, then the longest shared keyword, e.g. `indmoney credit card repayment` beats `indmoney`) → payments to people = **Individual** (never stored in the map) → AI for anything left, whose keywords join the shared map. Anything you edit is locked and remembered for that merchant. |
| Dashboard | Personal spending · all money out · paid for others · own transfers · income · refunds · owed to you · money expected back, plus categories and data completeness. |
| Refunds | Track expected refunds and get matching credits suggested after each import. You confirm the match. An AI can draft a support message. |
| Splits | Equal, exact or percent splits. Each person gets a private link (32-byte token, only its hash is stored, 7-day expiry, one device). Statuses: agreed / questioned / reported paid, and you confirm received. Edits ask for reconfirmation. |

## Project layout

```
src/
  app/        routing shell only: page.tsx re-exports a frontend page, route.ts hands off to a controller
  frontend/   pages/<page>/<Page>.tsx + .module.css, components/, hooks/, lib/apiClient.ts
  backend/    server-only: config, constants, http/withHandler, controllers → services → repositories,
              domain (matching, allocation, rules, category map), import (readers, engine), llm, jobs
  shared/     enums, labels, routes, limits, per-source formats (sources.ts), zod DTO schemas, money & split math
supabase/migrations/   one core migration: schema, RLS, SQL functions
tests/unit/            vitest unit tests        tests/db/   SQL + RLS tests on PGlite (no Docker needed)
scripts/               rls-check.ts (live RLS smoke test), mkroute.sh (route generator)
```

- **Layer rules are enforced by ESLint.** The frontend never imports backend code or Supabase; it calls `/api/v1/*` through `apiClient`. Backend files import `server-only`.
- **jscpd** fails lint on duplicated code.
- **Statement layouts** live in the `import_layouts` table. Nothing is seeded: the AI works out each new layout the first time it is seen and saves it for everyone. **Categories** come from the `default_categories` catalog; **category keywords** live in `category_map_keyword` (see [Categories and keywords](#categories-and-keywords)).
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
   - enable **Anonymous sign-ins**. Guest split links need it; without it guests see "Guest links are switched off for this app right now";
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
1. Import the repo and set the variables from `.env.example`.
2. **No cron is needed.** Background jobs run in the app itself:
   - Uploads, column mappings and "re-apply rules" start the worker right after the response, via `after()`.
   - Every signed-in API request also starts a short worker pass, at most once a minute per instance, unless a worker is already busy. This picks up retried or interrupted jobs.
   - `vercel.json` gives every API route 60 s, so a background pass always fits inside its function.
   - `vercel.json` also pins functions to `icn1` (Seoul), next to the Supabase database (`ap-northeast-2`): every query is a ~2 ms hop instead of a trip across the Pacific. If you move the database, change this to the matching Vercel region (e.g. `bom1` for Supabase Mumbai).
3. After deploying:
   - check `GET /api/v1/health` returns `ok`.
4. **Use the production domain**, or turn off Vercel Authentication (Settings → Deployment Protection) for the URL you use. Protected preview/branch URLs (`…-git-main-….vercel.app`) redirect API calls to the Vercel login once that login expires; the app then says "Your session for this site has expired".

### 4. AI (Ollama)
- **Where it runs:** set `OLLAMA_API_KEY` (an ollama.com key) for Ollama Cloud, the default. For a local or self-hosted Ollama, set `OLLAMA_BASE_URL`, e.g. `http://localhost:11434/api`. A deployed app can't reach `localhost` on your laptop.
- **What it runs:** the model, input/output token limits, temperature, timeout and per-task on/off switches are constants in `src/backend/constants/llm.constants.ts`. Edit and redeploy to change them; users have no AI settings.
- **Check it:** `npm run llm:check` sends one structured-output test to the configured model.
- Without a reachable Ollama, imports with stored layouts still work. Unknown layouts, unknown PDFs and AI categorisation retry later.

### 5. Email confirmation (Supabase Auth)
Confirmation links point at the site the user signed up on. For them to work:
1. In Vercel, set `APP_URL` to the production URL (e.g. `https://expensetracker-phi-rust.vercel.app`).
2. In Supabase → **Authentication → URL Configuration**:
   - **Site URL**: the production URL;
   - **Redirect URLs**: add `https://<production>/api/v1/auth/callback` and `http://localhost:3000/api/v1/auth/callback`.
3. Recommended, in **Authentication → Email Templates → Confirm signup**, make the link:
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`
   That link works on any device or browser, and isn't used up when an email app scans links before you click.

An expired or already-used link lands on the sign-in page, which offers to send a new one.

### 6. Live progress (Supabase Realtime)
Import progress is pushed to the browser over Supabase Realtime instead of polling. The migration adds `imports` to the `supabase_realtime` publication; nothing else to configure. If the socket can't connect, the app falls back to checking every 20 s.

## Security & privacy notes

- **Never asked for:** UPI PIN, OTP or bank password. Statements are uploaded by the user.
- **Row-level security:** RLS is on every table, and owner policies exclude anonymous sessions. Guests reach data only through `SECURITY DEFINER` functions that check their `guest_access` row and return only their own share.
- **What reaches the AI model:** never a statement file or its text. The model sees, at most, the column header plus 5 redacted rows of a table layout nobody has seen before (only when it can't be mapped locally), single transactions' merchant names and narrations for categorisation, and computed totals for summaries. Account numbers, phone numbers and emails are removed first, and everything is passed as untrusted data. The shared tables hold no personal data: layouts store column names, and the category map stores merchant keywords only.
- **Guest links:**
  - links are redeemed only by an explicit POST, never on GET, so chat previews don't consume them;
  - guest pages and APIs send `no-referrer` and `no-store`;
  - redemption is rate-limited, and the token is removed from the URL after use.
- **Logging:** logs are structured JSON with tokens, cookies and personal data redacted. Security-relevant changes are written to `audit_events`.

## Categories and keywords

Every user's categories are created from the global `default_categories` catalog. Each user's copy
remembers its catalog entry (`categories.default_category_id`), so renaming it doesn't break anything.

Transactions are matched against `category_map_keyword` (whole words, in merchant, narration and
UPI handle). A user's own keywords, saved whenever they change a category by hand, win over shared
ones; otherwise the longest shared keyword wins. Shared keywords are seeded, learned by the AI, or
added by hand in the Supabase SQL editor:

```sql
-- A new keyword for everyone
insert into category_map_keyword (keyword, default_category_id)
select 'blinkit', id from default_categories where name = 'Groceries';

-- A new category for everyone (existing users get it automatically)
insert into default_categories (name, kind_hint, color) values ('Pets', 'expense', '#a61e4d');
```

Keywords are lower-case letters, digits and spaces. Payments to people are never mapped; they get
the **Individual** category.

## Stored layouts: verification status

Layouts are learned by AI and proved on the file that taught them (at least 90% of its rows must
parse). Text PDFs laid out as tables are rebuilt into rows and columns from the header on page 1 (or
wherever the table starts), so they use the same table layouts as CSV/Excel. PDFs that aren't tables
are read by AI; their stored layout only records the source, keyed by a hash of the statement's
header lines. Scanned (image-only) PDFs aren't supported. All layouts are `verified = false` until
checked against a real anonymised export:

1. Add the export under `tests/fixtures/real/` with a test next to `tests/unit/import/engine.test.ts`.
2. Set `verified = true` on its `import_layouts` row.

Imports read by AI, or with an AI-learned layout, show a "Read by AI, please check the rows" badge.
