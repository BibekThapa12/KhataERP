-- Opt-in serialized inventory. Serial history is intentionally kept outside
-- the normal company snapshot and loaded only for the item/voucher being used.

begin;

alter table public.items add column if not exists is_serialized boolean not null default false;

create table if not exists public.inventory_serials (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  serial_number text not null,
  normalized_serial text generated always as (upper(btrim(serial_number))) stored,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint inventory_serial_number_present check (btrim(serial_number) <> ''),
  constraint inventory_serial_company_unique unique (company_id, normalized_serial)
);

create table if not exists public.inventory_serial_movements (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  serial_id uuid not null references public.inventory_serials(id) on delete restrict,
  direction text not null check (direction in ('in','out')),
  stock_condition text not null default 'saleable' check (stock_condition in ('saleable','damaged','expired')),
  created_at timestamptz not null default now(),
  constraint inventory_serial_movement_once unique (voucher_id, serial_id, direction)
);

create index if not exists inventory_serials_item_lookup_idx on public.inventory_serials(company_id, item_id, normalized_serial);
create index if not exists inventory_serial_movements_serial_voucher_idx on public.inventory_serial_movements(serial_id, voucher_id);
create index if not exists inventory_serial_movements_voucher_item_idx on public.inventory_serial_movements(voucher_id, item_id);

alter table public.inventory_serials enable row level security;
alter table public.inventory_serial_movements enable row level security;
drop policy if exists inventory_serials_member_select on public.inventory_serials;
create policy inventory_serials_member_select on public.inventory_serials for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists inventory_serial_movements_member_select on public.inventory_serial_movements;
create policy inventory_serial_movements_member_select on public.inventory_serial_movements for select to authenticated
  using (public.is_company_member(company_id));

create or replace function public.guard_item_serialization_change()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.is_service and new.is_serialized then
    raise exception 'Service items cannot use serial-number tracking';
  end if;
  if new.is_serialized and coalesce(new.opening_qty,0) <> 0 then
    raise exception 'Serialized items must have zero opening stock; receive serials through a Purchase invoice';
  end if;
  if tg_op='UPDATE' and new.is_serialized and not old.is_serialized and exists(
    select 1 from public.stock_lines line where line.item_id=new.id
  ) then
    raise exception 'Serial tracking cannot be enabled after an item has stock history';
  end if;
  if tg_op='UPDATE' and old.is_serialized and not new.is_serialized and exists(
    select 1 from public.inventory_serial_movements movement where movement.item_id=new.id
  ) then
    raise exception 'Serial tracking cannot be disabled after serial movements exist';
  end if;
  return new;
end;
$$;
drop trigger if exists items_serialization_guard on public.items;
create trigger items_serialization_guard before insert or update of is_serialized,is_service,opening_qty on public.items
for each row execute function public.guard_item_serialization_change();

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
    select 1
    from jsonb_array_elements(coalesce(p_stock_lines,'[]'::jsonb)) payload
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
      having count(*) > 1 and not (
        count(*)=2
        and bool_and(coalesce((payload->>'is_transfer')::boolean,false))
        and count(distinct payload->>'direction')=2
      )
    ) duplicate
  ) then raise exception 'A serial number cannot be used more than once in one voucher'; end if;

  if exists (
    select 1
    from public.inventory_serial_movements existing
    join public.inventory_serial_movements returned on returned.serial_id=existing.serial_id
    join public.vouchers child on child.id=returned.voucher_id and child.original_voucher_id=p_voucher_id
      and child.status='Completed' and not child.cancelled
    join public.inventory_serials serial on serial.id=existing.serial_id
    where existing.voucher_id=p_voucher_id and not exists(
      select 1 from jsonb_array_elements(coalesce(p_stock_lines,'[]'::jsonb)) payload
      cross join lateral jsonb_array_elements_text(coalesce(payload->'serial_numbers','[]'::jsonb)) supplied(value)
      where upper(btrim(supplied.value))=serial.normalized_serial
    )
  ) then raise exception 'A serial number linked to an active return cannot be removed from its original voucher'; end if;

  -- Replacing an edited voucher is safe: all work is in the writer transaction.
  delete from public.inventory_serial_movements where voucher_id=p_voucher_id;

  for stock_record in
    select payload, item.id item_id, item.is_serialized,
           payload->>'direction' direction,
           coalesce(nullif(payload->>'stock_condition',''),'saleable') stock_condition
    from jsonb_array_elements(coalesce(p_stock_lines,'[]'::jsonb)) payload
    join public.items item on item.id=nullif(payload->>'item_id','')::uuid and item.company_id=p_company_id
  loop
    if not stock_record.is_serialized then
      if jsonb_array_length(coalesce(stock_record.payload->'serial_numbers','[]'::jsonb)) > 0 then
        raise exception 'Serial numbers were supplied for an item that is not serialized';
      end if;
      continue;
    end if;
    if p_voucher_type in ('Sales Return','Purchase Return') and original_voucher is null then
      raise exception 'Serialized returns require an original invoice or purchase bill';
    end if;

    for serial_text in select btrim(value) from jsonb_array_elements_text(coalesce(stock_record.payload->'serial_numbers','[]'::jsonb)) value
    loop
      if serial_text='' then raise exception 'Serial numbers cannot be blank'; end if;
      select * into serial_row from public.inventory_serials serial
      where serial.company_id=p_company_id and serial.normalized_serial=upper(serial_text) for update;

      if not found then
        if stock_record.direction <> 'in' or p_voucher_type not in ('Purchase','Stock Adjustment') then
          raise exception 'Serial number % does not exist in inventory', serial_text;
        end if;
        insert into public.inventory_serials(company_id,item_id,serial_number,created_by)
        values(p_company_id,stock_record.item_id,serial_text,auth.uid()) returning * into serial_row;
      elsif serial_row.item_id <> stock_record.item_id then
        raise exception 'Serial number % belongs to another item', serial_text;
      end if;

      select coalesce(sum(case when movement.direction='in' then 1 else -1 end),0)::integer into current_balance
      from public.inventory_serial_movements movement
      join public.vouchers voucher on voucher.id=movement.voucher_id
      where movement.serial_id=serial_row.id and movement.voucher_id<>p_voucher_id
        and voucher.status='Completed' and not voucher.cancelled;

      select coalesce(sum(case when movement.direction='in' then 1 else -1 end),0)::integer into condition_balance
      from public.inventory_serial_movements movement
      join public.vouchers voucher on voucher.id=movement.voucher_id
      where movement.serial_id=serial_row.id and movement.voucher_id<>p_voucher_id
        and movement.stock_condition=stock_record.stock_condition
        and voucher.status='Completed' and not voucher.cancelled;

      if stock_record.direction='out' and condition_balance <= 0 then
        raise exception 'Serial number % is not available in % stock', serial_text, stock_record.stock_condition;
      end if;
      if stock_record.direction='in' and p_voucher_type='Purchase' and exists(
        select 1 from public.inventory_serial_movements movement where movement.serial_id=serial_row.id and movement.voucher_id<>p_voucher_id and movement.direction='in'
      ) then
        raise exception 'Serial number % was already received previously', serial_text;
      end if;
      if stock_record.direction='in' and p_voucher_type='Sales Return' and (
        current_balance > 0 or not exists(
          select 1 from public.inventory_serial_movements movement
          where movement.serial_id=serial_row.id and movement.voucher_id=original_voucher and movement.direction='out'
        )
      ) then raise exception 'Serial number % was not sold on the selected invoice or is already available', serial_text; end if;
      if stock_record.direction='out' and p_voucher_type='Purchase Return' and original_voucher is not null and not exists(
        select 1 from public.inventory_serial_movements movement
        where movement.serial_id=serial_row.id and movement.voucher_id=original_voucher and movement.direction='in'
      ) then raise exception 'Serial number % was not received on the selected purchase bill', serial_text; end if;

      insert into public.inventory_serial_movements(company_id,voucher_id,item_id,serial_id,direction,stock_condition)
      values(p_company_id,p_voucher_id,stock_record.item_id,serial_row.id,stock_record.direction,stock_record.stock_condition);
    end loop;
  end loop;
end;
$$;
revoke all on function public.apply_voucher_serial_movements(uuid,uuid,text,jsonb) from public;
grant execute on function public.apply_voucher_serial_movements(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.get_voucher_item_serials(p_company_id uuid,p_voucher_id uuid,p_item_id uuid)
returns table(serial_number text) language sql stable security invoker set search_path=public as $$
  select serial.serial_number from public.inventory_serial_movements movement
  join public.inventory_serials serial on serial.id=movement.serial_id
  where movement.company_id=p_company_id and movement.voucher_id=p_voucher_id and movement.item_id=p_item_id
    and public.is_company_member(p_company_id)
  order by serial.normalized_serial;
$$;
grant execute on function public.get_voucher_item_serials(uuid,uuid,uuid) to authenticated;

create or replace function public.get_inventory_serial_candidates(
  p_company_id uuid,p_item_id uuid,p_mode text,p_source_voucher_id uuid default null,p_exclude_voucher_id uuid default null
) returns table(id uuid,serial_number text,item_id uuid,available boolean,last_voucher_id uuid)
language sql stable security invoker set search_path=public as $$
  with balances as (
    select serial.id,serial.serial_number,serial.normalized_serial,serial.item_id,
      coalesce(sum(case when voucher.id is not null and movement.direction='in' then 1 when voucher.id is not null then -1 else 0 end),0) > 0 available,
      coalesce(sum(case when voucher.id is not null and movement.stock_condition='saleable' and movement.direction='in' then 1 when voucher.id is not null and movement.stock_condition='saleable' then -1 else 0 end),0) > 0 saleable_available,
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
    and (p_source_voucher_id is null or exists(
      select 1 from public.inventory_serial_movements source
      where source.serial_id=balance.id and source.voucher_id=p_source_voucher_id
        and source.direction=case when p_mode='sales_return' then 'out' else 'in' end
    ))
  order by balance.normalized_serial;
$$;
grant execute on function public.get_inventory_serial_candidates(uuid,uuid,text,uuid,uuid) to authenticated;

-- Inject serial validation after stock validation, retaining the deployed
-- writer signature used by all wrappers and clients.
do $serialized_writer_patch$
declare function_sql text;
begin
  select pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure) into function_sql;
  if position('apply_voucher_serial_movements' in function_sql)>0 then return; end if;
  if position('posting_stage := ''invoice_items_insert'';' in function_sql)=0 then
    raise exception 'Could not locate invoice-item stage in save_voucher_atomic; serial inventory patch was not applied';
  end if;
  function_sql:=replace(function_sql,
    'posting_stage := ''invoice_items_insert'';',
    'posting_stage := ''serial_inventory_validation'';' || chr(10) ||
    '  perform public.apply_voucher_serial_movements(saved.id, target_company, target_type, coalesce(p_stock_lines, ''[]''::jsonb));' || chr(10) || chr(10) ||
    '  posting_stage := ''invoice_items_insert'';');
  execute function_sql;
end;
$serialized_writer_patch$;

do $serialized_writer_verify$
declare function_sql text;
begin
  select pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure) into function_sql;
  if position('apply_voucher_serial_movements' in function_sql)=0 then raise exception 'Serialized inventory writer integration is missing'; end if;
end;
$serialized_writer_verify$;

notify pgrst, 'reload schema';
commit;
