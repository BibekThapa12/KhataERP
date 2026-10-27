-- Serial integrity and backups:
-- 1. Serial movements are written only through save_voucher_atomic.
-- 2. Cancelling, un-completing or editing a voucher cannot leave a serial with a
--    stock balance outside 0..1 (for example a sold serial whose purchase is gone).
-- 3. Cancelled purchases no longer block receiving the same serial again.
-- 4. Company backups include serial numbers, and restore can recreate them.

begin;

create or replace function public.assert_inventory_serial_balances(p_serial_ids uuid[])
returns void language plpgsql stable security invoker set search_path=public as $$
declare bad_serial text;
begin
  select serial.serial_number into bad_serial
  from public.inventory_serials serial
  where serial.id=any(coalesce(p_serial_ids,array[]::uuid[]))
    and public.inventory_serial_balance(serial.id,null,null) not between 0 and 1
  limit 1;
  if bad_serial is not null then
    raise exception 'Serial number % is used on other vouchers; cancel or edit those first',bad_serial;
  end if;
end;
$$;
revoke all on function public.assert_inventory_serial_balances(uuid[]) from public,anon;

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
  previous_serials uuid[];
begin
  -- Only save_voucher_atomic sets this flag, so direct RPC calls cannot rewrite serial history.
  if current_setting('khata.serial_voucher_id', true) is distinct from p_voucher_id::text then
    raise exception 'Serial movements can only be written while saving a voucher' using errcode='42501';
  end if;
  if p_company_id is null or not public.is_company_member(p_company_id) then
    raise exception 'Voucher company access denied' using errcode='42501';
  end if;
  select voucher.original_voucher_id into original_voucher
  from public.vouchers voucher where voucher.id=p_voucher_id and voucher.company_id=p_company_id;
  if not found then raise exception 'Voucher not found in this company' using errcode='42501'; end if;

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

  select coalesce(array_agg(distinct movement.serial_id),array[]::uuid[]) into previous_serials
  from public.inventory_serial_movements movement where movement.voucher_id=p_voucher_id;
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
        select 1 from public.inventory_serial_movements movement
        join public.vouchers voucher on voucher.id=movement.voucher_id and voucher.status='Completed' and not voucher.cancelled
        where movement.serial_id=serial_row.id and movement.voucher_id<>p_voucher_id and movement.direction='in'
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

  -- A serial dropped from an edited voucher must not leave other vouchers with impossible stock.
  perform public.assert_inventory_serial_balances(previous_serials);
end;
$$;
revoke all on function public.apply_voucher_serial_movements(uuid,uuid,text,jsonb) from public;
grant execute on function public.apply_voucher_serial_movements(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.guard_serialized_voucher_deactivation()
returns trigger language plpgsql security definer set search_path=public as $$
declare serial_ids uuid[];
begin
  if (old.status='Completed' and not old.cancelled) and not (new.status='Completed' and not new.cancelled) then
    select array_agg(distinct movement.serial_id) into serial_ids
    from public.inventory_serial_movements movement where movement.voucher_id=new.id;
    perform public.assert_inventory_serial_balances(serial_ids);
  end if;
  return null;
end;
$$;
revoke all on function public.guard_serialized_voucher_deactivation() from public,anon,authenticated;

drop trigger if exists vouchers_serialized_deactivation_guard on public.vouchers;
create trigger vouchers_serialized_deactivation_guard
after update of status,cancelled on public.vouchers
for each row execute function public.guard_serialized_voucher_deactivation();

do $serial_writer_flag_patch$
declare function_sql text;
begin
  select pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure) into function_sql;
  if position('khata.serial_voucher_id' in function_sql)>0 then return; end if;
  if position('perform public.apply_voucher_serial_movements(saved.id,' in function_sql)=0 then
    raise exception 'Could not locate serial inventory call in save_voucher_atomic';
  end if;
  function_sql:=replace(function_sql,
    'perform public.apply_voucher_serial_movements(saved.id,',
    'perform set_config(''khata.serial_voucher_id'', saved.id::text, true);' || chr(10) ||
    '  perform public.apply_voucher_serial_movements(saved.id,');
  execute function_sql;
end;
$serial_writer_flag_patch$;

do $serial_writer_flag_verify$
declare function_sql text;
begin
  select pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure) into function_sql;
  if position('khata.serial_voucher_id' in function_sql)=0 then raise exception 'Serial writer flag was not installed'; end if;
end;
$serial_writer_flag_verify$;

-- Serial rows for backups. Security invoker: members see only their own company through RLS.
create or replace function public.company_inventory_serial_backup(target_company uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'serial_number',serial.serial_number,
    'item_id',serial.item_id,
    'is_opening_stock',serial.is_opening_stock,
    'movements',coalesce((
      select jsonb_agg(jsonb_build_object('voucher_id',movement.voucher_id,'direction',movement.direction,'stock_condition',movement.stock_condition) order by movement.created_at,movement.id)
      from public.inventory_serial_movements movement where movement.serial_id=serial.id
    ),'[]'::jsonb)
  ) order by serial.created_at,serial.id),'[]'::jsonb)
  from public.inventory_serials serial where serial.company_id=target_company;
$$;
revoke all on function public.company_inventory_serial_backup(uuid) from public,anon;
grant execute on function public.company_inventory_serial_backup(uuid) to authenticated,service_role;

do $extend_backup_exports_serials$
declare function_sql text; signature regprocedure;
begin
  foreach signature in array array[
    'public.developer_export_company_backup(uuid)'::regprocedure,
    'public.system_export_company_backup(uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(signature) into function_sql;
    if position('inventorySerials' in function_sql)>0 then continue; end if;
    function_sql := replace(function_sql, $q$'vouchers',$q$, $q$'inventorySerials', public.company_inventory_serial_backup(target_company), 'vouchers',$q$);
    if position('inventorySerials' in function_sql) = 0 then raise exception 'Could not extend company backup export with serial numbers'; end if;
    execute function_sql;
  end loop;
end;
$extend_backup_exports_serials$;

-- Recreates serials from a portable backup after its items and Draft voucher headers
-- were restored. Safe to re-run when a restore is retried.
create or replace function public.restore_company_inventory_serials(p_company_id uuid,p_serials jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare
  entry jsonb;
  movement jsonb;
  saved_serial public.inventory_serials%rowtype;
  restored integer := 0;
begin
  if p_company_id is null or not public.is_company_admin(p_company_id) then
    raise exception 'Serial restore requires company administrator access' using errcode='42501';
  end if;
  for entry in select value from jsonb_array_elements(coalesce(p_serials,'[]'::jsonb)) loop
    if not exists(select 1 from public.items item where item.id=nullif(entry->>'item_id','')::uuid and item.company_id=p_company_id and item.is_serialized) then
      raise exception 'Serial number % refers to an item that is not a serialized item in this company',entry->>'serial_number';
    end if;
    select * into saved_serial from public.inventory_serials serial
    where serial.company_id=p_company_id and serial.normalized_serial=upper(btrim(entry->>'serial_number'));
    if not found then
      insert into public.inventory_serials(company_id,item_id,serial_number,created_by,is_opening_stock,opening_stock_condition)
      values(p_company_id,(entry->>'item_id')::uuid,btrim(entry->>'serial_number'),auth.uid(),
        coalesce((entry->>'is_opening_stock')::boolean,false),
        case when coalesce((entry->>'is_opening_stock')::boolean,false) then 'saleable' end)
      returning * into saved_serial;
    elsif saved_serial.item_id<>(entry->>'item_id')::uuid then
      raise exception 'Serial number % already belongs to another item in this company',entry->>'serial_number';
    end if;
    for movement in select value from jsonb_array_elements(coalesce(entry->'movements','[]'::jsonb)) loop
      -- Restore completes vouchers only after this step, so only Draft headers may receive movements.
      if not exists(select 1 from public.vouchers voucher where voucher.id=nullif(movement->>'voucher_id','')::uuid and voucher.company_id=p_company_id and voucher.status='Draft') then
        raise exception 'Serial number % refers to a voucher that is not a restored Draft in this company',entry->>'serial_number';
      end if;
      insert into public.inventory_serial_movements(company_id,voucher_id,item_id,serial_id,direction,stock_condition)
      values(p_company_id,(movement->>'voucher_id')::uuid,saved_serial.item_id,saved_serial.id,
        movement->>'direction',coalesce(nullif(movement->>'stock_condition',''),'saleable'))
      on conflict on constraint inventory_serial_movement_once do nothing;
    end loop;
    restored := restored + 1;
  end loop;
  update public.items item set opening_qty=opening.count
  from (
    select serial.item_id,count(*) count from public.inventory_serials serial
    where serial.company_id=p_company_id and serial.is_opening_stock group by serial.item_id
  ) opening
  where item.id=opening.item_id and item.company_id=p_company_id;
  return restored;
end;
$$;
revoke all on function public.restore_company_inventory_serials(uuid,jsonb) from public,anon;
grant execute on function public.restore_company_inventory_serials(uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
