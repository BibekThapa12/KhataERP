-- Read-only administrator evidence. No historical repairs or posting changes.
create or replace function public.accounting_integrity_manifest(target_company uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not (
    coalesce(public.is_company_admin(target_company), false)
    or coalesce(public.is_developer_admin(), false)
  ) then
    raise exception 'Company administrator access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = target_company) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  -- Scalar JSON avoids PostgREST's row cap. Explicit company predicates apply
  -- to every relation, including children that have no company_id of their own.
  select jsonb_build_object(
    'company_id', target_company,
    'checked_at', statement_timestamp(),
    'counts', jsonb_build_object(
      'vouchers', (select count(*) from public.vouchers where company_id = target_company),
      'accounts', (select count(*) from public.accounts where company_id = target_company),
      'parties', (select count(*) from public.parties where company_id = target_company),
      'items', (select count(*) from public.items where company_id = target_company),
      'settlements', (select count(*) from public.voucher_settlements where company_id = target_company),
      'ledger_lines', (select count(*) from public.voucher_lines l join public.vouchers v on v.id = l.voucher_id where v.company_id = target_company),
      'invoice_items', (select count(*) from public.invoice_items l join public.vouchers v on v.id = l.voucher_id where v.company_id = target_company),
      'stock_lines', (select count(*) from public.stock_lines l join public.vouchers v on v.id = l.voucher_id where v.company_id = target_company)
    ),
    'voucher_ids', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from public.vouchers where company_id = target_company),
    'latest_voucher_update', (select max(updated_at) from public.vouchers where company_id = target_company)
  ) into result;
  return result;
end;
$$;
revoke all on function public.accounting_integrity_manifest(uuid) from public, anon;
grant execute on function public.accounting_integrity_manifest(uuid) to authenticated;
comment on function public.accounting_integrity_manifest(uuid) is
  'Read-only administrator company-scoped counts and voucher IDs for completeness diagnostics. Never repairs data.';
