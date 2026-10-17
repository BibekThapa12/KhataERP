-- On-demand serialized-inventory reporting. These functions intentionally stay
-- outside the company accounting snapshot so routine company loads remain small.

begin;

create index if not exists inventory_serial_movements_company_serial_created_idx
  on public.inventory_serial_movements(company_id, serial_id, created_at, id);

create or replace function public.get_inventory_serial_register(
  p_company_id uuid,
  p_query text default null,
  p_item_id uuid default null,
  p_status text default null,
  p_stock_condition text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security invoker
set search_path=public
as $$
declare
  result jsonb;
  safe_limit integer := least(200, greatest(1, coalesce(p_limit, 50)));
  safe_offset integer := greatest(0, coalesce(p_offset, 0));
  search_term text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if p_company_id is null or not public.is_company_member(p_company_id) then
    raise exception 'Serial register company access denied' using errcode='42501';
  end if;
  if p_status is not null and p_status not in ('available','sold','returned_to_supplier','adjusted_out','unavailable') then
    raise exception 'Invalid serial status filter';
  end if;
  if p_stock_condition is not null and p_stock_condition not in ('saleable','damaged','expired') then
    raise exception 'Invalid stock condition filter';
  end if;

  with active_movements as (
    select movement.*, voucher.type voucher_type, voucher.date_bs, voucher.date_bs_key,
      voucher.seq, voucher.invoice_no, voucher.draft_no, voucher.party_account_id,
      voucher.is_cash, voucher.narration
    from public.inventory_serial_movements movement
    join public.vouchers voucher on voucher.id=movement.voucher_id
    where movement.company_id=p_company_id
      and voucher.company_id=p_company_id
      and voucher.status='Completed'
      and not voucher.cancelled
  ), balances as (
    select serial.id serial_id, serial.serial_number, serial.normalized_serial,
      serial.item_id, item.name item_name, item.sku,
      coalesce(sum(case when movement.direction='in' then 1 else -1 end),0)::integer current_balance,
      coalesce(sum(case when movement.stock_condition='saleable' and movement.direction='in' then 1 when movement.stock_condition='saleable' then -1 else 0 end),0)::integer saleable_balance,
      coalesce(sum(case when movement.stock_condition='damaged' and movement.direction='in' then 1 when movement.stock_condition='damaged' then -1 else 0 end),0)::integer damaged_balance,
      coalesce(sum(case when movement.stock_condition='expired' and movement.direction='in' then 1 when movement.stock_condition='expired' then -1 else 0 end),0)::integer expired_balance
    from public.inventory_serials serial
    join public.items item on item.id=serial.item_id and item.company_id=p_company_id
    left join active_movements movement on movement.serial_id=serial.id
    where serial.company_id=p_company_id and (p_item_id is null or serial.item_id=p_item_id)
    group by serial.id, serial.serial_number, serial.normalized_serial, serial.item_id, item.name, item.sku
  ), enriched as (
    select balance.*,
      case when balance.current_balance>0 then 'available'
        when latest.voucher_type='Sales' then 'sold'
        when latest.voucher_type='Purchase Return' then 'returned_to_supplier'
        when latest.voucher_type='Stock Adjustment' then 'adjusted_out'
        else 'unavailable' end status,
      case when balance.current_balance<=0 then null
        when balance.saleable_balance>0 then 'saleable'
        when balance.damaged_balance>0 then 'damaged'
        when balance.expired_balance>0 then 'expired'
        else null end stock_condition,
      receipt.date_bs received_date_bs, receipt.voucher_id received_voucher_id,
      receipt.voucher_no received_voucher_no, receipt.voucher_type received_voucher_type,
      receipt.party_name received_party,
      latest.date_bs latest_date_bs, latest.voucher_id latest_voucher_id,
      latest.voucher_no latest_voucher_no, latest.voucher_type latest_voucher_type,
      latest.party_name latest_party
    from balances balance
    left join lateral (
      select movement.voucher_id, movement.date_bs, movement.voucher_type,
        coalesce(movement.invoice_no, movement.draft_no, movement.voucher_type || ' ' || movement.seq::text) voucher_no,
        coalesce(party.name, case when movement.is_cash then 'Cash' when movement.voucher_type='Stock Adjustment' then 'Stock Adjustment' end) party_name
      from active_movements movement
      left join public.parties party on party.company_id=p_company_id and party.account_id=movement.party_account_id
      where movement.serial_id=balance.serial_id and movement.direction='in'
      order by movement.date_bs_key, movement.seq, movement.created_at, movement.id
      limit 1
    ) receipt on true
    left join lateral (
      select movement.voucher_id, movement.date_bs, movement.voucher_type,
        coalesce(movement.invoice_no, movement.draft_no, movement.voucher_type || ' ' || movement.seq::text) voucher_no,
        coalesce(party.name, case when movement.is_cash then 'Cash' when movement.voucher_type='Stock Adjustment' then 'Stock Adjustment' end) party_name
      from active_movements movement
      left join public.parties party on party.company_id=p_company_id and party.account_id=movement.party_account_id
      where movement.serial_id=balance.serial_id
      order by movement.date_bs_key desc, movement.seq desc, movement.created_at desc, movement.id desc
      limit 1
    ) latest on true
  ), filtered as (
    select * from enriched serial_row
    where (p_status is null or serial_row.status=p_status)
      and (p_stock_condition is null or serial_row.stock_condition=p_stock_condition)
      and (search_term is null or concat_ws(' ', serial_row.serial_number, serial_row.item_name, serial_row.sku,
        serial_row.received_voucher_no, serial_row.received_party, serial_row.latest_voucher_no, serial_row.latest_party) ilike '%' || search_term || '%')
  ), paged as (
    select * from filtered
    order by lower(item_name), normalized_serial, serial_id
    limit safe_limit offset safe_offset
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'generated_at', now(),
    'total_count', (select count(*) from filtered),
    'summary', jsonb_build_object(
      'total', (select count(*) from filtered),
      'available', (select count(*) from filtered where status='available'),
      'saleable', (select count(*) from filtered where status='available' and stock_condition='saleable'),
      'damaged', (select count(*) from filtered where status='available' and stock_condition='damaged'),
      'expired', (select count(*) from filtered where status='available' and stock_condition='expired'),
      'sold', (select count(*) from filtered where status='sold'),
      'returned_to_supplier', (select count(*) from filtered where status='returned_to_supplier'),
      'adjusted_out', (select count(*) from filtered where status='adjusted_out'),
      'unavailable', (select count(*) from filtered where status='unavailable')
    ),
    'rows', coalesce((select jsonb_agg(to_jsonb(paged) - 'normalized_serial' - 'current_balance' - 'saleable_balance' - 'damaged_balance' - 'expired_balance'
      order by lower(item_name), normalized_serial, serial_id) from paged), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_inventory_serial_register(uuid,text,uuid,text,text,integer,integer) from public;
grant execute on function public.get_inventory_serial_register(uuid,text,uuid,text,text,integer,integer) to authenticated;

create or replace function public.get_inventory_serial_history(
  p_company_id uuid,
  p_serial_id uuid
) returns table(
  movement_id uuid,
  serial_id uuid,
  voucher_id uuid,
  date_bs text,
  date_bs_key integer,
  voucher_type text,
  voucher_no text,
  direction text,
  stock_condition text,
  party_name text,
  narration text,
  voucher_status text,
  cancelled boolean
)
language plpgsql
stable
security invoker
set search_path=public
as $$
begin
  if p_company_id is null or not public.is_company_member(p_company_id) then
    raise exception 'Serial history company access denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.inventory_serials serial where serial.id=p_serial_id and serial.company_id=p_company_id) then
    raise exception 'Serial number not found' using errcode='P0002';
  end if;

  return query
  select movement.id, movement.serial_id, movement.voucher_id,
    voucher.date_bs, voucher.date_bs_key, voucher.type,
    coalesce(voucher.invoice_no, voucher.draft_no, voucher.type || ' ' || voucher.seq::text),
    movement.direction, movement.stock_condition,
    coalesce(party.name, case when voucher.is_cash then 'Cash' when voucher.type='Stock Adjustment' then 'Stock Adjustment' end),
    coalesce(voucher.narration, voucher.return_reason), voucher.status, voucher.cancelled
  from public.inventory_serial_movements movement
  join public.vouchers voucher on voucher.id=movement.voucher_id and voucher.company_id=p_company_id
  left join lateral (
    select source.name from public.parties source
    where source.company_id=p_company_id and source.account_id=voucher.party_account_id
    order by source.created_at, source.id limit 1
  ) party on true
  where movement.company_id=p_company_id and movement.serial_id=p_serial_id
  order by voucher.date_bs_key desc, voucher.seq desc, movement.created_at desc, movement.id desc;
end;
$$;

revoke all on function public.get_inventory_serial_history(uuid,uuid) from public;
grant execute on function public.get_inventory_serial_history(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
