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
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'financial_accounts', 'categories', 'import_templates', 'imports', 'transactions',
    'categorization_rules', 'merchant_map', 'refund_expectations', 'llm_configs'
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
    'llm_configs', 'idempotency_keys'
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

-- Service role only.
alter table public.jobs enable row level security;
alter table public.rate_limits enable row level security;

-- The anon key never needs table access: every request is authenticated or goes through the server.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Storage: private statements bucket, files under <user_id>/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'statements', 'statements', false, 10485760,
  array[
    'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf', 'text/html', 'application/json', 'application/octet-stream', 'text/plain'
  ]
)
on conflict (id) do nothing;

create policy statements_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_permanent_user())
  );

create policy statements_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_permanent_user())
  );

create policy statements_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_permanent_user())
  );
