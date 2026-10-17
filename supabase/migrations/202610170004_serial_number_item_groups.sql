-- Item-first serial register summaries. Detailed serial rows remain on-demand.

begin;

create or replace function public.get_inventory_serial_item_groups(
  p_company_id uuid,
  p_query text default null,
  p_item_id uuid default null,
  p_status text default null,
  p_stock_condition text default null,
  p_limit integer default 20,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security invoker
set search_path=public
as $$
declare
  result jsonb;
  safe_limit integer := least(100, greatest(1, coalesce(p_limit, 20)));
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
    select movement.*, voucher.type voucher_type, voucher.date_bs_key,
      voucher.seq, voucher.invoice_no, voucher.draft_no, voucher.party_account_id,
      voucher.is_cash
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
      receipt.voucher_no received_voucher_no, receipt.party_name received_party,
      latest.voucher_no latest_voucher_no, latest.party_name latest_party
    from balances balance
    left join lateral (
      select coalesce(movement.invoice_no, movement.draft_no, movement.voucher_type || ' ' || movement.seq::text) voucher_no,
        coalesce(party.name, case when movement.is_cash then 'Cash' when movement.voucher_type='Stock Adjustment' then 'Stock Adjustment' end) party_name
      from active_movements movement
      left join lateral (
        select source.name from public.parties source
        where source.company_id=p_company_id and source.account_id=movement.party_account_id
        order by source.created_at, source.id limit 1
      ) party on true
      where movement.serial_id=balance.serial_id and movement.direction='in'
      order by movement.date_bs_key, movement.seq, movement.created_at, movement.id
      limit 1
    ) receipt on true
    left join lateral (
      select movement.voucher_type,
        coalesce(movement.invoice_no, movement.draft_no, movement.voucher_type || ' ' || movement.seq::text) voucher_no,
        coalesce(party.name, case when movement.is_cash then 'Cash' when movement.voucher_type='Stock Adjustment' then 'Stock Adjustment' end) party_name
      from active_movements movement
      left join lateral (
        select source.name from public.parties source
        where source.company_id=p_company_id and source.account_id=movement.party_account_id
        order by source.created_at, source.id limit 1
      ) party on true
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
  ), grouped as (
    select item_id, min(item_name) item_name, min(sku) sku,
      count(*)::integer total,
      count(*) filter(where status='available')::integer available,
      count(*) filter(where status='available' and stock_condition='saleable')::integer saleable,
      count(*) filter(where status='available' and stock_condition='damaged')::integer damaged,
      count(*) filter(where status='available' and stock_condition='expired')::integer expired,
      count(*) filter(where status='sold')::integer sold,
      count(*) filter(where status='returned_to_supplier')::integer returned_to_supplier,
      count(*) filter(where status='adjusted_out')::integer adjusted_out,
      count(*) filter(where status='unavailable')::integer unavailable,
      case count(distinct received_party) filter(where received_party is not null)
        when 0 then null
        when 1 then min(received_party)
        else 'Multiple suppliers / sources'
      end primary_supplier
    from filtered
    group by item_id
  ), paged as (
    select * from grouped
    order by lower(item_name), item_id
    limit safe_limit offset safe_offset
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'generated_at', now(),
    'total_count', (select count(*) from filtered),
    'total_items', (select count(*) from grouped),
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
    'groups', coalesce((select jsonb_agg(to_jsonb(paged) order by lower(item_name), item_id) from paged), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_inventory_serial_item_groups(uuid,text,uuid,text,text,integer,integer) from public;
grant execute on function public.get_inventory_serial_item_groups(uuid,text,uuid,text,text,integer,integer) to authenticated;

notify pgrst, 'reload schema';

commit;
