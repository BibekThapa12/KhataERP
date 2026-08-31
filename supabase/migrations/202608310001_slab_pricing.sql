begin;

create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  scope text not null check (scope in ('ITEM', 'CATEGORY')),
  item_id uuid references public.items(id) on delete restrict,
  category_id uuid references public.item_categories(id) on delete restrict,
  quantity_unit text not null,
  effective_from_bs text not null,
  effective_from_bs_key integer not null,
  effective_until_bs text,
  effective_until_bs_key integer,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_rules_target_check check (
    (scope = 'ITEM' and item_id is not null and category_id is null)
    or (scope = 'CATEGORY' and category_id is not null and item_id is null)
  ),
  constraint pricing_rules_dates_check check (
    effective_until_bs_key is null or effective_until_bs_key >= effective_from_bs_key
  ),
  constraint pricing_rules_name_check check (char_length(btrim(name)) between 1 and 150),
  constraint pricing_rules_unit_check check (char_length(btrim(quantity_unit)) between 1 and 20)
);

create table if not exists public.pricing_rule_slabs (
  id uuid primary key default gen_random_uuid(),
  pricing_rule_id uuid not null references public.pricing_rules(id) on delete cascade,
  min_quantity numeric(18,6) not null check (min_quantity > 0),
  rate numeric(18,6) not null check (rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pricing_rule_id, min_quantity)
);

create index if not exists pricing_rules_company_active_dates_idx
  on public.pricing_rules(company_id, is_active, effective_from_bs_key, effective_until_bs_key);
create index if not exists pricing_rules_item_idx
  on public.pricing_rules(company_id, item_id, is_active) where scope = 'ITEM';
create index if not exists pricing_rules_category_idx
  on public.pricing_rules(company_id, category_id, is_active) where scope = 'CATEGORY';
create index if not exists pricing_rule_slabs_threshold_idx
  on public.pricing_rule_slabs(pricing_rule_id, min_quantity desc);

alter table public.invoice_items add column if not exists pricing_rule_id uuid references public.pricing_rules(id) on delete restrict;
alter table public.invoice_items add column if not exists pricing_slab_id uuid references public.pricing_rule_slabs(id) on delete restrict;
alter table public.invoice_items add column if not exists calculated_rate numeric(18,6);
alter table public.invoice_items add column if not exists price_overridden boolean not null default false;
alter table public.invoice_items add column if not exists pricing_snapshot jsonb;

create or replace function public.validate_pricing_rule_record()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.quantity_unit := btrim(new.quantity_unit);
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.created_by is null then new.created_by := auth.uid(); end if;

  if new.effective_from_bs !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or new.effective_from_bs_key <> replace(new.effective_from_bs, '-', '')::integer
    or (new.effective_until_bs is null) <> (new.effective_until_bs_key is null)
    or (new.effective_until_bs is not null and (
      new.effective_until_bs !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or new.effective_until_bs_key <> replace(new.effective_until_bs, '-', '')::integer
    )) then
    raise exception 'Pricing rule effective dates are invalid';
  end if;

  if new.scope = 'ITEM' then
    if not exists (
      select 1 from public.items item
      where item.id = new.item_id and item.company_id = new.company_id and not coalesce(item.is_service, false)
    ) then raise exception 'Pricing rule item must be a stock item belonging to the company'; end if;
    if not exists (select 1 from public.items item where item.id = new.item_id and lower(btrim(new.quantity_unit)) in (lower(btrim(item.unit)), lower(btrim(coalesce(item.alternate_unit, ''))))) then
      raise exception 'Pricing calculation unit is not available on the selected item';
    end if;
  elsif not exists (
    select 1 from public.item_categories category
    where category.id = new.category_id and category.company_id = new.company_id
  ) then raise exception 'Pricing rule category must belong to the company';
  elsif not exists (
    with recursive descendants as (
      select category.id from public.item_categories category where category.id = new.category_id
      union all select child.id from public.item_categories child join descendants parent on child.parent_category_id = parent.id
    )
    select 1 from public.items item join descendants category on category.id = item.category_id
    where item.company_id = new.company_id and not coalesce(item.is_service, false)
      and lower(btrim(new.quantity_unit)) in (lower(btrim(item.unit)), lower(btrim(coalesce(item.alternate_unit, ''))))
  ) then raise exception 'No stock items in this category support the selected calculation unit';
  end if;

  if new.is_active and exists (
    select 1 from public.pricing_rules other
    where other.id <> new.id
      and other.company_id = new.company_id
      and other.scope = new.scope
      and other.item_id is not distinct from new.item_id
      and other.category_id is not distinct from new.category_id
      and other.priority = new.priority
      and other.is_active
      and other.effective_from_bs_key <= coalesce(new.effective_until_bs_key, 99999999)
      and new.effective_from_bs_key <= coalesce(other.effective_until_bs_key, 99999999)
  ) then raise exception 'An active pricing rule with the same target, priority, and overlapping period already exists'; end if;
  return new;
end;
$$;

drop trigger if exists pricing_rule_record_guard on public.pricing_rules;
create trigger pricing_rule_record_guard before insert or update on public.pricing_rules
for each row execute function public.validate_pricing_rule_record();

create or replace function public.validate_invoice_item_pricing_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  voucher_company uuid;
  voucher_type text;
  selected_rule public.pricing_rules%rowtype;
  selected_slab public.pricing_rule_slabs%rowtype;
begin
  select voucher.company_id, voucher.type into voucher_company, voucher_type
  from public.vouchers voucher where voucher.id = new.voucher_id;
  if new.pricing_rule_id is null then
    if new.pricing_slab_id is not null or new.calculated_rate is not null or new.pricing_snapshot is not null then
      raise exception 'Pricing metadata requires a pricing rule';
    end if;
  else
    if voucher_type <> 'Sales' then raise exception 'Slab pricing metadata is supported only on Sales invoices'; end if;
    select * into selected_rule from public.pricing_rules rule where rule.id = new.pricing_rule_id and rule.company_id = voucher_company;
    if not found then raise exception 'Pricing rule must belong to the voucher company'; end if;
    select * into selected_slab from public.pricing_rule_slabs slab where slab.id = new.pricing_slab_id and slab.pricing_rule_id = new.pricing_rule_id;
    if not found then raise exception 'Pricing slab does not belong to the selected pricing rule'; end if;
    if new.pricing_slab_id is null or new.calculated_rate is null or new.pricing_snapshot is null
      or new.pricing_snapshot->>'rule_id' is distinct from new.pricing_rule_id::text
      or new.pricing_snapshot->>'slab_id' is distinct from new.pricing_slab_id::text
      or coalesce((new.pricing_snapshot->>'price_overridden')::boolean, false) is distinct from new.price_overridden
      or new.pricing_snapshot->>'rule_name' is distinct from selected_rule.name
      or new.pricing_snapshot->>'scope' is distinct from selected_rule.scope
      or lower(btrim(new.pricing_snapshot->>'quantity_unit')) is distinct from lower(btrim(selected_rule.quantity_unit))
      or abs(coalesce((new.pricing_snapshot->>'min_quantity')::numeric, -1) - selected_slab.min_quantity) > 0.000001
      or abs(coalesce((new.pricing_snapshot->>'rule_rate')::numeric, -1) - selected_slab.rate) > 0.000001
      or abs(coalesce((new.pricing_snapshot->>'calculated_entry_rate')::numeric, -1) - new.calculated_rate) > 0.000001 then
      raise exception 'Sales pricing snapshot is incomplete or inconsistent';
    end if;
    if not new.price_overridden and abs(new.rate - new.calculated_rate) > 0.000001 then
      raise exception 'Sales rate does not match the selected pricing slab';
    end if;
  end if;
  if new.calculated_rate is not null and new.calculated_rate < 0 then
    raise exception 'Calculated selling rate cannot be negative';
  end if;
  if new.price_overridden and not public.has_company_permission(voucher_company, 'pricing.override') then
    raise exception 'Manual selling-rate override permission is required' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_item_pricing_snapshot_guard on public.invoice_items;
create trigger invoice_item_pricing_snapshot_guard before insert or update of pricing_rule_id, pricing_slab_id, calculated_rate, price_overridden, pricing_snapshot
on public.invoice_items for each row execute function public.validate_invoice_item_pricing_snapshot();

alter table public.pricing_rules enable row level security;
alter table public.pricing_rule_slabs enable row level security;

drop policy if exists pricing_rules_read on public.pricing_rules;
create policy pricing_rules_read on public.pricing_rules for select to authenticated
using (public.is_company_member(company_id) or public.is_developer_admin());
drop policy if exists pricing_rules_manage on public.pricing_rules;
create policy pricing_rules_manage on public.pricing_rules for all to authenticated
using (public.has_company_permission(company_id, 'pricing.manage'))
with check (public.has_company_permission(company_id, 'pricing.manage'));

drop policy if exists pricing_rule_slabs_read on public.pricing_rule_slabs;
create policy pricing_rule_slabs_read on public.pricing_rule_slabs for select to authenticated
using (exists (
  select 1 from public.pricing_rules rule
  where rule.id = pricing_rule_id
    and (public.is_company_member(rule.company_id) or public.is_developer_admin())
));
drop policy if exists pricing_rule_slabs_manage on public.pricing_rule_slabs;
create policy pricing_rule_slabs_manage on public.pricing_rule_slabs for all to authenticated
using (exists (
  select 1 from public.pricing_rules rule
  where rule.id = pricing_rule_id and public.has_company_permission(rule.company_id, 'pricing.manage')
))
with check (exists (
  select 1 from public.pricing_rules rule
  where rule.id = pricing_rule_id and public.has_company_permission(rule.company_id, 'pricing.manage')
));

drop trigger if exists tenant_write_access_guard on public.pricing_rules;
create trigger tenant_write_access_guard before insert or update or delete on public.pricing_rules
for each row execute function public.enforce_tenant_write_access('direct');
drop trigger if exists tenant_write_access_guard on public.pricing_rule_slabs;
create or replace function public.enforce_pricing_slab_write_access()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_rule uuid; target_company uuid; company_row public.companies%rowtype;
begin
  if auth.uid() is null or public.is_developer_admin() then return case when tg_op = 'DELETE' then old else new end; end if;
  target_rule := case when tg_op = 'DELETE' then old.pricing_rule_id else new.pricing_rule_id end;
  select rule.company_id into target_company from public.pricing_rules rule where rule.id = target_rule;
  if target_company is null then raise exception 'Pricing rule not found' using errcode = 'P0002'; end if;
  select * into company_row from public.companies where id = target_company;
  if not public.has_company_permission(target_company, 'pricing.manage') then
    raise exception 'Pricing management access denied' using errcode = '42501';
  end if;
  if company_row.suspended or company_row.plan_status = 'expired'
     or (company_row.plan_status in ('trial','paid') and company_row.plan_expires_at is not null and company_row.plan_expires_at <= clock_timestamp()) then
    raise exception 'Company plan expired. This company is read-only until renewed.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger tenant_write_access_guard before insert or update or delete on public.pricing_rule_slabs
for each row execute function public.enforce_pricing_slab_write_access();

create or replace function public.save_pricing_rule_atomic(p_rule jsonb, p_slabs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid := nullif(p_rule->>'id', '')::uuid;
  target_company uuid := (p_rule->>'company_id')::uuid;
  saved public.pricing_rules%rowtype;
  previous jsonb := '{}'::jsonb;
  slab jsonb;
begin
  if not public.has_company_permission(target_company, 'pricing.manage') then
    raise exception 'Pricing management permission is required' using errcode = '42501';
  end if;
  perform set_config('khataerp.initializing_company', target_company::text, true);
  if jsonb_typeof(p_slabs) <> 'array' or jsonb_array_length(p_slabs) = 0 then
    raise exception 'Add at least one pricing slab';
  end if;
  if target_id is not null then
    select rule.* into saved from public.pricing_rules rule
    where rule.id = target_id and rule.company_id = target_company for update;
    if not found then raise exception 'Pricing rule not found'; end if;
    previous := to_jsonb(saved);
  end if;

  insert into public.pricing_rules(
    id, company_id, name, scope, item_id, category_id, quantity_unit,
    effective_from_bs, effective_from_bs_key, effective_until_bs, effective_until_bs_key,
    priority, is_active, created_by, updated_by
  ) values (
    coalesce(target_id, gen_random_uuid()), target_company, p_rule->>'name', p_rule->>'scope',
    nullif(p_rule->>'item_id', '')::uuid, nullif(p_rule->>'category_id', '')::uuid,
    p_rule->>'quantity_unit', p_rule->>'effective_from_bs', (p_rule->>'effective_from_bs_key')::integer,
    nullif(p_rule->>'effective_until_bs', ''), nullif(p_rule->>'effective_until_bs_key', '')::integer,
    coalesce((p_rule->>'priority')::integer, 0), coalesce((p_rule->>'is_active')::boolean, true), auth.uid(), auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name, scope = excluded.scope, item_id = excluded.item_id,
    category_id = excluded.category_id, quantity_unit = excluded.quantity_unit,
    effective_from_bs = excluded.effective_from_bs, effective_from_bs_key = excluded.effective_from_bs_key,
    effective_until_bs = excluded.effective_until_bs, effective_until_bs_key = excluded.effective_until_bs_key,
    priority = excluded.priority, is_active = excluded.is_active, updated_by = auth.uid()
  returning * into saved;

  delete from public.pricing_rule_slabs where pricing_rule_id = saved.id;
  for slab in select value from jsonb_array_elements(p_slabs) loop
    insert into public.pricing_rule_slabs(pricing_rule_id, min_quantity, rate)
    values (saved.id, (slab->>'min_quantity')::numeric, (slab->>'rate')::numeric);
  end loop;

  insert into public.master_change_logs(company_id, user_id, record_type, record_id, action, old_values, new_values)
  values (target_company, auth.uid(), 'pricing_rule', saved.id::text,
    case when target_id is null then 'create' else 'update' end, previous,
    to_jsonb(saved) || jsonb_build_object('slabs', p_slabs));

  return to_jsonb(saved) || jsonb_build_object('slabs', (
    select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity), '[]'::jsonb)
    from public.pricing_rule_slabs entry where entry.pricing_rule_id = saved.id
  ));
end;
$$;

create or replace function public.set_pricing_rule_active(p_rule_id uuid, p_is_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.pricing_rules%rowtype; previous jsonb;
begin
  select to_jsonb(rule) into previous from public.pricing_rules rule where rule.id = p_rule_id;
  if previous is null then raise exception 'Pricing rule not found'; end if;
  if not public.has_company_permission((previous->>'company_id')::uuid, 'pricing.manage') then
    raise exception 'Pricing management permission is required' using errcode = '42501';
  end if;
  perform set_config('khataerp.initializing_company', previous->>'company_id', true);
  update public.pricing_rules set is_active = p_is_active, updated_by = auth.uid(), updated_at = now()
  where id = p_rule_id returning * into saved;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(saved.company_id,auth.uid(),'pricing_rule',saved.id::text,case when p_is_active then 'activate' else 'deactivate' end,previous,to_jsonb(saved));
  return to_jsonb(saved) || jsonb_build_object('slabs', (select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

create or replace function public.duplicate_pricing_rule(p_rule_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare source public.pricing_rules%rowtype; saved public.pricing_rules%rowtype;
begin
  select * into source from public.pricing_rules where id = p_rule_id;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not public.has_company_permission(source.company_id, 'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company', source.company_id::text, true);
  insert into public.pricing_rules(company_id,name,scope,item_id,category_id,quantity_unit,effective_from_bs,effective_from_bs_key,effective_until_bs,effective_until_bs_key,priority,is_active,created_by,updated_by)
  values(source.company_id,left(source.name || ' Copy',150),source.scope,source.item_id,source.category_id,source.quantity_unit,source.effective_from_bs,source.effective_from_bs_key,source.effective_until_bs,source.effective_until_bs_key,source.priority,false,auth.uid(),auth.uid()) returning * into saved;
  insert into public.pricing_rule_slabs(pricing_rule_id,min_quantity,rate)
  select saved.id,min_quantity,rate from public.pricing_rule_slabs where pricing_rule_id=source.id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(saved.company_id,auth.uid(),'pricing_rule',saved.id::text,'duplicate',to_jsonb(source),to_jsonb(saved));
  return to_jsonb(saved) || jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

create or replace function public.delete_pricing_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare source public.pricing_rules%rowtype;
begin
  select * into source from public.pricing_rules where id=p_rule_id for update;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not public.has_company_permission(source.company_id,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company', source.company_id::text, true);
  if exists(select 1 from public.invoice_items where pricing_rule_id=p_rule_id) then raise exception 'This pricing rule is used by Sales invoices. Deactivate it instead.'; end if;
  delete from public.pricing_rules where id=p_rule_id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(source.company_id,auth.uid(),'pricing_rule',source.id::text,'delete',to_jsonb(source),'{}'::jsonb);
end; $$;

create or replace function public.validate_voucher_pricing_integrity()
returns trigger language plpgsql set search_path = public as $$
declare
  target_voucher uuid := coalesce(new.voucher_id, old.voucher_id);
  priced record;
  qualifying numeric;
  expected_slab uuid;
  expected_rate numeric;
  rule_factor numeric;
begin
  if not exists (select 1 from public.vouchers voucher where voucher.id = target_voucher and voucher.type = 'Sales') then
    return coalesce(new, old);
  end if;
  for priced in
    select line.*, rule.scope, rule.quantity_unit, slab.rate as slab_rate, item.unit as main_unit,
           item.alternate_unit, item.alternate_conversion
    from public.invoice_items line
    join public.pricing_rules rule on rule.id = line.pricing_rule_id
    join public.pricing_rule_slabs slab on slab.id = line.pricing_slab_id
    join public.items item on item.id = line.item_id
    where line.voucher_id = target_voucher and line.pricing_rule_id is not null
  loop
    qualifying := coalesce((priced.pricing_snapshot->>'qualifying_quantity')::numeric, -1);
    if qualifying < 0 or exists (
      select 1 from public.invoice_items candidate
      where candidate.voucher_id = target_voucher
        and candidate.pricing_rule_id = priced.pricing_rule_id
        and abs(coalesce((candidate.pricing_snapshot->>'qualifying_quantity')::numeric, -1) - qualifying) > 0.000001
    ) then raise exception 'Sales pricing qualification snapshot is inconsistent across invoice lines'; end if;

    select slab.id into expected_slab from public.pricing_rule_slabs slab
    where slab.pricing_rule_id = priced.pricing_rule_id and slab.min_quantity <= qualifying
    order by slab.min_quantity desc, slab.id limit 1;
    if expected_slab is distinct from priced.pricing_slab_id then
      raise exception 'Sales pricing slab does not match its saved qualifying quantity';
    end if;

    rule_factor := case
      when lower(btrim(priced.quantity_unit)) = lower(btrim(priced.main_unit)) then 1
      when lower(btrim(priced.quantity_unit)) = lower(btrim(coalesce(priced.alternate_unit, ''))) then priced.alternate_conversion
      else null end;
    expected_rate := round(priced.slab_rate * rule_factor / coalesce(nullif(priced.conversion_factor, 0), 1), 6);
    if expected_rate is null or abs(expected_rate - priced.calculated_rate) > 0.000001 then
      raise exception 'Sales calculated rate does not match the pricing slab unit conversion';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

revoke all on function public.validate_voucher_pricing_integrity() from public;

drop trigger if exists voucher_pricing_integrity_write on public.invoice_items;
drop trigger if exists voucher_pricing_integrity_delete on public.invoice_items;
create constraint trigger voucher_pricing_integrity_write after insert or update on public.invoice_items
deferrable initially deferred for each row
when (public.schedule_validation_once('pricing', new.voucher_id))
execute function public.validate_voucher_pricing_integrity();
create constraint trigger voucher_pricing_integrity_delete after delete on public.invoice_items
deferrable initially deferred for each row
when (public.schedule_validation_once('pricing', old.voucher_id))
execute function public.validate_voucher_pricing_integrity();


-- Extend the deployed atomic writer without replacing its evolving business
-- logic. The existing invoice_items insert and normalized response retain all
-- of their current fields and gain the immutable pricing snapshot fields.
do $extend_atomic_writer$
declare function_sql text;
begin
  select pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure) into function_sql;
  function_sql := replace(function_sql,
    'vat_amount, cost_rate' || E'\n  )',
    'vat_amount, cost_rate, pricing_rule_id, pricing_slab_id, calculated_rate, price_overridden, pricing_snapshot' || E'\n  )');
  function_sql := replace(function_sql,
    'item.base_qty, item.discount_amount, item.taxable_amount, item.vat_amount, item.cost_rate',
    'item.base_qty, item.discount_amount, item.taxable_amount, item.vat_amount, item.cost_rate, item.pricing_rule_id, item.pricing_slab_id, item.calculated_rate, coalesce(item.price_overridden, false), item.pricing_snapshot');
  function_sql := replace(function_sql,
    'vat_amount numeric, cost_rate numeric' || E'\n  );',
    'vat_amount numeric, cost_rate numeric, pricing_rule_id uuid, pricing_slab_id uuid, calculated_rate numeric, price_overridden boolean, pricing_snapshot jsonb' || E'\n  );');
  if position('item.pricing_rule_id' in function_sql) = 0 then raise exception 'Could not extend atomic voucher pricing fields'; end if;
  execute function_sql;

  select pg_get_functiondef('public.voucher_atomic_response(uuid)'::regprocedure) into function_sql;
  function_sql := replace(function_sql,
    $$'cost_rate', item.cost_rate$$,
    $$'cost_rate', item.cost_rate, 'pricing_rule_id', item.pricing_rule_id, 'pricing_slab_id', item.pricing_slab_id, 'calculated_rate', item.calculated_rate, 'price_overridden', item.price_overridden, 'pricing_snapshot', item.pricing_snapshot$$);
  if position('pricing_snapshot' in function_sql) = 0 then raise exception 'Could not extend voucher pricing response'; end if;
  execute function_sql;
end;
$extend_atomic_writer$;

do $extend_backup_exports$
declare function_sql text; signature regprocedure;
begin
  foreach signature in array array[
    'public.developer_export_company_backup(uuid)'::regprocedure,
    'public.system_export_company_backup(uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(signature) into function_sql;
    function_sql := replace(function_sql, $$'vouchers',$$, $$'pricingRules', coalesce((
      select jsonb_agg((to_jsonb(rule) - array['created_by','updated_by']) || jsonb_build_object(
        'slabs', coalesce((select jsonb_agg(to_jsonb(slab) order by slab.min_quantity) from public.pricing_rule_slabs slab where slab.pricing_rule_id = rule.id), '[]'::jsonb)
      ) order by rule.created_at, rule.id)
      from public.pricing_rules rule where rule.company_id = target_company
    ), '[]'::jsonb), 'vouchers',$$);
    if position('pricingRules' in function_sql) = 0 then raise exception 'Could not extend company backup export with pricing rules'; end if;
    execute function_sql;
  end loop;
end;
$extend_backup_exports$;

revoke all on function public.save_pricing_rule_atomic(jsonb,jsonb), public.set_pricing_rule_active(uuid,boolean), public.duplicate_pricing_rule(uuid), public.delete_pricing_rule(uuid) from public, anon;
grant execute on function public.save_pricing_rule_atomic(jsonb,jsonb), public.set_pricing_rule_active(uuid,boolean), public.duplicate_pricing_rule(uuid), public.delete_pricing_rule(uuid) to authenticated;
grant select on public.pricing_rules, public.pricing_rule_slabs to authenticated;

commit;
notify pgrst, 'reload schema';
