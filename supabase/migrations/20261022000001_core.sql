-- Core schema: accounts, imports, transactions, categorisation, refunds, AI config, jobs, audit.
-- Enum values mirror src/shared/constants/enums.ts exactly.
-- Every user-owned table has RLS; owner policies exclude anonymous (guest) sessions.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.direction as enum ('debit', 'credit');
create type public.transaction_kind as enum ('expense', 'income', 'self_transfer', 'refund', 'reversal', 'reimbursable', 'cc_bill_payment', 'unknown');
create type public.transaction_status as enum ('success', 'pending', 'failed', 'reversed');
create type public.transaction_review_status as enum ('ok', 'needs_review');
create type public.reconciliation_state as enum ('single_source', 'reconciled');
create type public.source_kind as enum ('upi_app', 'bank');
create type public.file_status as enum ('uploaded', 'processing', 'deleted');
create type public.import_status as enum ('uploaded', 'queued', 'parsing', 'needs_mapping', 'needs_password', 'processing', 'completed', 'failed');
create type public.raw_event_status as enum ('pending', 'accepted', 'linked', 'duplicate', 'skipped', 'rejected');
create type public.review_item_kind as enum ('duplicate_candidate', 'low_confidence_category', 'transfer_confirmation', 'refund_match');
create type public.review_item_status as enum ('open', 'resolved', 'dismissed');
create type public.category_source as enum ('rule', 'merchant_map', 'llm', 'user', 'system');
create type public.rule_field as enum ('merchant', 'vpa', 'narration');
create type public.rule_operator as enum ('contains', 'equals', 'starts_with');
create type public.refund_status as enum ('open', 'suggested', 'matched', 'closed');
create type public.llm_provider as enum ('openai', 'google', 'xai', 'ollama');
create type public.llm_task as enum ('categorize', 'monthly_summary', 'refund_message');
create type public.job_type as enum ('parse_import', 'classify_transactions', 'match_refunds');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead');
create type public.split_method as enum ('equal', 'exact', 'percent');
create type public.shared_expense_status as enum ('open', 'closed', 'cancelled');
create type public.participant_response as enum ('pending', 'agreed', 'questioned');
create type public.claim_status as enum ('reported', 'confirmed', 'rejected', 'withdrawn');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True for a signed-in, non-anonymous user. Anonymous guests share the `authenticated`
-- role, so every owner policy must call this.
create or replace function public.is_permanent_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles & accounts
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  source_kind public.source_kind not null,
  source_app text not null,
  -- Last 4 digits only; full account numbers are never stored.
  masked_number text check (masked_number ~ '^\d{2,6}$'),
  -- The user's own UPI IDs (VPAs) on this account; used to detect own-account transfers.
  upi_ids text[] not null default '{}',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_accounts_user_idx on public.financial_accounts (user_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  -- Default classification for transactions in this category (e.g. "Investments" → self_transfer).
  kind_hint public.transaction_kind not null default 'expense',
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_user_name_uidx on public.categories (user_id, lower(name));

-- Default categories for a new user.
create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, name, kind_hint, color, is_system)
  select p_user_id, v.name, v.kind::public.transaction_kind, v.color, true
  from (values
    ('Food & Dining', 'expense', '#e8590c'),
    ('Groceries', 'expense', '#2f9e44'),
    ('Shopping', 'expense', '#ae3ec9'),
    ('Transport', 'expense', '#1c7ed6'),
    ('Fuel', 'expense', '#5c7cfa'),
    ('Bills & Utilities', 'expense', '#f08c00'),
    ('Rent', 'expense', '#c2255c'),
    ('Mobile & Internet', 'expense', '#0ca678'),
    ('Entertainment', 'expense', '#7048e8'),
    ('Health', 'expense', '#e03131'),
    ('Education', 'expense', '#3b5bdb'),
    ('Travel', 'expense', '#1098ad'),
    ('Personal Care', 'expense', '#d6336c'),
    ('Subscriptions', 'expense', '#6741d9'),
    ('Gifts & Donations', 'expense', '#f76707'),
    ('EMI & Loans', 'expense', '#495057'),
    ('Fees & Charges', 'expense', '#868e96'),
    ('Investments', 'self_transfer', '#087f5b'),
    ('Salary', 'income', '#2b8a3e'),
    ('Other', 'expense', '#adb5bd')
  ) as v (name, kind, color)
  on conflict do nothing
$$;
revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- New permanent users get a profile and default categories. Anonymous guests get neither.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(new.raw_user_meta_data ->> 'display_name', 80), ''))
  on conflict (id) do nothing;
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------
create table public.import_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  source_kind public.source_kind not null,
  source_app text not null,
  -- Normalised header row; lets the importer recognise the same layout next time.
  header_signature text not null,
  config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, header_signature)
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.financial_accounts (id) on delete set null,
  source_kind public.source_kind not null,
  source_app text not null,
  file_name text not null check (char_length(file_name) <= 255),
  file_path text not null,
  file_size integer not null check (file_size > 0),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status public.import_status not null default 'uploaded',
  preset_id text,
  template_id uuid references public.import_templates (id) on delete set null,
  -- Column mapping chosen by the user for files no preset recognises.
  config jsonb,
  error_code text,
  error_message text,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  linked_count integer not null default 0,
  duplicate_count integer not null default 0,
  skipped_count integer not null default 0,
  review_count integer not null default 0,
  -- Processing cursor so large files are handled in resumable chunks.
  cursor integer not null default 0,
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, file_sha256)
);
create index imports_user_created_idx on public.imports (user_id, created_at desc);

create table public.raw_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  import_id uuid not null references public.imports (id) on delete cascade,
  row_index integer not null,
  raw jsonb not null,
  parsed jsonb,
  fingerprint text not null,
  status public.raw_event_status not null default 'pending',
  error text,
  transaction_id uuid,
  created_at timestamptz not null default now(),
  unique (import_id, row_index)
);
create index raw_events_user_fingerprint_idx on public.raw_events (user_id, fingerprint);
create index raw_events_import_status_idx on public.raw_events (import_id, status);

-- Ledger of statement files stored in Cloudflare R2 (bucket set by R2_BUCKET). One row per object;
-- the row outlives the object (and the import) so deletions stay on record.
create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  import_id uuid references public.imports (id) on delete set null,
  -- Original name as uploaded by the user.
  file_name text not null check (char_length(file_name) between 1 and 255),
  -- R2 object key (full path inside the bucket): <user_id>/<import_id>/<safe file name>.
  file_key text not null unique check (file_key like user_id::text || '/%'),
  bucket text not null,
  content_type text,
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status public.file_status not null default 'uploaded',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'deleted') = (deleted_at is not null))
);
create index uploaded_files_user_idx on public.uploaded_files (user_id, created_at desc);
create index uploaded_files_import_idx on public.uploaded_files (import_id);
create index uploaded_files_live_idx on public.uploaded_files (status, updated_at) where status <> 'deleted';

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.financial_accounts (id) on delete set null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'INR',
  direction public.direction not null,
  transaction_kind public.transaction_kind not null default 'unknown',
  status public.transaction_status not null default 'success',
  occurred_at timestamptz not null,
  merchant_raw text,
  merchant_normalized text,
  counterparty_vpa text,
  narration text,
  note text check (char_length(note) <= 500),
  category_id uuid references public.categories (id) on delete set null,
  category_source public.category_source,
  category_confidence numeric(4, 3) check (category_confidence between 0 and 1),
  -- Corrections by the user are never overwritten by rules or AI.
  user_locked boolean not null default false,
  -- The user's own share when part of this payment is owed by others (splits). Null = full amount.
  personal_share_minor bigint check (personal_share_minor >= 0),
  payment_rail text not null default 'upi',
  -- UPI UTR / bank reference. Unique per user + direction so a payment and its reversal can share one.
  reference_id text,
  app_transaction_id text,
  source_app text not null,
  reconciliation public.reconciliation_state not null default 'single_source',
  review_status public.transaction_review_status not null default 'ok',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (personal_share_minor is null or personal_share_minor <= amount_minor)
);
create unique index transactions_user_ref_dir_uidx on public.transactions (user_id, reference_id, direction) where reference_id is not null;
create index transactions_user_occurred_idx on public.transactions (user_id, occurred_at desc);
create index transactions_user_category_idx on public.transactions (user_id, category_id);
create index transactions_user_amount_idx on public.transactions (user_id, amount_minor, occurred_at);

alter table public.raw_events
  add constraint raw_events_transaction_fk foreign key (transaction_id) references public.transactions (id) on delete set null;

create table public.transaction_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  raw_event_id uuid not null unique references public.raw_events (id) on delete cascade,
  import_id uuid not null references public.imports (id) on delete cascade,
  source_kind public.source_kind not null,
  source_app text not null,
  created_at timestamptz not null default now()
);
create index transaction_sources_tx_idx on public.transaction_sources (transaction_id);

-- ---------------------------------------------------------------------------
-- Categorisation
-- ---------------------------------------------------------------------------
create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  field public.rule_field not null,
  operator public.rule_operator not null,
  pattern text not null check (char_length(pattern) between 1 and 120),
  category_id uuid references public.categories (id) on delete cascade,
  transaction_kind public.transaction_kind,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (category_id is not null or transaction_kind is not null)
);
create index categorization_rules_user_idx on public.categorization_rules (user_id, priority);

-- Learned merchant → category mapping (from user corrections); applied before any LLM call.
create table public.merchant_map (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_key text not null,
  merchant_name text,
  category_id uuid not null references public.categories (id) on delete cascade,
  transaction_kind public.transaction_kind,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key)
);

create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.review_item_kind not null,
  status public.review_item_status not null default 'open',
  transaction_id uuid references public.transactions (id) on delete cascade,
  related_transaction_id uuid references public.transactions (id) on delete cascade,
  raw_event_id uuid references public.raw_events (id) on delete cascade,
  payload jsonb not null default '{}',
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index review_items_user_open_idx on public.review_items (user_id, created_at desc) where status = 'open';
create unique index review_items_open_uidx on public.review_items (kind, transaction_id, coalesce(related_transaction_id, transaction_id)) where status = 'open';

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------
create table public.refund_expectations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  expected_by date,
  order_ref text check (char_length(order_ref) <= 120),
  note text check (char_length(note) <= 500),
  status public.refund_status not null default 'open',
  matched_transaction_id uuid references public.transactions (id) on delete set null,
  suggested_transaction_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index refund_expectations_tx_uidx on public.refund_expectations (transaction_id) where status <> 'closed';
create index refund_expectations_user_idx on public.refund_expectations (user_id, status);

-- ---------------------------------------------------------------------------
-- Shared expenses (splits). `user_id` is always the owner (the person who paid).
-- Guests never get table access; they act only through the guest_* functions below.
-- ---------------------------------------------------------------------------
create table public.shared_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  total_minor bigint not null check (total_minor > 0),
  currency char(3) not null default 'INR',
  split_method public.split_method not null,
  note text check (char_length(note) <= 500),
  -- Bumped on every edit; an agreement given to an older version needs reconfirming.
  version integer not null default 1,
  status public.shared_expense_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shared_expenses_user_idx on public.shared_expenses (user_id, created_at desc);
create unique index shared_expenses_tx_uidx on public.shared_expenses (transaction_id) where transaction_id is not null and status <> 'cancelled';

create table public.expense_participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expense_id uuid not null references public.shared_expenses (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  -- The owner's own share row (exactly one per expense).
  is_owner boolean not null default false,
  share_minor bigint not null check (share_minor >= 0),
  response_status public.participant_response not null default 'pending',
  accepted_version integer,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expense_participants_expense_idx on public.expense_participants (expense_id);
create unique index expense_participants_owner_uidx on public.expense_participants (expense_id) where is_owner;

create table public.share_invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  participant_id uuid not null references public.expense_participants (id) on delete cascade,
  -- SHA-256 of the 32-byte random token; the token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index share_invites_participant_idx on public.share_invites (participant_id);

create table public.guest_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  participant_id uuid not null references public.expense_participants (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index guest_access_active_uidx on public.guest_access (participant_id) where revoked_at is null;
create index guest_access_auth_idx on public.guest_access (auth_user_id) where revoked_at is null;

create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  participant_id uuid not null references public.expense_participants (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  status public.claim_status not null default 'reported',
  reported_by text not null check (reported_by in ('guest', 'owner')),
  -- Incoming credit the owner linked as this repayment, if any.
  matched_transaction_id uuid references public.transactions (id) on delete set null,
  note text check (char_length(note) <= 300),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (participant_id, idempotency_key)
);
create index payment_claims_participant_idx on public.payment_claims (participant_id);

create table public.expense_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expense_id uuid not null references public.shared_expenses (id) on delete cascade,
  participant_id uuid references public.expense_participants (id) on delete set null,
  actor text not null check (actor in ('owner', 'guest')),
  action text not null,
  version integer not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index expense_events_expense_idx on public.expense_events (expense_id, created_at);

-- ---------------------------------------------------------------------------
-- AI configuration & runs
-- ---------------------------------------------------------------------------
create table public.llm_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task public.llm_task not null,
  enabled boolean not null default true,
  provider public.llm_provider not null,
  model text not null check (char_length(model) between 1 and 120),
  -- Name of an admin-approved endpoint from OLLAMA_ENDPOINTS; never a URL.
  endpoint_name text check (endpoint_name ~ '^[a-zA-Z0-9_-]{1,40}$'),
  temperature numeric(3, 2) not null default 0.1 check (temperature between 0 and 2),
  max_output_tokens integer not null default 2000 check (max_output_tokens between 64 and 8000),
  timeout_ms integer not null default 30000 check (timeout_ms between 1000 and 120000),
  allow_cloud_processing boolean not null default false,
  last_tested_at timestamptz,
  test_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task public.llm_task not null,
  provider public.llm_provider not null,
  model text not null,
  succeeded boolean not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index agent_runs_user_idx on public.agent_runs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Jobs (service role only; no client policies)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.job_type not null,
  payload jsonb not null default '{}',
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_ready_idx on public.jobs (run_after) where status in ('queued', 'running');

create or replace function public.claim_jobs(p_limit integer, p_lock_seconds integer)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select id
    from public.jobs
    where (status = 'queued' and run_after <= now())
       or (status = 'running' and locked_until < now())
    order by run_after
    limit p_limit
    for update skip locked
  )
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lock_seconds)
    from picked
   where j.id = picked.id
  returning j.*
$$;
revoke execute on function public.claim_jobs(integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit, idempotency, rate limits
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_user_idx on public.audit_events (user_id, created_at desc);

create table public.idempotency_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null,
  key text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, scope, key)
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

-- Fixed-window limiter. Returns false when the caller is over the limit.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Import deletion: removes the import, its rows, and transactions that came only from it.
-- Transactions also seen in another import keep their other sources.
-- ---------------------------------------------------------------------------
create or replace function public.delete_import(p_import_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.transactions t
   where t.user_id = auth.uid()
     and exists (select 1 from public.transaction_sources s where s.transaction_id = t.id and s.import_id = p_import_id)
     and not exists (select 1 from public.transaction_sources s where s.transaction_id = t.id and s.import_id <> p_import_id);

  update public.transactions t
     set reconciliation = 'single_source'
   where t.user_id = auth.uid()
     and t.reconciliation = 'reconciled'
     and (select count(distinct s.source_kind) from public.transaction_sources s
           where s.transaction_id = t.id and s.import_id <> p_import_id) < 2
     and exists (select 1 from public.transaction_sources s where s.transaction_id = t.id and s.import_id = p_import_id);

  delete from public.imports where id = p_import_id and user_id = auth.uid();
  if not found then
    raise exception 'APP:NOT_FOUND';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Merge a confirmed duplicate into the transaction it duplicates (user-initiated only).
-- Sources and raw rows move to the kept transaction; identifiers it lacked are copied over.
-- ---------------------------------------------------------------------------
create or replace function public.merge_transactions(p_keep uuid, p_remove uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keep public.transactions;
  v_remove public.transactions;
begin
  select * into v_keep from public.transactions where id = p_keep and user_id = auth.uid() for update;
  select * into v_remove from public.transactions where id = p_remove and user_id = auth.uid() for update;
  if v_keep.id is null or v_remove.id is null then
    raise exception 'APP:NOT_FOUND';
  end if;
  if p_keep = p_remove or v_keep.amount_minor <> v_remove.amount_minor or v_keep.direction <> v_remove.direction then
    raise exception 'APP:INVALID_STATE';
  end if;

  update public.transaction_sources set transaction_id = p_keep where transaction_id = p_remove;
  update public.raw_events set transaction_id = p_keep, status = 'linked' where transaction_id = p_remove;
  update public.review_items
     set status = 'resolved', resolved_at = now(), resolution = 'merged'
   where status = 'open' and (transaction_id = p_remove or related_transaction_id = p_remove);
  delete from public.transactions where id = p_remove;

  update public.transactions t
     set reference_id = coalesce(t.reference_id, v_remove.reference_id),
         app_transaction_id = coalesce(t.app_transaction_id, v_remove.app_transaction_id),
         counterparty_vpa = coalesce(t.counterparty_vpa, v_remove.counterparty_vpa),
         merchant_normalized = coalesce(t.merchant_normalized, v_remove.merchant_normalized),
         review_status = 'ok',
         reconciliation = case
           when (select count(distinct s.source_kind) from public.transaction_sources s where s.transaction_id = p_keep) > 1
           then 'reconciled'::public.reconciliation_state else t.reconciliation end
   where t.id = p_keep;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports. All money totals are computed here, never by the UI or an LLM.
-- Only successful transactions count; personal spending uses the user's own share.
-- ---------------------------------------------------------------------------
create or replace function public.report_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select * from public.transactions
     where user_id = auth.uid() and occurred_at >= p_from and occurred_at < p_to
  ), ok as (
    select * from t where status = 'success'
  )
  select jsonb_build_object(
    'cash_outflow', coalesce((select sum(amount_minor) from ok where direction = 'debit'), 0),
    'personal_expense', coalesce((select sum(coalesce(personal_share_minor, amount_minor)) from ok where direction = 'debit' and transaction_kind = 'expense'), 0),
    'others_share', coalesce((select sum(amount_minor - coalesce(personal_share_minor, amount_minor)) from ok where direction = 'debit' and transaction_kind = 'expense'), 0)
                  + coalesce((select sum(amount_minor) from ok where direction = 'debit' and transaction_kind = 'reimbursable'), 0),
    'own_transfers', coalesce((select sum(amount_minor) from ok where direction = 'debit' and transaction_kind in ('self_transfer', 'cc_bill_payment')), 0),
    'unclassified_outflow', coalesce((select sum(amount_minor) from ok where direction = 'debit' and transaction_kind = 'unknown'), 0),
    'income', coalesce((select sum(amount_minor) from ok where direction = 'credit' and transaction_kind = 'income'), 0),
    'refunds_received', coalesce((select sum(amount_minor) from ok where direction = 'credit' and transaction_kind in ('refund', 'reversal')), 0),
    'unclassified_inflow', coalesce((select sum(amount_minor) from ok where direction = 'credit' and transaction_kind = 'unknown'), 0),
    'uncategorized_count', (select count(*) from ok where direction = 'debit' and transaction_kind = 'expense' and category_id is null),
    'failed_or_pending_count', (select count(*) from t where status in ('failed', 'pending')),
    'transaction_count', (select count(*) from t)
  )
$$;

create or replace function public.report_category_breakdown(p_from timestamptz, p_to timestamptz)
returns table (category_id uuid, total_minor bigint, tx_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.category_id, sum(coalesce(t.personal_share_minor, t.amount_minor))::bigint, count(*)
    from public.transactions t
   where t.user_id = auth.uid()
     and t.occurred_at >= p_from and t.occurred_at < p_to
     and t.status = 'success' and t.direction = 'debit' and t.transaction_kind = 'expense'
   group by t.category_id
   order by 2 desc
$$;

-- ---------------------------------------------------------------------------
-- Splits: owner side (security invoker → owner RLS applies)
-- ---------------------------------------------------------------------------

-- Creates or edits a split atomically. Shares are computed by the API (one allocation function
-- shared with the UI); this re-checks the invariants and records the owner's share on the payment
-- so reports count only the owner's part as personal spending.
create or replace function public.save_split(
  p_expense_id uuid,
  p_transaction_id uuid,
  p_title text,
  p_method public.split_method,
  p_total_minor bigint,
  p_participants jsonb,
  p_note text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_tx public.transactions;
  v_exp public.shared_expenses;
  v_owner_share bigint;
  v_keep uuid[] := '{}';
  v_pid uuid;
  p jsonb;
begin
  if not public.is_permanent_user() then
    raise exception 'APP:FORBIDDEN';
  end if;
  if (select coalesce(sum((x ->> 'shareMinor')::bigint), 0) from jsonb_array_elements(p_participants) x) <> p_total_minor then
    raise exception 'APP:VALIDATION';
  end if;
  if (select count(*) from jsonb_array_elements(p_participants) x where (x ->> 'isOwner')::boolean) <> 1 then
    raise exception 'APP:VALIDATION';
  end if;
  select (x ->> 'shareMinor')::bigint into v_owner_share
    from jsonb_array_elements(p_participants) x where (x ->> 'isOwner')::boolean;

  if p_expense_id is null then
    if p_transaction_id is not null then
      select * into v_tx from public.transactions where id = p_transaction_id and user_id = auth.uid() for update;
      if v_tx.id is null then
        raise exception 'APP:NOT_FOUND';
      end if;
      if v_tx.direction <> 'debit' or v_tx.amount_minor <> p_total_minor then
        raise exception 'APP:VALIDATION';
      end if;
    end if;
    insert into public.shared_expenses (user_id, transaction_id, title, total_minor, split_method, note)
    values (auth.uid(), p_transaction_id, p_title, p_total_minor, p_method, p_note)
    returning id into v_id;
  else
    select * into v_exp from public.shared_expenses where id = p_expense_id and user_id = auth.uid() for update;
    if v_exp.id is null then
      raise exception 'APP:NOT_FOUND';
    end if;
    if v_exp.status <> 'open' then
      raise exception 'APP:INVALID_STATE';
    end if;
    if v_exp.transaction_id is not null and v_exp.total_minor <> p_total_minor then
      raise exception 'APP:VALIDATION';
    end if;
    v_id := p_expense_id;
    update public.shared_expenses
       set title = p_title, total_minor = p_total_minor, split_method = p_method, note = p_note, version = version + 1
     where id = v_id;
  end if;

  for p in select * from jsonb_array_elements(p_participants) loop
    if nullif(p ->> 'id', '') is not null then
      update public.expense_participants
         set display_name = p ->> 'displayName', share_minor = (p ->> 'shareMinor')::bigint, is_owner = (p ->> 'isOwner')::boolean
       where id = (p ->> 'id')::uuid and expense_id = v_id
      returning id into v_pid;
      if v_pid is null then
        raise exception 'APP:NOT_FOUND';
      end if;
    else
      insert into public.expense_participants (user_id, expense_id, display_name, is_owner, share_minor, response_status, accepted_version)
      values (
        auth.uid(), v_id, p ->> 'displayName', (p ->> 'isOwner')::boolean, (p ->> 'shareMinor')::bigint,
        case when (p ->> 'isOwner')::boolean then 'agreed'::public.participant_response else 'pending'::public.participant_response end,
        null
      )
      returning id into v_pid;
    end if;
    v_keep := v_keep || v_pid;
  end loop;

  -- Someone who already reported or was confirmed paying can't silently disappear from the split.
  if exists (
    select 1 from public.payment_claims c
      join public.expense_participants ep on ep.id = c.participant_id
     where ep.expense_id = v_id and not (ep.id = any (v_keep)) and c.status in ('reported', 'confirmed')
  ) then
    raise exception 'APP:INVALID_STATE';
  end if;
  delete from public.expense_participants where expense_id = v_id and not (id = any (v_keep));

  update public.expense_participants set accepted_version = (select version from public.shared_expenses where id = v_id)
   where expense_id = v_id and is_owner;

  update public.transactions t
     set personal_share_minor = v_owner_share
   where t.id = (select transaction_id from public.shared_expenses where id = v_id);

  insert into public.expense_events (user_id, expense_id, actor, action, version)
  select auth.uid(), v_id, 'owner', case when p_expense_id is null then 'created' else 'edited' end, version
    from public.shared_expenses where id = v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Splits: guest side (security definer; every function checks the caller's guest_access)
-- ---------------------------------------------------------------------------

-- Binds an invitation to the calling session (anonymous or signed in). Idempotent for the same
-- session; a different session cannot take over an already-opened link.
create or replace function public.redeem_invite(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.share_invites;
  v_part public.expense_participants;
begin
  if auth.uid() is null then
    raise exception 'APP:UNAUTHENTICATED';
  end if;
  select * into v_inv from public.share_invites where token_hash = p_token_hash for update;
  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.expires_at < now() then
    raise exception 'APP:INVITE_INVALID';
  end if;
  if v_inv.redeemed_by is not null then
    if v_inv.redeemed_by = auth.uid() then
      return v_inv.participant_id;
    end if;
    raise exception 'APP:INVITE_TAKEN';
  end if;
  if v_inv.user_id = auth.uid() then
    raise exception 'APP:INVALID_STATE';
  end if;
  select * into v_part from public.expense_participants where id = v_inv.participant_id;

  update public.share_invites set redeemed_by = auth.uid(), redeemed_at = now() where id = v_inv.id;
  update public.guest_access set revoked_at = now() where participant_id = v_inv.participant_id and revoked_at is null;
  insert into public.guest_access (user_id, participant_id, auth_user_id, expires_at)
  values (v_inv.user_id, v_inv.participant_id, auth.uid(), now() + interval '90 days');
  insert into public.expense_events (user_id, expense_id, participant_id, actor, action, version)
  select v_inv.user_id, v_part.expense_id, v_part.id, 'guest', 'link_opened', e.version
    from public.shared_expenses e where e.id = v_part.expense_id;
  return v_inv.participant_id;
end;
$$;

-- The participant the caller may act as, or an error. Central access check for guest functions.
create or replace function public.guest_participant(p_participant_id uuid)
returns public.expense_participants
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_part public.expense_participants;
begin
  select ep.* into v_part
    from public.guest_access ga
    join public.expense_participants ep on ep.id = ga.participant_id
   where ga.participant_id = p_participant_id
     and ga.auth_user_id = auth.uid()
     and ga.revoked_at is null
     and ga.expires_at > now();
  if v_part.id is null then
    raise exception 'APP:FORBIDDEN';
  end if;
  return v_part;
end;
$$;

-- Everything the caller's guest sessions may see: only their own share, never other
-- participants or the owner's wider data.
create or replace function public.guest_get_share()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row order by row ->> 'createdAt' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'participantId', ep.id,
      'displayName', ep.display_name,
      'ownerName', coalesce(pr.display_name, 'Someone'),
      'title', e.title,
      'occurredAt', coalesce(t.occurred_at, e.created_at),
      'totalMinor', e.total_minor,
      'shareMinor', ep.share_minor,
      'status', e.status,
      'version', e.version,
      'responseStatus', ep.response_status,
      'needsReconfirm', ep.response_status = 'agreed' and coalesce(ep.accepted_version, 0) < e.version,
      'confirmedMinor', coalesce((select sum(c.amount_minor) from public.payment_claims c where c.participant_id = ep.id and c.status = 'confirmed'), 0),
      'reportedMinor', coalesce((select sum(c.amount_minor) from public.payment_claims c where c.participant_id = ep.id and c.status = 'reported'), 0),
      'claims', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'amountMinor', c.amount_minor, 'status', c.status, 'reportedAt', c.reported_at) order by c.reported_at desc)
          from public.payment_claims c where c.participant_id = ep.id
      ), '[]'::jsonb),
      'createdAt', e.created_at
    ) as row
      from public.guest_access ga
      join public.expense_participants ep on ep.id = ga.participant_id
      join public.shared_expenses e on e.id = ep.expense_id
      left join public.transactions t on t.id = e.transaction_id
      left join public.profiles pr on pr.id = e.user_id
     where ga.auth_user_id = auth.uid() and ga.revoked_at is null and ga.expires_at > now()
       and e.status <> 'cancelled'
  ) s
$$;

create or replace function public.guest_respond(p_participant_id uuid, p_response public.participant_response, p_version integer, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_part public.expense_participants := public.guest_participant(p_participant_id);
  v_exp public.shared_expenses;
begin
  if p_response = 'pending' then
    raise exception 'APP:VALIDATION';
  end if;
  select * into v_exp from public.shared_expenses where id = v_part.expense_id for update;
  if v_exp.status <> 'open' then
    raise exception 'APP:INVALID_STATE';
  end if;
  if v_exp.version <> p_version then
    raise exception 'APP:VERSION_MISMATCH';
  end if;
  update public.expense_participants
     set response_status = p_response,
         accepted_version = case when p_response = 'agreed' then v_exp.version else accepted_version end,
         responded_at = now()
   where id = v_part.id;
  insert into public.expense_events (user_id, expense_id, participant_id, actor, action, version, metadata)
  values (v_exp.user_id, v_exp.id, v_part.id, 'guest', p_response::text, v_exp.version,
          case when p_message is null then '{}'::jsonb else jsonb_build_object('message', left(p_message, 300)) end);
end;
$$;

-- A guest says they paid. It is a claim, not a settlement: only the owner can confirm it.
create or replace function public.guest_report_payment(p_participant_id uuid, p_amount_minor bigint, p_idempotency_key text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_part public.expense_participants := public.guest_participant(p_participant_id);
  v_exp public.shared_expenses;
  v_existing uuid;
  v_outstanding bigint;
  v_id uuid;
begin
  select id into v_existing from public.payment_claims where participant_id = v_part.id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;
  select * into v_exp from public.shared_expenses where id = v_part.expense_id for update;
  if v_exp.status <> 'open' then
    raise exception 'APP:INVALID_STATE';
  end if;
  select v_part.share_minor - coalesce(sum(amount_minor), 0) into v_outstanding
    from public.payment_claims where participant_id = v_part.id and status in ('reported', 'confirmed');
  if p_amount_minor <= 0 or p_amount_minor > v_outstanding then
    raise exception 'APP:VALIDATION';
  end if;
  insert into public.payment_claims (user_id, participant_id, amount_minor, reported_by, note, idempotency_key)
  values (v_exp.user_id, v_part.id, p_amount_minor, 'guest', left(p_note, 300), p_idempotency_key)
  returning id into v_id;
  insert into public.expense_events (user_id, expense_id, participant_id, actor, action, version, metadata)
  values (v_exp.user_id, v_exp.id, v_part.id, 'guest', 'payment_reported', v_exp.version, jsonb_build_object('amountMinor', p_amount_minor));
  return v_id;
end;
$$;

-- Guests may only execute the guest_* functions; the access helper is internal.
revoke execute on function public.guest_participant(uuid) from public, anon, authenticated;
revoke execute on function public.redeem_invite(text) from public, anon;
revoke execute on function public.guest_get_share() from public, anon;
revoke execute on function public.guest_respond(uuid, public.participant_response, integer, text) from public, anon;
revoke execute on function public.guest_report_payment(uuid, bigint, text, text) from public, anon;
revoke execute on function public.save_split(uuid, uuid, text, public.split_method, bigint, jsonb, text) from public, anon;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'financial_accounts', 'categories', 'import_templates', 'imports', 'transactions',
    'categorization_rules', 'merchant_map', 'refund_expectations', 'llm_configs', 'uploaded_files', 'shared_expenses', 'expense_participants'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_owner on public.profiles
  for all to authenticated
  using (id = (select auth.uid()) and (select public.is_permanent_user()))
  with check (id = (select auth.uid()) and (select public.is_permanent_user()));

-- Owner-only CRUD for every user-owned table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_accounts', 'categories', 'import_templates', 'imports', 'raw_events', 'transactions',
    'transaction_sources', 'categorization_rules', 'merchant_map', 'review_items', 'refund_expectations',
    'llm_configs', 'idempotency_keys', 'shared_expenses', 'expense_participants', 'share_invites', 'guest_access',
    'payment_claims', 'expense_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()) and (select public.is_permanent_user()))
         with check (user_id = (select auth.uid()) and (select public.is_permanent_user()))',
      t || '_owner', t
    );
  end loop;
end;
$$;

-- Read-only to owners (written by the server).
alter table public.agent_runs enable row level security;
create policy agent_runs_owner_read on public.agent_runs
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_permanent_user()));

alter table public.audit_events enable row level security;
create policy audit_events_owner_read on public.audit_events
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_permanent_user()));
create policy audit_events_owner_insert on public.audit_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- File history: owners read, only the server (service role) writes.
alter table public.uploaded_files enable row level security;
create policy uploaded_files_owner_read on public.uploaded_files
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_permanent_user()));
revoke insert, update, delete on public.uploaded_files from authenticated;

-- Service role only.
alter table public.jobs enable row level security;
alter table public.rate_limits enable row level security;

-- The anon key never needs table access: every request is authenticated or goes through the server.
revoke all on all tables in schema public from anon;
