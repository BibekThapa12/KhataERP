-- Serialized item opening stock. Opening serials are immutable origin records;
-- later corrections flow through stock-adjustment vouchers.

begin;

alter table public.inventory_serials
  add column if not exists is_opening_stock boolean not null default false,
  add column if not exists opening_stock_condition text;

alter table public.inventory_serials drop constraint if exists inventory_serials_opening_condition_check;
alter table public.inventory_serials add constraint inventory_serials_opening_condition_check check (
  (is_opening_stock and opening_stock_condition='saleable')
  or (not is_opening_stock and opening_stock_condition is null)
);

create or replace function public.guard_item_serialization_change()
returns trigger language plpgsql security invoker set search_path=public as $$
declare opening_serial_count integer;
begin
  if new.is_service and new.is_serialized then
    raise exception 'Service items cannot use serial-number tracking';
  end if;
  if new.is_serialized and (new.alternate_unit is not null or new.alternate_conversion is not null) then
    raise exception 'Serialized items can use only their main unit';
  end if;
  if new.is_serialized and (coalesce(new.opening_qty,0) < 0 or coalesce(new.opening_qty,0) <> trunc(coalesce(new.opening_qty,0))) then
    raise exception 'Serialized opening stock must be a non-negative whole number';
  end if;
  if new.is_serialized then
    if tg_op='INSERT' then
      opening_serial_count := 0;
    else
      select count(*)::integer into opening_serial_count
      from public.inventory_serials serial
      where serial.item_id=new.id and serial.company_id=new.company_id and serial.is_opening_stock;
    end if;
    if coalesce(new.opening_qty,0) <> opening_serial_count then
      raise exception 'Serialized opening quantity must match its opening serial numbers';
    end if;
  end if;
  if tg_op='UPDATE' and new.is_serialized and not old.is_serialized and exists(
    select 1 from public.stock_lines line where line.item_id=new.id
  ) then
    raise exception 'Serial tracking cannot be enabled after an item has stock history';
  end if;
  if tg_op='UPDATE' and old.is_serialized and not new.is_serialized and (
    exists(select 1 from public.inventory_serial_movements movement where movement.item_id=new.id)
    or exists(select 1 from public.inventory_serials serial where serial.item_id=new.id and serial.is_opening_stock)
  ) then
    raise exception 'Serial tracking cannot be disabled after serial inventory exists';
  end if;
  return new;
end;
$$;

drop trigger if exists items_serialization_guard on public.items;
create trigger items_serialization_guard
before insert or update of is_serialized,is_service,opening_qty,alternate_unit,alternate_conversion on public.items
for each row execute function public.guard_item_serialization_change();

create or replace function public.create_serialized_item_with_opening_stock(
  p_item jsonb,
  p_serial_numbers text[] default array[]::text[]
) returns public.items
language plpgsql security definer set search_path=public as $$
declare
  target_company uuid := nullif(p_item->>'company_id','')::uuid;
  saved public.items%rowtype;
  serial_text text;
  expected_count integer := coalesce((p_item->>'opening_qty')::numeric,0)::integer;
begin
  if target_company is null or not public.is_company_member(target_company) then
    raise exception 'Item company access denied' using errcode='42501';
  end if;
  if coalesce((p_item->>'is_service')::boolean,false) then raise exception 'Service items cannot use serial-number tracking'; end if;
  if nullif(btrim(coalesce(p_item->>'name','')),'') is null then raise exception 'Enter an item name'; end if;
  if nullif(btrim(coalesce(p_item->>'unit','')),'') is null then raise exception 'Select a main unit'; end if;
  if nullif(btrim(coalesce(p_item->>'alternate_unit','')),'') is not null or nullif(p_item->>'alternate_conversion','') is not null then
    raise exception 'Serialized items can use only their main unit';
  end if;
  if coalesce((p_item->>'opening_qty')::numeric,0) < 0
    or coalesce((p_item->>'opening_qty')::numeric,0) <> trunc(coalesce((p_item->>'opening_qty')::numeric,0)) then
    raise exception 'Serialized opening stock must be a non-negative whole number';
  end if;
  if coalesce((p_item->>'opening_rate')::numeric,0) < 0 then raise exception 'Opening cost cannot be negative'; end if;
  if coalesce(array_length(p_serial_numbers,1),0) <> expected_count then
    raise exception 'Assign exactly % opening serial numbers', expected_count;
  end if;
  if exists(select 1 from unnest(p_serial_numbers) serial where btrim(coalesce(serial,''))='') then
    raise exception 'Opening serial numbers cannot be blank';
  end if;
  if exists(select 1 from unnest(p_serial_numbers) serial group by upper(btrim(serial)) having count(*)>1) then
    raise exception 'Opening serial numbers must be unique';
  end if;
  if exists(
    select 1 from unnest(p_serial_numbers) supplied
    join public.inventory_serials existing on existing.company_id=target_company and existing.normalized_serial=upper(btrim(supplied))
  ) then raise exception 'One or more opening serial numbers already exist in this company'; end if;

  insert into public.items(
    company_id,name,unit,alternate_unit,alternate_conversion,sell_rate,opening_qty,opening_rate,
    reorder_level,category_id,sku,barcode,vat_applicable,is_service,is_serialized,is_archived
  ) values (
    target_company,btrim(p_item->>'name'),btrim(p_item->>'unit'),null,null,
    coalesce((p_item->>'sell_rate')::numeric,0),0,coalesce((p_item->>'opening_rate')::numeric,0),
    nullif(p_item->>'reorder_level','')::numeric,nullif(p_item->>'category_id','')::uuid,
    nullif(btrim(coalesce(p_item->>'sku','')),''),nullif(btrim(coalesce(p_item->>'barcode','')),''),
    coalesce((p_item->>'vat_applicable')::boolean,true),false,true,coalesce((p_item->>'is_archived')::boolean,false)
  ) returning * into saved;

  foreach serial_text in array p_serial_numbers loop
    insert into public.inventory_serials(company_id,item_id,serial_number,created_by,is_opening_stock,opening_stock_condition)
    values(target_company,saved.id,btrim(serial_text),auth.uid(),true,'saleable');
  end loop;

  update public.items set opening_qty=expected_count where id=saved.id returning * into saved;
  return saved;
end;
$$;
revoke all on function public.create_serialized_item_with_opening_stock(jsonb,text[]) from public;
grant execute on function public.create_serialized_item_with_opening_stock(jsonb,text[]) to authenticated;

create or replace function public.inventory_serial_balance(
  p_serial_id uuid,
  p_exclude_voucher_id uuid default null,
  p_stock_condition text default null
) returns integer
language sql stable security invoker set search_path=public as $$
  select (
    case when serial.is_opening_stock and (p_stock_condition is null or serial.opening_stock_condition=p_stock_condition) then 1 else 0 end
    + coalesce(sum(case when voucher.id is null then 0 when movement.direction='in' then 1 else -1 end),0)
  )::integer
  from public.inventory_serials serial
  left join public.inventory_serial_movements movement on movement.serial_id=serial.id
    and movement.voucher_id is distinct from p_exclude_voucher_id
    and (p_stock_condition is null or movement.stock_condition=p_stock_condition)
  left join public.vouchers voucher on voucher.id=movement.voucher_id and voucher.status='Completed' and not voucher.cancelled
  where serial.id=p_serial_id
  group by serial.id,serial.is_opening_stock,serial.opening_stock_condition;
$$;

create or replace function public.apply_voucher_serial_movements(
  p_voucher_id uuid,
  p_company_id uuid,
  p_voucher_type text,
  p_stock_lines jsonb
) returns void
language plpgsql security definer set search_path=public as $$
declare
  stock_record record;
  serial_text text;
  serial_row public.inventory_serials%rowtype;
  current_balance integer;
  condition_balance integer;
  original_voucher uuid;
begin
  if p_company_id is null or not public.is_company_member(p_company_id) then
    raise exception 'Voucher company access denied' using errcode='42501';
  end if;
  select voucher.original_voucher_id into original_voucher
  from public.vouchers voucher where voucher.id=p_voucher_id and voucher.company_id=p_company_id;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_stock_lines,'[]'::jsonb)) payload
    join public.items item on item.id=nullif(payload->>'item_id','')::uuid and item.company_id=p_company_id
    where item.is_serialized and (
      coalesce((payload->>'qty')::numeric,0) <> trunc(coalesce((payload->>'qty')::numeric,0))
      or jsonb_array_length(coalesce(payload->'serial_numbers','[]'::jsonb)) <> (payload->>'qty')::integer
    )
  ) then raise exception 'Every unit of a serialized item requires one serial number'; end if;

  if exists (
    select 1 from (
      select upper(btrim(serial.value)) normalized
      from jsonb_array_elements(coalesce(p_stock_lines,'[]'::jsonb)) payload
      cross join lateral jsonb_array_elements_text(coalesce(payload->'serial_numbers','[]'::jsonb)) serial(value)
      group by upper(btrim(serial.value))
      having count(*) > 1 and not (count(*)=2 and bool_and(coalesce((payload->>'is_transfer')::boolean,false)) and count(distinct payload->>'direction')=2)
    ) duplicate
  ) then raise exception 'A serial number cannot be used more than once in one voucher'; end if;

  if exists (
    select 1 from public.inventory_serial_movements existing
    join public.inventory_serial_movements returned on returned.serial_id=existing.serial_id
    join public.vouchers child on child.id=returned.voucher_id and child.original_voucher_id=p_voucher_id and child.status='Completed' and not child.cancelled
    join public.inventory_serials serial on serial.id=existing.serial_id
    where existing.voucher_id=p_voucher_id and not exists(
      select 1 from jsonb_array_elements(coalesce(p_stock_lines,'[]'::jsonb)) payload
      cross join lateral jsonb_array_elements_text(coalesce(payload->'serial_numbers','[]'::jsonb)) supplied(value)
      where upper(btrim(supplied.value))=serial.normalized_serial
    )
  ) then raise exception 'A serial number linked to an active return cannot be removed from its original voucher'; end if;

  delete from public.inventory_serial_movements where voucher_id=p_voucher_id;

  for stock_record in
    select payload,item.id item_id,item.is_serialized,payload->>'direction' direction,
      coalesce(nullif(payload->>'stock_condition',''),'saleable') stock_condition
    from jsonb_array_elements(coalesce(p_stock_lines,'[]'::jsonb)) payload
    join public.items item on item.id=nullif(payload->>'item_id','')::uuid and item.company_id=p_company_id
  loop
    if not stock_record.is_serialized then
      if jsonb_array_length(coalesce(stock_record.payload->'serial_numbers','[]'::jsonb))>0 then
        raise exception 'Serial numbers were supplied for an item that is not serialized';
      end if;
      continue;
    end if;

    for serial_text in select btrim(value) from jsonb_array_elements_text(coalesce(stock_record.payload->'serial_numbers','[]'::jsonb)) value loop
      if serial_text='' then raise exception 'Serial numbers cannot be blank'; end if;
      select * into serial_row from public.inventory_serials serial
      where serial.company_id=p_company_id and serial.normalized_serial=upper(serial_text) for update;

      if not found then
        if stock_record.direction<>'in' or p_voucher_type not in ('Purchase','Stock Adjustment') then
          raise exception 'Serial number % does not exist in inventory',serial_text;
        end if;
        insert into public.inventory_serials(company_id,item_id,serial_number,created_by,is_opening_stock,opening_stock_condition)
        values(p_company_id,stock_record.item_id,serial_text,auth.uid(),false,null) returning * into serial_row;
      elsif serial_row.item_id<>stock_record.item_id then
        raise exception 'Serial number % belongs to another item',serial_text;
      end if;

      current_balance := public.inventory_serial_balance(serial_row.id,p_voucher_id,null);
      condition_balance := public.inventory_serial_balance(serial_row.id,p_voucher_id,stock_record.stock_condition);

      if stock_record.direction='out' and condition_balance<=0 then
        raise exception 'Serial number % is not available in % stock',serial_text,stock_record.stock_condition;
      end if;
      if stock_record.direction='in' and p_voucher_type in ('Purchase','Stock Adjustment')
        and not coalesce((stock_record.payload->>'is_transfer')::boolean,false) and current_balance>0 then
        raise exception 'Serial number % is already available in inventory',serial_text;
      end if;
      if stock_record.direction='in' and p_voucher_type='Purchase' and (serial_row.is_opening_stock or exists(
        select 1 from public.inventory_serial_movements movement where movement.serial_id=serial_row.id and movement.voucher_id<>p_voucher_id and movement.direction='in'
      )) then raise exception 'Serial number % was already received previously',serial_text; end if;
      if stock_record.direction='in' and p_voucher_type='Sales Return' and (
        current_balance>0
        or (original_voucher is not null and not exists(select 1 from public.inventory_serial_movements movement where movement.serial_id=serial_row.id and movement.voucher_id=original_voucher and movement.direction='out'))
        or (original_voucher is null and not exists(
          select 1 from (
            select voucher.type,movement.direction from public.inventory_serial_movements movement
            join public.vouchers voucher on voucher.id=movement.voucher_id
            where movement.serial_id=serial_row.id and movement.voucher_id<>p_voucher_id and voucher.status='Completed' and not voucher.cancelled
            order by movement.created_at desc,movement.id desc limit 1
          ) latest where latest.type='Sales' and latest.direction='out'
        ))
      ) then raise exception 'Serial number % was not sold, is already available, or does not belong to the selected invoice',serial_text; end if;
      if stock_record.direction='out' and p_voucher_type='Purchase Return' and (
        (original_voucher is not null and not exists(select 1 from public.inventory_serial_movements movement where movement.serial_id=serial_row.id and movement.voucher_id=original_voucher and movement.direction='in'))
        or (original_voucher is null and not exists(
          select 1 from public.inventory_serial_movements movement join public.vouchers voucher on voucher.id=movement.voucher_id
          where movement.serial_id=serial_row.id and movement.voucher_id<>p_voucher_id and movement.direction='in' and voucher.type='Purchase' and voucher.status='Completed' and not voucher.cancelled
        ))
      ) then raise exception 'Serial number % was not received through an active purchase or does not belong to the selected purchase bill',serial_text; end if;

      insert into public.inventory_serial_movements(company_id,voucher_id,item_id,serial_id,direction,stock_condition)
      values(p_company_id,p_voucher_id,stock_record.item_id,serial_row.id,stock_record.direction,stock_record.stock_condition);
    end loop;
  end loop;
end;
$$;
revoke all on function public.apply_voucher_serial_movements(uuid,uuid,text,jsonb) from public;
grant execute on function public.apply_voucher_serial_movements(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.get_inventory_serial_candidates(
  p_company_id uuid,p_item_id uuid,p_mode text,p_source_voucher_id uuid default null,p_exclude_voucher_id uuid default null
) returns table(id uuid,serial_number text,item_id uuid,available boolean,last_voucher_id uuid)
language sql stable security invoker set search_path=public as $$
  with balances as (
    select serial.id,serial.serial_number,serial.normalized_serial,serial.item_id,
      public.inventory_serial_balance(serial.id,p_exclude_voucher_id,null)>0 available,
      public.inventory_serial_balance(serial.id,p_exclude_voucher_id,'saleable')>0 saleable_available,
      (array_agg(movement.voucher_id order by movement.created_at desc) filter(where voucher.id is not null))[1] last_voucher_id
    from public.inventory_serials serial
    left join public.inventory_serial_movements movement on movement.serial_id=serial.id and movement.voucher_id is distinct from p_exclude_voucher_id
    left join public.vouchers voucher on voucher.id=movement.voucher_id and voucher.status='Completed' and not voucher.cancelled
    where serial.company_id=p_company_id and serial.item_id=p_item_id and public.is_company_member(p_company_id)
    group by serial.id,serial.serial_number,serial.normalized_serial,serial.item_id
  )
  select balance.id,balance.serial_number,balance.item_id,balance.available,balance.last_voucher_id
  from balances balance
  where ((p_mode='sale' and balance.saleable_available) or (p_mode='purchase_return' and balance.available) or (p_mode='sales_return' and not balance.available))
    and (p_mode<>'purchase_return' or exists(
      select 1 from public.inventory_serial_movements purchased
      join public.vouchers purchase on purchase.id=purchased.voucher_id
      where purchased.serial_id=balance.id and purchased.direction='in' and purchase.type='Purchase'
        and purchase.status='Completed' and not purchase.cancelled
    ))
    and (p_source_voucher_id is null or exists(
      select 1 from public.inventory_serial_movements source
      where source.serial_id=balance.id and source.voucher_id=p_source_voucher_id and source.direction=case when p_mode='sales_return' then 'out' else 'in' end
    ))
  order by balance.normalized_serial;
$$;
revoke all on function public.get_inventory_serial_candidates(uuid,uuid,text,uuid,uuid) from public;
grant execute on function public.get_inventory_serial_candidates(uuid,uuid,text,uuid,uuid) to authenticated;

create or replace function public.inventory_serial_report_rows(p_company_id uuid,p_item_id uuid default null)
returns table(
  serial_id uuid,serial_number text,normalized_serial text,item_id uuid,item_name text,sku text,
  status text,stock_condition text,received_date_bs text,received_voucher_id uuid,received_voucher_no text,
  received_voucher_type text,received_party text,latest_date_bs text,latest_voucher_id uuid,
  latest_voucher_no text,latest_voucher_type text,latest_party text
)
language sql stable security invoker set search_path=public as $$
  with active_movements as (
    select movement.*,voucher.type voucher_type,voucher.date_bs,voucher.date_bs_key,voucher.seq,
      voucher.invoice_no,voucher.draft_no,voucher.party_account_id,voucher.is_cash
    from public.inventory_serial_movements movement
    join public.vouchers voucher on voucher.id=movement.voucher_id
    where movement.company_id=p_company_id and voucher.company_id=p_company_id and voucher.status='Completed' and not voucher.cancelled
  ), balances as (
    select serial.id serial_id,serial.serial_number,serial.normalized_serial,serial.item_id,
      item.name item_name,item.sku,serial.is_opening_stock,serial.opening_stock_condition,serial.created_at,
      (case when serial.is_opening_stock then 1 else 0 end + coalesce(sum(case when movement.direction='in' then 1 else -1 end),0))::integer current_balance,
      (case when serial.is_opening_stock and serial.opening_stock_condition='saleable' then 1 else 0 end + coalesce(sum(case when movement.stock_condition='saleable' and movement.direction='in' then 1 when movement.stock_condition='saleable' then -1 else 0 end),0))::integer saleable_balance,
      coalesce(sum(case when movement.stock_condition='damaged' and movement.direction='in' then 1 when movement.stock_condition='damaged' then -1 else 0 end),0)::integer damaged_balance,
      coalesce(sum(case when movement.stock_condition='expired' and movement.direction='in' then 1 when movement.stock_condition='expired' then -1 else 0 end),0)::integer expired_balance
    from public.inventory_serials serial
    join public.items item on item.id=serial.item_id and item.company_id=p_company_id
    left join active_movements movement on movement.serial_id=serial.id
    where serial.company_id=p_company_id and (p_item_id is null or serial.item_id=p_item_id) and public.is_company_member(p_company_id)
    group by serial.id,serial.serial_number,serial.normalized_serial,serial.item_id,item.name,item.sku,
      serial.is_opening_stock,serial.opening_stock_condition,serial.created_at
  )
  select balance.serial_id,balance.serial_number,balance.normalized_serial,balance.item_id,balance.item_name,balance.sku,
    case when balance.current_balance>0 then 'available'
      when latest.voucher_type='Sales' then 'sold'
      when latest.voucher_type='Purchase Return' then 'returned_to_supplier'
      when latest.voucher_type='Stock Adjustment' then 'adjusted_out'
      else 'unavailable' end status,
    case when balance.current_balance<=0 then null when balance.saleable_balance>0 then 'saleable'
      when balance.damaged_balance>0 then 'damaged' when balance.expired_balance>0 then 'expired' else null end stock_condition,
    case when balance.is_opening_stock then null else receipt.date_bs end,
    case when balance.is_opening_stock then null else receipt.voucher_id end,
    case when balance.is_opening_stock then 'Opening Stock' else receipt.voucher_no end,
    case when balance.is_opening_stock then 'Opening Stock' else receipt.voucher_type end,
    case when balance.is_opening_stock then null else receipt.party_name end,
    latest.date_bs,
    latest.voucher_id,
    coalesce(latest.voucher_no,case when balance.is_opening_stock then 'Opening Stock' end),
    coalesce(latest.voucher_type,case when balance.is_opening_stock then 'Opening Stock' end),
    latest.party_name
  from balances balance
  left join lateral (
    select movement.voucher_id,movement.date_bs,movement.voucher_type,
      coalesce(movement.invoice_no,movement.draft_no,movement.voucher_type || ' ' || movement.seq::text) voucher_no,
      coalesce(party.name,case when movement.is_cash then 'Cash' when movement.voucher_type='Stock Adjustment' then 'Stock Adjustment' end) party_name
    from active_movements movement
    left join lateral (
      select source.name from public.parties source where source.company_id=p_company_id and source.account_id=movement.party_account_id
      order by source.created_at,source.id limit 1
    ) party on true
    where movement.serial_id=balance.serial_id and movement.direction='in'
    order by movement.date_bs_key,movement.seq,movement.created_at,movement.id limit 1
  ) receipt on true
  left join lateral (
    select movement.voucher_id,movement.date_bs,movement.voucher_type,
      coalesce(movement.invoice_no,movement.draft_no,movement.voucher_type || ' ' || movement.seq::text) voucher_no,
      coalesce(party.name,case when movement.is_cash then 'Cash' when movement.voucher_type='Stock Adjustment' then 'Stock Adjustment' end) party_name
    from active_movements movement
    left join lateral (
      select source.name from public.parties source where source.company_id=p_company_id and source.account_id=movement.party_account_id
      order by source.created_at,source.id limit 1
    ) party on true
    where movement.serial_id=balance.serial_id
    order by movement.date_bs_key desc,movement.seq desc,movement.created_at desc,movement.id desc limit 1
  ) latest on true;
$$;

create or replace function public.get_inventory_serial_register(
  p_company_id uuid,p_query text default null,p_item_id uuid default null,p_status text default null,
  p_stock_condition text default null,p_limit integer default 50,p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare result jsonb; safe_limit integer:=least(200,greatest(1,coalesce(p_limit,50))); safe_offset integer:=greatest(0,coalesce(p_offset,0)); search_term text:=nullif(btrim(coalesce(p_query,'')),'');
begin
  if p_company_id is null or not public.is_company_member(p_company_id) then raise exception 'Serial register company access denied' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('available','sold','returned_to_supplier','adjusted_out','unavailable') then raise exception 'Invalid serial status filter'; end if;
  if p_stock_condition is not null and p_stock_condition not in ('saleable','damaged','expired') then raise exception 'Invalid stock condition filter'; end if;
  with filtered as (
    select * from public.inventory_serial_report_rows(p_company_id,p_item_id) row
    where (p_status is null or row.status=p_status) and (p_stock_condition is null or row.stock_condition=p_stock_condition)
      and (search_term is null or concat_ws(' ',row.serial_number,row.item_name,row.sku,row.received_voucher_no,row.received_party,row.latest_voucher_no,row.latest_party) ilike '%'||search_term||'%')
  ), paged as (
    select * from filtered order by lower(item_name),normalized_serial,serial_id limit safe_limit offset safe_offset
  )
  select jsonb_build_object(
    'company_id',p_company_id,'generated_at',now(),'total_count',(select count(*) from filtered),
    'summary',jsonb_build_object(
      'total',(select count(*) from filtered),'available',(select count(*) from filtered where status='available'),
      'saleable',(select count(*) from filtered where status='available' and stock_condition='saleable'),
      'damaged',(select count(*) from filtered where status='available' and stock_condition='damaged'),
      'expired',(select count(*) from filtered where status='available' and stock_condition='expired'),
      'sold',(select count(*) from filtered where status='sold'),
      'returned_to_supplier',(select count(*) from filtered where status='returned_to_supplier'),
      'adjusted_out',(select count(*) from filtered where status='adjusted_out'),
      'unavailable',(select count(*) from filtered where status='unavailable')),
    'rows',coalesce((select jsonb_agg(to_jsonb(paged)-'normalized_serial' order by lower(item_name),normalized_serial,serial_id) from paged),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_inventory_serial_register(uuid,text,uuid,text,text,integer,integer) from public;
grant execute on function public.get_inventory_serial_register(uuid,text,uuid,text,text,integer,integer) to authenticated;

create or replace function public.get_inventory_serial_item_groups(
  p_company_id uuid,p_query text default null,p_item_id uuid default null,p_status text default null,
  p_stock_condition text default null,p_limit integer default 20,p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare result jsonb; safe_limit integer:=least(100,greatest(1,coalesce(p_limit,20))); safe_offset integer:=greatest(0,coalesce(p_offset,0)); search_term text:=nullif(btrim(coalesce(p_query,'')),'');
begin
  if p_company_id is null or not public.is_company_member(p_company_id) then raise exception 'Serial register company access denied' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('available','sold','returned_to_supplier','adjusted_out','unavailable') then raise exception 'Invalid serial status filter'; end if;
  if p_stock_condition is not null and p_stock_condition not in ('saleable','damaged','expired') then raise exception 'Invalid stock condition filter'; end if;
  with filtered as (
    select * from public.inventory_serial_report_rows(p_company_id,p_item_id) row
    where (p_status is null or row.status=p_status) and (p_stock_condition is null or row.stock_condition=p_stock_condition)
      and (search_term is null or concat_ws(' ',row.serial_number,row.item_name,row.sku,row.received_voucher_no,row.received_party,row.latest_voucher_no,row.latest_party) ilike '%'||search_term||'%')
  ), grouped as (
    select item_id,min(item_name) item_name,min(sku) sku,count(*)::integer total,
      count(*) filter(where status='available')::integer available,
      count(*) filter(where status='available' and stock_condition='saleable')::integer saleable,
      count(*) filter(where status='available' and stock_condition='damaged')::integer damaged,
      count(*) filter(where status='available' and stock_condition='expired')::integer expired,
      count(*) filter(where status='sold')::integer sold,
      count(*) filter(where status='returned_to_supplier')::integer returned_to_supplier,
      count(*) filter(where status='adjusted_out')::integer adjusted_out,
      count(*) filter(where status='unavailable')::integer unavailable,
      case count(distinct received_party) filter(where received_party is not null) when 0 then
        case when bool_or(received_voucher_type='Opening Stock') then 'Opening Stock' else null end
        when 1 then min(received_party) else 'Multiple suppliers / sources' end primary_supplier
    from filtered group by item_id
  ), paged as (
    select * from grouped order by lower(item_name),item_id limit safe_limit offset safe_offset
  )
  select jsonb_build_object(
    'company_id',p_company_id,'generated_at',now(),'total_count',(select count(*) from filtered),'total_items',(select count(*) from grouped),
    'summary',jsonb_build_object(
      'total',(select count(*) from filtered),'available',(select count(*) from filtered where status='available'),
      'saleable',(select count(*) from filtered where status='available' and stock_condition='saleable'),
      'damaged',(select count(*) from filtered where status='available' and stock_condition='damaged'),
      'expired',(select count(*) from filtered where status='available' and stock_condition='expired'),
      'sold',(select count(*) from filtered where status='sold'),
      'returned_to_supplier',(select count(*) from filtered where status='returned_to_supplier'),
      'adjusted_out',(select count(*) from filtered where status='adjusted_out'),
      'unavailable',(select count(*) from filtered where status='unavailable')),
    'groups',coalesce((select jsonb_agg(to_jsonb(paged) order by lower(item_name),item_id) from paged),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_inventory_serial_item_groups(uuid,text,uuid,text,text,integer,integer) from public;
grant execute on function public.get_inventory_serial_item_groups(uuid,text,uuid,text,text,integer,integer) to authenticated;

drop function if exists public.get_inventory_serial_history(uuid,uuid);
create function public.get_inventory_serial_history(p_company_id uuid,p_serial_id uuid)
returns table(
  movement_id uuid,serial_id uuid,voucher_id uuid,date_bs text,date_bs_key integer,voucher_type text,voucher_no text,
  direction text,stock_condition text,party_name text,narration text,voucher_status text,cancelled boolean
)
language plpgsql stable security invoker set search_path=public as $$
begin
  if p_company_id is null or not public.is_company_member(p_company_id) then raise exception 'Serial history company access denied' using errcode='42501'; end if;
  if not exists(select 1 from public.inventory_serials serial where serial.id=p_serial_id and serial.company_id=p_company_id) then raise exception 'Serial number not found' using errcode='P0002'; end if;
  return query
  select history.movement_id,history.serial_id,history.voucher_id,history.date_bs,history.date_bs_key,
    history.voucher_type,history.voucher_no,history.direction,history.stock_condition,history.party_name,
    history.narration,history.voucher_status,history.cancelled from (
    select null::uuid movement_id,serial.id serial_id,null::uuid voucher_id,null::text date_bs,null::integer date_bs_key,
      'Opening Stock'::text voucher_type,'Opening Stock'::text voucher_no,'in'::text direction,
      serial.opening_stock_condition stock_condition,null::text party_name,'Opening balance'::text narration,
      'Completed'::text voucher_status,false cancelled,serial.created_at sort_created
    from public.inventory_serials serial where serial.id=p_serial_id and serial.company_id=p_company_id and serial.is_opening_stock
    union all
    select movement.id,movement.serial_id,movement.voucher_id,voucher.date_bs,voucher.date_bs_key,voucher.type,
      coalesce(voucher.invoice_no,voucher.draft_no,voucher.type||' '||voucher.seq::text),movement.direction,movement.stock_condition,
      coalesce(party.name,case when voucher.is_cash then 'Cash' when voucher.type='Stock Adjustment' then 'Stock Adjustment' end),
      coalesce(voucher.narration,voucher.return_reason),voucher.status,voucher.cancelled,movement.created_at
    from public.inventory_serial_movements movement
    join public.vouchers voucher on voucher.id=movement.voucher_id and voucher.company_id=p_company_id
    left join lateral (
      select source.name from public.parties source where source.company_id=p_company_id and source.account_id=voucher.party_account_id
      order by source.created_at,source.id limit 1
    ) party on true
    where movement.company_id=p_company_id and movement.serial_id=p_serial_id
  ) history
  order by history.date_bs_key desc nulls last,history.sort_created desc;
end;
$$;
revoke all on function public.get_inventory_serial_history(uuid,uuid) from public;
grant execute on function public.get_inventory_serial_history(uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
