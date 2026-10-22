-- Automatic import and keyword-based categorisation:
--  * import_layouts: CSV/Excel layouts and PDF sources shared by all users. Nothing is seeded: the
--    LLM works a layout out the first time it is seen and saves it here, so the next file with the
--    same layout (from any user) needs no LLM call. Server-only.
--  * imports: source is detected after upload, so source_kind/source_app become nullable.
--  * default_categories: the global category catalog every user's categories are created from.
--  * category_map_keyword: keyword → category by foreign key. Shared rows point at the catalog
--    (seed data, the LLM, or added by hand); a user's manual corrections point at their own
--    category and win over shared ones.
--  * Per-user AI configuration (llm_configs) and per-user templates are removed: AI is Ollama-only,
--    configured in code.

alter type public.llm_task add value if not exists 'column_mapping';
alter type public.llm_task add value if not exists 'pdf_extraction';

-- ---------------------------------------------------------------------------
-- Import layouts (global, learned)
-- ---------------------------------------------------------------------------
create table public.import_layouts (
  id uuid primary key default gen_random_uuid(),
  -- table: a CSV/Excel column mapping; llm_extract: a PDF layout whose rows the LLM reads.
  kind text not null check (kind in ('table', 'llm_extract')),
  -- table: normalised header row; llm_extract: hash of the statement's header lines.
  signature text not null check (char_length(signature) between 1 and 2000),
  label text not null check (char_length(label) between 1 and 160),
  source_kind public.source_kind not null,
  source_app text not null,
  config jsonb not null default '{}',
  origin text not null default 'llm' check (origin in ('llm', 'manual')),
  priority integer not null default 1000,
  verified boolean not null default false,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, signature)
);
alter table public.import_layouts enable row level security;
revoke all on public.import_layouts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Imports: detected source, chosen layout, temporary PDF text for AI reading
-- ---------------------------------------------------------------------------
alter table public.imports
  alter column source_kind drop not null,
  alter column source_app drop not null,
  add column layout_id uuid references public.import_layouts (id) on delete set null,
  -- PDF lines kept only while the LLM reads them in chunks; cleared when processing finishes.
  add column extracted_text jsonb,
  -- What the file was detected as, e.g. "HDFC Bank statement (CSV/Excel)" or "Read by AI".
  add column detected_label text check (char_length(detected_label) <= 160),
  -- True when an LLM read the rows (PDF) or worked out the columns (CSV/Excel) for this import.
  add column read_by_ai boolean not null default false,
  drop column template_id,
  drop column config;

drop table public.import_templates;
drop table public.llm_configs;

-- ---------------------------------------------------------------------------
-- Category catalog: the default categories every user gets
-- ---------------------------------------------------------------------------
-- To add a category for everyone, insert a row here; existing users receive it (trigger below).
create table public.default_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  kind_hint public.transaction_kind not null default 'expense',
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 1000,
  created_at timestamptz not null default now()
);
create unique index default_categories_name_uidx on public.default_categories (lower(name));

alter table public.default_categories enable row level security;
create policy default_categories_read on public.default_categories
  for select to authenticated
  using ((select public.is_permanent_user()));
revoke all on public.default_categories from anon;
revoke insert, update, delete on public.default_categories from authenticated;

insert into public.default_categories (name, kind_hint, color, sort_order)
select v.name, v.kind::public.transaction_kind, v.color, v.ord
from (values
  ('Food & Dining', 'expense', '#e8590c', 10),
  ('Groceries', 'expense', '#2f9e44', 20),
  ('Shopping', 'expense', '#ae3ec9', 30),
  ('Transport', 'expense', '#1c7ed6', 40),
  ('Fuel', 'expense', '#5c7cfa', 50),
  ('Bills & Utilities', 'expense', '#f08c00', 60),
  ('Rent', 'expense', '#c2255c', 70),
  ('Mobile & Internet', 'expense', '#0ca678', 80),
  ('Entertainment', 'expense', '#7048e8', 90),
  ('Health', 'expense', '#e03131', 100),
  ('Education', 'expense', '#3b5bdb', 110),
  ('Travel', 'expense', '#1098ad', 120),
  ('Personal Care', 'expense', '#d6336c', 130),
  ('Subscriptions', 'expense', '#6741d9', 140),
  ('Gifts & Donations', 'expense', '#f76707', 150),
  ('EMI & Loans', 'expense', '#495057', 160),
  ('Fees & Charges', 'expense', '#868e96', 170),
  ('Investments', 'self_transfer', '#087f5b', 180),
  ('Credit Card Bill', 'cc_bill_payment', '#5f3dc4', 190),
  ('Individual', 'expense', '#74b816', 200),
  ('Salary', 'income', '#2b8a3e', 210),
  ('Other', 'expense', '#adb5bd', 220)
) as v (name, kind, color, ord);

-- Each user's copy remembers which catalog entry it came from (renaming it keeps the link).
alter table public.categories
  add column default_category_id uuid references public.default_categories (id) on delete set null,
  add constraint categories_id_user_key unique (id, user_id);
create unique index categories_user_default_uidx on public.categories (user_id, default_category_id)
  where default_category_id is not null;

-- Gives catalog entries to users: a category with the same name is linked rather than duplicated.
create or replace function public.grant_default_categories(p_user_id uuid, p_default_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, name, kind_hint, color, is_system, default_category_id)
  select u.id, d.name, d.kind_hint, d.color, true, d.id
    from public.default_categories d
   cross join (
     select p.id from public.profiles p where p_user_id is null or p.id = p_user_id
   ) u
   where p_default_id is null or d.id = p_default_id
  on conflict (user_id, lower(name)) do update
    set default_category_id = coalesce(public.categories.default_category_id, excluded.default_category_id)
$$;
revoke execute on function public.grant_default_categories(uuid, uuid) from public, anon, authenticated;

-- New users: their categories come from the catalog.
create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.grant_default_categories(p_user_id, null)
$$;
revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- A category added to the catalog reaches every existing user.
create or replace function public.on_default_category_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.grant_default_categories(null, new.id);
  return new;
end;
$$;
create trigger default_category_added
  after insert on public.default_categories
  for each row execute function public.on_default_category_added();

-- Existing users: link their categories to the catalog and add the ones they are missing.
select public.grant_default_categories(null, null);

-- ---------------------------------------------------------------------------
-- Category keywords: keyword → category
-- ---------------------------------------------------------------------------
-- Shared rows (user_id null) point at the catalog and apply to everyone; a user's own rows point at
-- their category and win over shared ones. To add a keyword by hand:
--   insert into public.category_map_keyword (keyword, default_category_id)
--   select 'blinkit', id from public.default_categories where name = 'Groceries';
create table public.category_map_keyword (
  id uuid primary key default gen_random_uuid(),
  -- Lower-case words, matched on word boundaries against merchant, narration and UPI handle.
  keyword text not null check (keyword ~ '^[a-z0-9][a-z0-9 &.''-]{1,59}$'),
  default_category_id uuid references public.default_categories (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  category_id uuid,
  -- Optional override of the category's kind hint.
  transaction_kind public.transaction_kind,
  origin text not null default 'manual' check (origin in ('seed', 'llm', 'user', 'manual')),
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade,
  constraint category_map_keyword_scope check (
    (user_id is null and category_id is null and default_category_id is not null)
    or (user_id is not null and category_id is not null and default_category_id is null)
  )
);
create unique index category_map_keyword_shared_uidx on public.category_map_keyword (keyword) where user_id is null;
create unique index category_map_keyword_user_uidx on public.category_map_keyword (user_id, keyword) where user_id is not null;
create index category_map_keyword_category_idx on public.category_map_keyword (category_id) where category_id is not null;
create index category_map_keyword_default_idx on public.category_map_keyword (default_category_id) where default_category_id is not null;
create trigger set_updated_at before update on public.category_map_keyword
  for each row execute function public.set_updated_at();

alter table public.category_map_keyword enable row level security;
create policy category_map_keyword_read on public.category_map_keyword
  for select to authenticated
  using ((user_id is null or user_id = (select auth.uid())) and (select public.is_permanent_user()));
revoke all on public.category_map_keyword from anon;
revoke insert, update, delete on public.category_map_keyword from authenticated;

insert into public.category_map_keyword (keyword, default_category_id, origin)
select v.keyword, d.id, 'seed'
from (values
  ('zomato', 'Food & Dining'), ('swiggy', 'Food & Dining'), ('dominos', 'Food & Dining'),
  ('mcdonalds', 'Food & Dining'), ('kfc', 'Food & Dining'), ('starbucks', 'Food & Dining'),
  ('eatsure', 'Food & Dining'), ('box8', 'Food & Dining'),
  ('swiggy instamart', 'Groceries'), ('instamart', 'Groceries'), ('blinkit', 'Groceries'),
  ('zepto', 'Groceries'), ('bigbasket', 'Groceries'), ('dmart', 'Groceries'), ('jiomart', 'Groceries'),
  ('myntra', 'Shopping'), ('amazon', 'Shopping'), ('flipkart', 'Shopping'), ('ajio', 'Shopping'),
  ('meesho', 'Shopping'), ('nykaa', 'Shopping'), ('tata cliq', 'Shopping'), ('croma', 'Shopping'),
  ('decathlon', 'Shopping'),
  ('uber', 'Transport'), ('ola', 'Transport'), ('rapido', 'Transport'), ('namma yatri', 'Transport'),
  ('fastag', 'Transport'),
  ('indian oil', 'Fuel'), ('iocl', 'Fuel'), ('hpcl', 'Fuel'), ('bharat petroleum', 'Fuel'),
  ('bpcl', 'Fuel'),
  ('irctc', 'Travel'), ('makemytrip', 'Travel'), ('goibibo', 'Travel'), ('cleartrip', 'Travel'),
  ('indigo', 'Travel'), ('air india', 'Travel'), ('redbus', 'Travel'), ('ixigo', 'Travel'),
  ('oyo', 'Travel'),
  ('airtel', 'Mobile & Internet'), ('jio', 'Mobile & Internet'), ('bsnl', 'Mobile & Internet'),
  ('act fibernet', 'Mobile & Internet'),
  ('bescom', 'Bills & Utilities'), ('tata power', 'Bills & Utilities'), ('adani electricity', 'Bills & Utilities'),
  ('mahanagar gas', 'Bills & Utilities'), ('indane', 'Bills & Utilities'), ('bharatgas', 'Bills & Utilities'),
  ('apple media', 'Entertainment'), ('bookmyshow', 'Entertainment'), ('pvr', 'Entertainment'),
  ('inox', 'Entertainment'),
  ('netflix', 'Subscriptions'), ('spotify', 'Subscriptions'), ('hotstar', 'Subscriptions'),
  ('youtube premium', 'Subscriptions'), ('prime video', 'Subscriptions'), ('google play', 'Subscriptions'),
  ('apollo', 'Health'), ('pharmeasy', 'Health'), ('1mg', 'Health'), ('netmeds', 'Health'),
  ('practo', 'Health'), ('medplus', 'Health'),
  ('udemy', 'Education'), ('coursera', 'Education'), ('unacademy', 'Education'),
  ('urban company', 'Personal Care'),
  ('indmoney', 'Investments'), ('nse', 'Investments'), ('bse', 'Investments'),
  ('zerodha', 'Investments'), ('groww', 'Investments'), ('upstox', 'Investments'),
  ('angel one', 'Investments'), ('kuvera', 'Investments'), ('smallcase', 'Investments'),
  ('indian clearing corporation', 'Investments'),
  ('indmoney credit card repayment', 'Credit Card Bill'), ('cred club', 'Credit Card Bill'),
  ('credit card payment', 'Credit Card Bill'), ('credit card bill', 'Credit Card Bill')
) as v (keyword, category)
join public.default_categories d on d.name = v.category
on conflict do nothing;

-- Carry over users' learned merchant choices as their own keyword rows, then retire merchant_map.
insert into public.category_map_keyword (user_id, category_id, keyword, transaction_kind, origin)
select m.user_id, m.category_id,
       left(trim(regexp_replace(lower(m.merchant_name), '[^a-z0-9 &.''-]+', ' ', 'g')), 60),
       m.transaction_kind, 'user'
  from public.merchant_map m
  join public.categories c on c.id = m.category_id and c.user_id = m.user_id
 where m.merchant_name is not null
   and trim(regexp_replace(lower(m.merchant_name), '[^a-z0-9 &.''-]+', ' ', 'g')) ~ '^[a-z0-9][a-z0-9 &.''-]{1,59}$'
on conflict do nothing;

drop table public.merchant_map;
