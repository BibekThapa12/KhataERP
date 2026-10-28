-- Apply after supabase-system-account-groups-migration.sql.
-- Creates a real protected Retained Earnings ledger for every company.
begin;

create or replace function public.ensure_retained_earnings_ledger(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  retained_category_id uuid;
begin
  perform public.ensure_system_account_groups(target_company_id);

  select category.id into retained_category_id
  from public.account_categories category
  where category.company_id = target_company_id
    and category.name = 'Reserves & Surplus'
    and category.account_type = 'Equity'
  limit 1;

  if retained_category_id is null then
    raise exception 'Reserves & Surplus system group is missing for company %', target_company_id;
  end if;

  insert into public.accounts (
    id, company_id, name, type, "group", category_id,
    is_system, is_party, is_archived, opening_balance
  ) values (
    target_company_id::text || ':retained_earnings', target_company_id,
    'Retained Earnings', 'Equity', 'Reserves & Surplus', retained_category_id,
    true, false, false, 0
  )
  on conflict (id) do update set
    name = excluded.name,
    type = excluded.type,
    "group" = excluded."group",
    category_id = excluded.category_id,
    is_system = true,
    is_party = false,
    is_archived = false;
end;
$$;

do $$
declare company_record record;
begin
  for company_record in select id from public.companies loop
    perform public.ensure_retained_earnings_ledger(company_record.id);
  end loop;
end;
$$;

create or replace function public.seed_retained_earnings_ledger_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_retained_earnings_ledger(new.id);
  return new;
end;
$$;

drop trigger if exists company_retained_earnings_ledger_seed on public.companies;
create trigger company_retained_earnings_ledger_seed
after insert on public.companies
for each row execute function public.seed_retained_earnings_ledger_for_company();

commit;
notify pgrst, 'reload schema';
