-- Phase 5: optimize queries executed inside write operations.
-- Apply after the base schema and Phase 4 atomic voucher migration.
-- Safe to run repeatedly.
begin;

-- my_company_id() is evaluated by nearly every write RLS policy. Run the
-- indexed owner lookup without recursively evaluating companies RLS, then use
-- scalar init-plans in policies so PostgreSQL evaluates it once per statement
-- instead of once for every row in a bulk insert/update.
create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company.id
  from public.companies company
  where company.user_id = auth.uid()
  limit 1
$$;

revoke all on function public.my_company_id() from public;
grant execute on function public.my_company_id() to authenticated;

drop policy if exists "accounts_own" on public.accounts;
create policy "accounts_own" on public.accounts
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "account_categories_own" on public.account_categories;
create policy "account_categories_own" on public.account_categories
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "parties_own" on public.parties;
create policy "parties_own" on public.parties
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "items_own" on public.items;
create policy "items_own" on public.items
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "item_categories_own" on public.item_categories;
create policy "item_categories_own" on public.item_categories
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "master_change_logs_own" on public.master_change_logs;
create policy "master_change_logs_own" on public.master_change_logs
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "vouchers_own" on public.vouchers;
create policy "vouchers_own" on public.vouchers
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "vlines_own" on public.voucher_lines;
create policy "vlines_own" on public.voucher_lines
  for all using (
    exists (
      select 1 from public.vouchers voucher
      where voucher.id = voucher_id
        and voucher.company_id = (select public.my_company_id())
    )
  );

drop policy if exists "slines_own" on public.stock_lines;
create policy "slines_own" on public.stock_lines
  for all using (
    exists (
      select 1 from public.vouchers voucher
      where voucher.id = voucher_id
        and voucher.company_id = (select public.my_company_id())
    )
  );

drop policy if exists "iitems_own" on public.invoice_items;
create policy "iitems_own" on public.invoice_items
  for all using (
    exists (
      select 1 from public.vouchers voucher
      where voucher.id = voucher_id
        and voucher.company_id = (select public.my_company_id())
    )
  );

drop policy if exists "voucher_settlements_own" on public.voucher_settlements;
create policy "voucher_settlements_own" on public.voucher_settlements
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "app_events_own_insert" on public.app_events;
create policy "app_events_own_insert" on public.app_events
  for insert with check (
    company_id = (select public.my_company_id())
    and user_id = (select auth.uid())
  );

drop policy if exists "app_events_own_select" on public.app_events;
create policy "app_events_own_select" on public.app_events
  for select using (company_id = (select public.my_company_id()));

-- Developer policies are permissive alternatives to owner policies. Wrapping
-- the stable permission function likewise prevents a repeated admin lookup
-- while rows are processed or returned.
drop policy if exists "accounts_developer_select" on public.accounts;
create policy "accounts_developer_select" on public.accounts
  for select using ((select public.is_developer_admin()));

drop policy if exists "account_categories_developer_select" on public.account_categories;
create policy "account_categories_developer_select" on public.account_categories
  for select using ((select public.is_developer_admin()));

drop policy if exists "parties_developer_select" on public.parties;
create policy "parties_developer_select" on public.parties
  for select using ((select public.is_developer_admin()));

drop policy if exists "items_developer_select" on public.items;
create policy "items_developer_select" on public.items
  for select using ((select public.is_developer_admin()));

drop policy if exists "item_categories_developer_select" on public.item_categories;
create policy "item_categories_developer_select" on public.item_categories
  for select using ((select public.is_developer_admin()));

drop policy if exists "master_change_logs_developer_select" on public.master_change_logs;
create policy "master_change_logs_developer_select" on public.master_change_logs
  for select using ((select public.is_developer_admin()));

drop policy if exists "vouchers_developer_select" on public.vouchers;
create policy "vouchers_developer_select" on public.vouchers
  for select using ((select public.is_developer_admin()));

drop policy if exists "vlines_developer_select" on public.voucher_lines;
create policy "vlines_developer_select" on public.voucher_lines
  for select using (
    (select public.is_developer_admin())
    and exists (select 1 from public.vouchers voucher where voucher.id = voucher_id)
  );

drop policy if exists "slines_developer_select" on public.stock_lines;
create policy "slines_developer_select" on public.stock_lines
  for select using (
    (select public.is_developer_admin())
    and exists (select 1 from public.vouchers voucher where voucher.id = voucher_id)
  );

drop policy if exists "iitems_developer_select" on public.invoice_items;
create policy "iitems_developer_select" on public.invoice_items
  for select using (
    (select public.is_developer_admin())
    and exists (select 1 from public.vouchers voucher where voucher.id = voucher_id)
  );

drop policy if exists "voucher_settlements_developer_select" on public.voucher_settlements;
create policy "voucher_settlements_developer_select" on public.voucher_settlements
  for select using ((select public.is_developer_admin()));

drop policy if exists "app_events_developer_select" on public.app_events;
create policy "app_events_developer_select" on public.app_events
  for select using ((select public.is_developer_admin()));

-- This is the only new write-path index justified by an uncovered application
-- predicate: renaming an account group updates every directly assigned ledger
-- with WHERE accounts.category_id = <group>. It also supports the category FK
-- check on deletion. Existing voucher and child indexes already cover every
-- Phase 4 lookup, delete, validation, and response query.
create index if not exists idx_accounts_category_id
  on public.accounts(category_id)
  where category_id is not null;

-- Refresh estimates after policy/index changes. This does not rewrite data.
analyze public.companies;
analyze public.accounts;
analyze public.vouchers;
analyze public.voucher_lines;
analyze public.stock_lines;
analyze public.invoice_items;
analyze public.voucher_settlements;

commit;
notify pgrst, 'reload schema';
