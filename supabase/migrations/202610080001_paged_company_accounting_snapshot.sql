begin;

-- A complete company history can eventually exceed the hosted statement
-- timeout when PostgreSQL must serialize every voucher and child row into one
-- JSON value. Return bounded voucher bundles instead. The client validates the
-- company revision across all pages before publishing the combined snapshot.
create index if not exists vouchers_company_id_page_idx
  on public.vouchers(company_id, id);

create or replace function public.get_company_accounting_snapshot_page_v1(
  p_company_id uuid,
  p_after_id uuid default null,
  p_page_size integer default 200
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with requested as (
    select least(greatest(coalesce(p_page_size, 200), 25), 500) as page_size
  ), authorized as materialized (
    select p_company_id as company_id
    where auth.uid() is not null
      and public.is_company_member(p_company_id)
      and exists (select 1 from public.companies where id = p_company_id)
  ), page_candidates as materialized (
    select voucher.*
    from public.vouchers voucher
    join authorized access on access.company_id = voucher.company_id
    where p_after_id is null or voucher.id > p_after_id
    order by voucher.id
    limit (select page_size + 1 from requested)
  ), page_vouchers as materialized (
    select candidate.*
    from page_candidates candidate
    order by candidate.id
    limit (select page_size from requested)
  ), voucher_payload as materialized (
    select coalesce(jsonb_agg(
      case
        when voucher.status = 'Draft' or voucher.type = 'Journal' then
          to_jsonb(voucher) - array['created_by','updated_by','completed_by','updated_at','due_date_ad']::text[]
        else
          to_jsonb(voucher) - array['created_by','updated_by','completed_by','updated_at','due_date_ad','draft_payload']::text[]
      end
      order by voucher.id
    ), '[]'::jsonb) as rows
    from page_vouchers voucher
  ), ledger_payload as materialized (
    select coalesce(jsonb_agg(to_jsonb(line)), '[]'::jsonb) as rows
    from page_vouchers voucher
    cross join lateral (
      select child.* from public.voucher_lines child
      where child.voucher_id = voucher.id
      offset 0
    ) line
  ), stock_payload as materialized (
    select coalesce(jsonb_agg(to_jsonb(line)), '[]'::jsonb) as rows
    from page_vouchers voucher
    cross join lateral (
      select child.* from public.stock_lines child
      where child.voucher_id = voucher.id
      offset 0
    ) line
  ), invoice_payload as materialized (
    select coalesce(jsonb_agg(to_jsonb(line)), '[]'::jsonb) as rows
    from page_vouchers voucher
    cross join lateral (
      select child.* from public.invoice_items child
      where child.voucher_id = voucher.id
      offset 0
    ) line
  ), settlement_payload as materialized (
    select coalesce(jsonb_agg(to_jsonb(settlement)), '[]'::jsonb) as rows
    from page_vouchers voucher
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
      'format_version', 4,
      'company_id', p_company_id,
      'generated_at', statement_timestamp(),
      'data_version', coalesce((
        select version from public.company_data_versions
        where company_id = p_company_id
      ), 1),
      'page', jsonb_build_object(
        'has_more', (select count(*) from page_candidates) > (select page_size from requested),
        'next_after_id', (select id from page_vouchers order by id desc limit 1)
      ),
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

revoke all on function public.get_company_accounting_snapshot_page_v1(uuid, uuid, integer) from public, anon;
grant execute on function public.get_company_accounting_snapshot_page_v1(uuid, uuid, integer) to authenticated;
comment on function public.get_company_accounting_snapshot_page_v1(uuid, uuid, integer) is
  'Returns one bounded page of complete voucher bundles for timeout-safe company hydration.';

notify pgrst, 'reload schema';
commit;
