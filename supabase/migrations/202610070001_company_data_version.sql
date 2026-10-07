begin;

-- One small revision row replaces full-table comparisons when a client returns
-- to the foreground. It is deliberately separate from the accounting snapshot:
-- the snapshot remains the recovery path, while this marker decides whether
-- that expensive recovery is necessary.
create table if not exists public.company_data_versions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  changed_at timestamptz not null default clock_timestamp()
);

alter table public.company_data_versions enable row level security;
revoke all on table public.company_data_versions from public, anon, authenticated;

insert into public.company_data_versions(company_id, version)
select company.id, 1
from public.companies company
on conflict (company_id) do nothing;

create or replace function public.bump_company_data_version(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_company_id is null then return; end if;
  insert into public.company_data_versions(company_id, version, changed_at)
  values (p_company_id, 1, clock_timestamp())
  on conflict (company_id) do update
    set version = public.company_data_versions.version + 1,
        changed_at = excluded.changed_at;
end;
$$;

revoke all on function public.bump_company_data_version(uuid) from public, anon, authenticated;

create or replace function public.track_company_data_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  source_row jsonb;
  target_company uuid;
begin
  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_argv[0] = 'company' then
    target_company := nullif(source_row ->> 'id', '')::uuid;
  else
    target_company := nullif(source_row ->> 'company_id', '')::uuid;
  end if;
  perform public.bump_company_data_version(target_company);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.track_company_data_version() from public, anon, authenticated;

drop trigger if exists companies_track_data_version on public.companies;
create trigger companies_track_data_version
after insert or update on public.companies
for each row execute function public.track_company_data_version('company');

drop trigger if exists vouchers_track_data_version on public.vouchers;
create trigger vouchers_track_data_version
after insert or update or delete on public.vouchers
for each row execute function public.track_company_data_version('direct');

drop trigger if exists accounts_track_data_version on public.accounts;
create trigger accounts_track_data_version
after insert or update or delete on public.accounts
for each row execute function public.track_company_data_version('direct');

drop trigger if exists account_categories_track_data_version on public.account_categories;
create trigger account_categories_track_data_version
after insert or update or delete on public.account_categories
for each row execute function public.track_company_data_version('direct');

drop trigger if exists parties_track_data_version on public.parties;
create trigger parties_track_data_version
after insert or update or delete on public.parties
for each row execute function public.track_company_data_version('direct');

drop trigger if exists items_track_data_version on public.items;
create trigger items_track_data_version
after insert or update or delete on public.items
for each row execute function public.track_company_data_version('direct');

drop trigger if exists item_categories_track_data_version on public.item_categories;
create trigger item_categories_track_data_version
after insert or update or delete on public.item_categories
for each row execute function public.track_company_data_version('direct');

drop trigger if exists pricing_rules_track_data_version on public.pricing_rules;
create trigger pricing_rules_track_data_version
after insert or update or delete on public.pricing_rules
for each row execute function public.track_company_data_version('direct');

create or replace function public.get_company_data_version(p_company_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result bigint;
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  select version into result
  from public.company_data_versions
  where company_id = p_company_id;
  return coalesce(result, 1);
end;
$$;

revoke all on function public.get_company_data_version(uuid) from public, anon;
grant execute on function public.get_company_data_version(uuid) to authenticated;
comment on function public.get_company_data_version(uuid) is
  'Returns one company-scoped revision bigint for cheap client freshness checks.';

notify pgrst, 'reload schema';
commit;
