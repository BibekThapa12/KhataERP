-- Phases 6 and 7: safe trigger and RLS optimization.
-- Apply after the system-group, retained-earnings, cheque-management, and
-- Phase 5 write-query migrations. Safe to run repeatedly.
begin;

-- ---------------------------------------------------------------------------
-- Trigger consolidation
-- ---------------------------------------------------------------------------

-- Two AFTER INSERT company triggers previously called the system-group seed:
-- the retained-ledger helper called it first, then the system-group trigger
-- called it again. Keep the public repair helper self-contained, but route new
-- companies through that complete dependency chain only once.
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

create or replace function public.seed_system_account_groups_for_company()
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

-- Retained earnings is now part of the ordered system-account bootstrap.
drop trigger if exists company_retained_earnings_ledger_seed on public.companies;
drop trigger if exists company_system_account_groups_seed on public.companies;
create trigger company_system_account_groups_seed
after insert on public.companies
for each row execute function public.seed_system_account_groups_for_company();

-- validate_cheque_bank compares lower(bank_name) for every inserted/updated
-- bank. Always index that predicate. Use a unique index when existing data is
-- clean; retain a non-unique lookup index when legacy duplicates exist so this
-- performance migration never deletes, renames, or reassigns cheque data.
do $$
begin
  if exists (
    select 1
    from public.cheque_banks
    group by company_id, lower(bank_name)
    having count(*) > 1
  ) then
    raise notice 'Legacy duplicate issuing-bank names found; creating a non-unique validation lookup index without modifying bank or cheque records.';
    if to_regclass('public.cheque_banks_company_name_ci_unique') is null then
      create index if not exists idx_cheque_banks_company_name_ci
        on public.cheque_banks(company_id, lower(bank_name));
    end if;
  else
    create unique index if not exists cheque_banks_company_name_ci_unique
      on public.cheque_banks(company_id, lower(bank_name));
    drop index if exists public.idx_cheque_banks_company_name_ci;
  end if;
end;
$$;

-- Deliberately retained without semantic changes:
--   voucher_lines_balance_guard is deferred and supports multi-statement SQL.
--   validate_voucher_settlement_trigger protects writes outside the RPC.
--   category hierarchy guards enforce depth/cycle/company/type rules.
--   cheque_touch_guard enforces transitions, entitlement, and account validity.
--   system-category guard prevents protected-group mutation.

-- ---------------------------------------------------------------------------
-- RLS init-plan optimization
-- ---------------------------------------------------------------------------

drop policy if exists "developer_admins_own_select" on public.developer_admins;
create policy "developer_admins_own_select" on public.developer_admins
  for select using (user_id = (select auth.uid()));

drop policy if exists "companies_own" on public.companies;
create policy "companies_own" on public.companies
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "companies_developer_select" on public.companies;
create policy "companies_developer_select" on public.companies
  for select using ((select public.is_developer_admin()));

drop policy if exists "companies_developer_update" on public.companies;
create policy "companies_developer_update" on public.companies
  for update
  using ((select public.is_developer_admin()))
  with check ((select public.is_developer_admin()));

drop policy if exists "companies_developer_delete" on public.companies;
create policy "companies_developer_delete" on public.companies
  for delete using ((select public.is_developer_admin()));

drop policy if exists modules_authenticated_select on public.modules;
create policy modules_authenticated_select on public.modules
  for select to authenticated using (true);

drop policy if exists modules_developer_all on public.modules;
create policy modules_developer_all on public.modules
  for all
  using ((select public.is_developer_admin()))
  with check ((select public.is_developer_admin()));

drop policy if exists company_modules_owner_select on public.company_modules;
create policy company_modules_owner_select on public.company_modules
  for select using (company_id = (select public.my_company_id()));

drop policy if exists company_modules_developer_all on public.company_modules;
create policy company_modules_developer_all on public.company_modules
  for all
  using ((select public.is_developer_admin()))
  with check ((select public.is_developer_admin()));

drop policy if exists company_permissions_own_select on public.company_user_permissions;
create policy company_permissions_own_select on public.company_user_permissions
  for select using (
    company_id = (select public.my_company_id())
    and user_id = (select auth.uid())
  );

drop policy if exists company_permissions_developer_all on public.company_user_permissions;
create policy company_permissions_developer_all on public.company_user_permissions
  for all
  using ((select public.is_developer_admin()))
  with check ((select public.is_developer_admin()));

-- For owner cheque policies, company_id is first constrained to the single
-- authenticated company. Entitlement and permission functions can therefore
-- use that scalar init-plan value once per statement without changing access.
drop policy if exists cheque_banks_read on public.cheque_banks;
create policy cheque_banks_read on public.cheque_banks
  for select using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', false))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.view'))
  );

drop policy if exists cheque_banks_write on public.cheque_banks;
create policy cheque_banks_write on public.cheque_banks
  for all
  using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.manage_banks'))
  )
  with check (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.manage_banks'))
  );

drop policy if exists cheques_read on public.cheques;
create policy cheques_read on public.cheques
  for select using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', false))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.view'))
  );

drop policy if exists cheques_insert on public.cheques;
create policy cheques_insert on public.cheques
  for insert with check (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.create'))
  );

drop policy if exists cheques_update on public.cheques;
create policy cheques_update on public.cheques
  for update
  using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
    and (
      (select public.has_company_permission((select public.my_company_id()), 'cheque.edit'))
      or (select public.has_company_permission((select public.my_company_id()), 'cheque.mark_cleared'))
      or (select public.has_company_permission((select public.my_company_id()), 'cheque.mark_bounced'))
      or (select public.has_company_permission((select public.my_company_id()), 'cheque.cancel'))
    )
  )
  with check (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
  );

drop policy if exists cheque_events_read on public.cheque_events;
create policy cheque_events_read on public.cheque_events
  for select using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', false))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.view'))
  );

drop policy if exists cheque_events_insert on public.cheque_events;
create policy cheque_events_insert on public.cheque_events
  for insert with check (
    company_id = (select public.my_company_id())
    and actor_id = (select auth.uid())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
  );

drop policy if exists cheque_events_developer_insert on public.cheque_events;
create policy cheque_events_developer_insert on public.cheque_events
  for insert with check (
    (select public.is_developer_admin())
    and actor_id = (select auth.uid())
  );

drop policy if exists cheque_module_developer_select_banks on public.cheque_banks;
create policy cheque_module_developer_select_banks on public.cheque_banks
  for select using ((select public.is_developer_admin()));

drop policy if exists cheque_module_developer_select_cheques on public.cheques;
create policy cheque_module_developer_select_cheques on public.cheques
  for select using ((select public.is_developer_admin()));

drop policy if exists cheque_module_developer_select_events on public.cheque_events;
create policy cheque_module_developer_select_events on public.cheque_events
  for select using ((select public.is_developer_admin()));

analyze public.cheque_banks;
analyze public.cheques;
analyze public.cheque_events;

commit;
notify pgrst, 'reload schema';
