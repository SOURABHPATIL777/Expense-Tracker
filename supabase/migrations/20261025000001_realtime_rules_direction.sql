-- Live import progress over Supabase Realtime (WebSocket) instead of polling: changes to a user's
-- imports are pushed to their browser. Row-level security still decides who receives which row.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'imports') then
    alter publication supabase_realtime add table public.imports;
  end if;
end;
$$;

-- Rules can apply to money in or out only (a friend's repayment isn't spending, salary is only a
-- credit), and the app creates "auto" rules when a user corrects one transaction so the same
-- counterparty is treated the same way everywhere.
alter table public.categorization_rules
  add column direction public.direction,
  add column origin text not null default 'user' check (origin in ('user', 'auto'));

-- One auto rule per counterparty and direction; editing again updates it.
create unique index categorization_rules_auto_dir_uidx
  on public.categorization_rules (user_id, field, lower(pattern), direction)
  where origin = 'auto' and direction is not null;
create unique index categorization_rules_auto_any_uidx
  on public.categorization_rules (user_id, field, lower(pattern))
  where origin = 'auto' and direction is null;
