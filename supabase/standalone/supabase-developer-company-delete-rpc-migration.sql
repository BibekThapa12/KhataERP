-- Developer-only company deletion in dependency order.
-- Fixes FK failures from account/item/voucher child tables during company cleanup.
-- Safe to rerun.

begin;

create or replace function public.delete_developer_company(target_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  account_category_guard_exists boolean;
begin
  if not public.is_developer_admin() then
    raise exception 'Developer admin access required' using errcode = '42501';
  end if;

  if target_company is null then
    raise exception 'Company id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.companies company where company.id = target_company) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  perform 1 from public.companies company where company.id = target_company for update;

  select exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.account_categories'::regclass
      and trigger_row.tgname = 'account_category_system_guard'
      and not trigger_row.tgisinternal
  ) into account_category_guard_exists;

  if account_category_guard_exists then
    execute 'alter table public.account_categories disable trigger account_category_system_guard';
  end if;

  begin
  update public.user_preferences
  set active_company_id = null,
      updated_at = now()
  where active_company_id = target_company;

  if to_regclass('public.cheque_events') is not null then
    delete from public.cheque_events where company_id = target_company;
  end if;
  if to_regclass('public.cheques') is not null then
    delete from public.cheques where company_id = target_company;
  end if;
  if to_regclass('public.cheque_banks') is not null then
    delete from public.cheque_banks where company_id = target_company;
  end if;

  delete from public.voucher_settlements settlement
  where settlement.company_id = target_company
     or exists (select 1 from public.vouchers voucher where voucher.id = settlement.settlement_voucher_id and voucher.company_id = target_company)
     or exists (select 1 from public.vouchers voucher where voucher.id = settlement.invoice_voucher_id and voucher.company_id = target_company);

  update public.invoice_items item
  set source_invoice_item_id = null
  where source_invoice_item_id is not null
    and (
      exists (select 1 from public.vouchers voucher where voucher.id = item.voucher_id and voucher.company_id = target_company)
      or exists (
        select 1
        from public.invoice_items source_item
        join public.vouchers source_voucher on source_voucher.id = source_item.voucher_id
        where source_item.id = item.source_invoice_item_id
          and source_voucher.company_id = target_company
      )
    );

  delete from public.invoice_items item
  where exists (select 1 from public.vouchers voucher where voucher.id = item.voucher_id and voucher.company_id = target_company);

  delete from public.stock_lines line
  where exists (select 1 from public.vouchers voucher where voucher.id = line.voucher_id and voucher.company_id = target_company);

  delete from public.voucher_lines line
  where exists (select 1 from public.vouchers voucher where voucher.id = line.voucher_id and voucher.company_id = target_company);

  update public.vouchers voucher
  set original_voucher_id = null
  where voucher.original_voucher_id is not null
    and exists (select 1 from public.vouchers original where original.id = voucher.original_voucher_id and original.company_id = target_company);

  delete from public.vouchers where company_id = target_company;

  delete from public.parties where company_id = target_company;
  delete from public.master_change_logs where company_id = target_company;

  delete from public.items where company_id = target_company;

  update public.item_categories
  set parent_category_id = null
  where company_id = target_company
    and parent_category_id is not null;
  delete from public.item_categories where company_id = target_company;

  delete from public.accounts where company_id = target_company;

  update public.account_categories
  set parent_category_id = null
  where company_id = target_company
    and parent_category_id is not null;
  delete from public.account_categories where company_id = target_company;

  if to_regclass('public.company_modules') is not null then
    delete from public.company_modules where company_id = target_company;
  end if;
  if to_regclass('public.company_user_permissions') is not null then
    delete from public.company_user_permissions where company_id = target_company;
  end if;

  delete from public.company_members where company_id = target_company;
  delete from public.app_events where company_id = target_company;
  delete from public.companies where id = target_company;

  exception when others then
    if account_category_guard_exists then
      execute 'alter table public.account_categories enable trigger account_category_system_guard';
    end if;
    raise;
  end;

  if account_category_guard_exists then
    execute 'alter table public.account_categories enable trigger account_category_system_guard';
  end if;
end;
$$;

revoke all on function public.delete_developer_company(uuid) from public, anon;
grant execute on function public.delete_developer_company(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
