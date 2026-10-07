begin;

-- Preserve the complete accounting history while removing response fields that
-- are redundant after a non-Journal voucher is completed. Drafts retain their
-- form payload, and Journals retain it for legacy Income/Expense/Contra typing.
create or replace function public.get_company_accounting_snapshot_v3(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with authorized as materialized (
    select p_company_id as company_id
    where auth.uid() is not null
      and public.is_company_member(p_company_id)
      and exists (select 1 from public.companies where id = p_company_id)
  ), scoped_vouchers as materialized (
    select voucher.*
    from public.vouchers voucher
    join authorized access on access.company_id = voucher.company_id
  ), voucher_payload as materialized (
    select coalesce(jsonb_agg(
      case
        when voucher.status = 'Draft' or voucher.type = 'Journal' then
          to_jsonb(voucher) - array['created_by','updated_by','completed_by','updated_at','due_date_ad']::text[]
        else
          to_jsonb(voucher) - array['created_by','updated_by','completed_by','updated_at','due_date_ad','draft_payload']::text[]
      end
    ), '[]'::jsonb) as rows
    from scoped_vouchers voucher
  ), ledger_payload as materialized (
    select coalesce(jsonb_agg(to_jsonb(line)), '[]'::jsonb) as rows
    from scoped_vouchers voucher
    cross join lateral (
      select child.* from public.voucher_lines child
      where child.voucher_id = voucher.id
      offset 0
    ) line
  ), stock_payload as materialized (
    select coalesce(jsonb_agg(to_jsonb(line)), '[]'::jsonb) as rows
    from scoped_vouchers voucher
    cross join lateral (
      select child.* from public.stock_lines child
      where child.voucher_id = voucher.id
      offset 0
    ) line
  ), invoice_payload as materialized (
    select coalesce(jsonb_agg(to_jsonb(line)), '[]'::jsonb) as rows
    from scoped_vouchers voucher
    cross join lateral (
      select child.* from public.invoice_items child
      where child.voucher_id = voucher.id
      offset 0
    ) line
  ), settlement_payload as materialized (
    select coalesce(jsonb_agg(to_jsonb(settlement)), '[]'::jsonb) as rows
    from scoped_vouchers voucher
    cross join lateral (
      select child.* from public.voucher_settlements child
      where child.settlement_voucher_id = voucher.id
        and child.company_id = p_company_id
      offset 0
    ) settlement
  )
  select case
    when not exists (select 1 from authorized) then
      jsonb_build_object('access_denied', true)
    else jsonb_build_object(
      'format_version', 3,
      'company_id', p_company_id,
      'generated_at', statement_timestamp(),
      'counts', jsonb_build_object(
        'vouchers', jsonb_array_length(voucher_payload.rows),
        'voucher_lines', jsonb_array_length(ledger_payload.rows),
        'stock_lines', jsonb_array_length(stock_payload.rows),
        'invoice_items', jsonb_array_length(invoice_payload.rows),
        'settlements', jsonb_array_length(settlement_payload.rows)
      ),
      'vouchers', voucher_payload.rows,
      'voucher_lines', ledger_payload.rows,
      'stock_lines', stock_payload.rows,
      'invoice_items', invoice_payload.rows,
      'settlements', settlement_payload.rows
    )
  end
  from voucher_payload, ledger_payload, stock_payload, invoice_payload, settlement_payload;
$$;

revoke all on function public.get_company_accounting_snapshot_v3(uuid) from public, anon;
grant execute on function public.get_company_accounting_snapshot_v3(uuid) to authenticated;
comment on function public.get_company_accounting_snapshot_v3(uuid) is
  'Returns a lean normalized company accounting snapshot without redundant completed-voucher draft payloads.';

notify pgrst, 'reload schema';
commit;
