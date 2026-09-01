begin;

alter table public.pricing_rules add column if not exists rule_family_id uuid;
alter table public.pricing_rules add column if not exists version_number integer;
alter table public.pricing_rules add column if not exists is_current boolean;
alter table public.pricing_rules add column if not exists supersedes_rule_id uuid;

update public.pricing_rules
set rule_family_id = coalesce(rule_family_id, id),
    version_number = coalesce(version_number, 1),
    is_current = coalesce(is_current, true)
where rule_family_id is null or version_number is null or is_current is null;

alter table public.pricing_rules alter column rule_family_id set not null;
alter table public.pricing_rules alter column rule_family_id set default gen_random_uuid();
alter table public.pricing_rules alter column version_number set not null;
alter table public.pricing_rules alter column version_number set default 1;
alter table public.pricing_rules alter column is_current set not null;
alter table public.pricing_rules alter column is_current set default true;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pricing_rules'::regclass and conname = 'pricing_rules_supersedes_rule_fkey') then
    alter table public.pricing_rules add constraint pricing_rules_supersedes_rule_fkey
      foreign key (supersedes_rule_id) references public.pricing_rules(id) on delete restrict deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pricing_rules'::regclass and conname = 'pricing_rules_version_positive') then
    alter table public.pricing_rules add constraint pricing_rules_version_positive check (version_number > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pricing_rules'::regclass and conname = 'pricing_rules_not_self_superseding') then
    alter table public.pricing_rules add constraint pricing_rules_not_self_superseding check (supersedes_rule_id is null or supersedes_rule_id <> id);
  end if;
end $$;

create unique index if not exists pricing_rules_family_version_unique on public.pricing_rules(company_id, rule_family_id, version_number);
create unique index if not exists pricing_rules_one_current_per_family on public.pricing_rules(company_id, rule_family_id) where is_current;
create index if not exists pricing_rules_family_history_idx on public.pricing_rules(company_id, rule_family_id, version_number desc);

create or replace function public.validate_pricing_rule_record()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name); new.quantity_unit := btrim(new.quantity_unit); new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by); if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.effective_from_bs !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or new.effective_from_bs_key <> replace(new.effective_from_bs, '-', '')::integer
    or (new.effective_until_bs is null) <> (new.effective_until_bs_key is null)
    or (new.effective_until_bs is not null and (new.effective_until_bs !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or new.effective_until_bs_key <> replace(new.effective_until_bs, '-', '')::integer))
  then raise exception 'Pricing rule effective dates are invalid'; end if;
  if new.scope = 'ITEM' then
    if not exists (select 1 from public.items item where item.id=new.item_id and item.company_id=new.company_id and not coalesce(item.is_service,false)) then raise exception 'Pricing rule item must be a stock item belonging to the company'; end if;
    if not exists (select 1 from public.items item where item.id=new.item_id and lower(btrim(new.quantity_unit)) in (lower(btrim(item.unit)),lower(btrim(coalesce(item.alternate_unit,''))))) then raise exception 'Pricing calculation unit is not available on the selected item'; end if;
  elsif not exists (select 1 from public.item_categories category where category.id=new.category_id and category.company_id=new.company_id) then
    raise exception 'Pricing rule category must belong to the company';
  elsif not exists (
    with recursive descendants as (select category.id from public.item_categories category where category.id=new.category_id union all select child.id from public.item_categories child join descendants parent on child.parent_category_id=parent.id)
    select 1 from public.items item join descendants category on category.id=item.category_id where item.company_id=new.company_id and not coalesce(item.is_service,false) and lower(btrim(new.quantity_unit)) in (lower(btrim(item.unit)),lower(btrim(coalesce(item.alternate_unit,''))))
  ) then raise exception 'No stock items in this category support the selected calculation unit'; end if;
  if new.is_current and new.is_active and exists (
    select 1 from public.pricing_rules other where other.id<>new.id and other.company_id=new.company_id
      and other.is_current and other.scope=new.scope and other.item_id is not distinct from new.item_id
      and other.category_id is not distinct from new.category_id and other.priority=new.priority and other.is_active
      and other.effective_from_bs_key <= coalesce(new.effective_until_bs_key,99999999)
      and new.effective_from_bs_key <= coalesce(other.effective_until_bs_key,99999999)
  ) then raise exception 'An active pricing rule with the same target, priority, and overlapping period already exists'; end if;
  return new;
end; $$;

create or replace function public.save_pricing_rule_atomic(p_rule jsonb, p_slabs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_id uuid := nullif(p_rule->>'id','')::uuid; target_company uuid := (p_rule->>'company_id')::uuid;
  source public.pricing_rules%rowtype; saved public.pricing_rules%rowtype; previous jsonb := '{}'::jsonb;
  slab jsonb; next_id uuid := gen_random_uuid(); next_family uuid; next_version integer := 1;
begin
  if not public.has_company_permission(target_company,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company',target_company::text,true);
  if jsonb_typeof(p_slabs)<>'array' or jsonb_array_length(p_slabs)=0 then raise exception 'Add at least one pricing slab'; end if;
  if target_id is not null then
    select * into source from public.pricing_rules where id=target_id and company_id=target_company for update;
    if not found then raise exception 'Pricing rule not found'; end if;
    if not source.is_current then raise exception 'Only the current pricing rule version can be edited'; end if;
    previous := to_jsonb(source) || jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=source.id));
    next_family := source.rule_family_id; next_version := source.version_number+1;
    update public.pricing_rules set is_current=false,is_active=false,updated_by=auth.uid(),updated_at=now() where id=source.id;
  else next_family := next_id; end if;

  insert into public.pricing_rules(id,company_id,rule_family_id,version_number,is_current,supersedes_rule_id,name,scope,item_id,category_id,quantity_unit,effective_from_bs,effective_from_bs_key,effective_until_bs,effective_until_bs_key,priority,is_active,created_by,updated_by)
  values(next_id,target_company,next_family,next_version,true,case when target_id is null then null else source.id end,p_rule->>'name',p_rule->>'scope',nullif(p_rule->>'item_id','')::uuid,nullif(p_rule->>'category_id','')::uuid,p_rule->>'quantity_unit',p_rule->>'effective_from_bs',(p_rule->>'effective_from_bs_key')::integer,nullif(p_rule->>'effective_until_bs',''),nullif(p_rule->>'effective_until_bs_key','')::integer,coalesce((p_rule->>'priority')::integer,0),coalesce((p_rule->>'is_active')::boolean,true),auth.uid(),auth.uid()) returning * into saved;
  for slab in select value from jsonb_array_elements(p_slabs) loop
    insert into public.pricing_rule_slabs(pricing_rule_id,min_quantity,rate) values(saved.id,(slab->>'min_quantity')::numeric,(slab->>'rate')::numeric);
  end loop;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(target_company,auth.uid(),'pricing_rule',saved.id::text,case when target_id is null then 'create' else 'version' end,previous,to_jsonb(saved)||jsonb_build_object('slabs',p_slabs));
  return to_jsonb(saved)||jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

create or replace function public.set_pricing_rule_active(p_rule_id uuid,p_is_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.pricing_rules%rowtype; previous jsonb;
begin
  select to_jsonb(rule) into previous from public.pricing_rules rule where rule.id=p_rule_id;
  if previous is null then raise exception 'Pricing rule not found'; end if;
  if coalesce((previous->>'is_current')::boolean,false)=false then raise exception 'A superseded pricing rule cannot be activated or deactivated'; end if;
  if not public.has_company_permission((previous->>'company_id')::uuid,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company',previous->>'company_id',true);
  update public.pricing_rules set is_active=p_is_active,updated_by=auth.uid(),updated_at=now() where id=p_rule_id returning * into saved;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values) values(saved.company_id,auth.uid(),'pricing_rule',saved.id::text,case when p_is_active then 'activate' else 'deactivate' end,previous,to_jsonb(saved));
  return to_jsonb(saved)||jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

create or replace function public.duplicate_pricing_rule(p_rule_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare source public.pricing_rules%rowtype; saved public.pricing_rules%rowtype; next_id uuid:=gen_random_uuid();
begin
  select * into source from public.pricing_rules where id=p_rule_id;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not public.has_company_permission(source.company_id,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company',source.company_id::text,true);
  insert into public.pricing_rules(id,company_id,rule_family_id,version_number,is_current,name,scope,item_id,category_id,quantity_unit,effective_from_bs,effective_from_bs_key,effective_until_bs,effective_until_bs_key,priority,is_active,created_by,updated_by)
  values(next_id,source.company_id,next_id,1,true,left(source.name||' Copy',150),source.scope,source.item_id,source.category_id,source.quantity_unit,source.effective_from_bs,source.effective_from_bs_key,source.effective_until_bs,source.effective_until_bs_key,source.priority,false,auth.uid(),auth.uid()) returning * into saved;
  insert into public.pricing_rule_slabs(pricing_rule_id,min_quantity,rate) select saved.id,min_quantity,rate from public.pricing_rule_slabs where pricing_rule_id=source.id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values) values(saved.company_id,auth.uid(),'pricing_rule',saved.id::text,'duplicate',to_jsonb(source),to_jsonb(saved));
  return to_jsonb(saved)||jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

notify pgrst,'reload schema';

create or replace function public.delete_pricing_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare source public.pricing_rules%rowtype;
begin
  select * into source from public.pricing_rules where id=p_rule_id for update;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not source.is_current then raise exception 'Superseded pricing rule versions cannot be deleted'; end if;
  if not public.has_company_permission(source.company_id,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company',source.company_id::text,true);
  if exists(select 1 from public.invoice_items where pricing_rule_id=p_rule_id)
     or exists(
       select 1 from public.vouchers voucher
       cross join lateral jsonb_array_elements(coalesce(voucher.draft_payload->'lines','[]'::jsonb)) line
       where voucher.company_id=source.company_id and voucher.status='Draft' and not voucher.cancelled
         and line->>'pricing_rule_id'=p_rule_id::text
     ) then raise exception 'This pricing rule is used by Sales invoices or drafts. Deactivate it instead.'; end if;
  delete from public.pricing_rules where id=p_rule_id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(source.company_id,auth.uid(),'pricing_rule',source.id::text,'delete',to_jsonb(source),'{}'::jsonb);
end; $$;

+-- Frozen draft snapshots retain their saved slab while new draft lines use the current version.
create or replace function public.validate_voucher_pricing_integrity()
returns trigger language plpgsql set search_path=public as $$
declare
  target_voucher uuid:=coalesce(new.voucher_id,old.voucher_id); priced record; qualifying numeric;
  expected_slab uuid; expected_rate numeric; rule_factor numeric;
begin
  if not exists(select 1 from public.vouchers voucher where voucher.id=target_voucher and voucher.type='Sales') then return coalesce(new,old); end if;
  for priced in
    select line.*,rule.scope,rule.quantity_unit,slab.rate as slab_rate,item.unit as main_unit,item.alternate_unit,item.alternate_conversion
    from public.invoice_items line join public.pricing_rules rule on rule.id=line.pricing_rule_id
    join public.pricing_rule_slabs slab on slab.id=line.pricing_slab_id join public.items item on item.id=line.item_id
    where line.voucher_id=target_voucher and line.pricing_rule_id is not null
  loop
    if coalesce((priced.pricing_snapshot->>'locked_from_draft')::boolean,false) then continue; end if;
    qualifying:=coalesce((priced.pricing_snapshot->>'qualifying_quantity')::numeric,-1);
    if qualifying<0 or exists(
      select 1 from public.invoice_items candidate where candidate.voucher_id=target_voucher
        and candidate.pricing_rule_id=priced.pricing_rule_id
        and not coalesce((candidate.pricing_snapshot->>'locked_from_draft')::boolean,false)
        and abs(coalesce((candidate.pricing_snapshot->>'qualifying_quantity')::numeric,-1)-qualifying)>0.000001
    ) then raise exception 'Sales pricing qualification snapshot is inconsistent across invoice lines'; end if;
    select slab.id into expected_slab from public.pricing_rule_slabs slab where slab.pricing_rule_id=priced.pricing_rule_id and slab.min_quantity<=qualifying order by slab.min_quantity desc,slab.id limit 1;
    if expected_slab is distinct from priced.pricing_slab_id then raise exception 'Sales pricing slab does not match its saved qualifying quantity'; end if;
    rule_factor:=case when lower(btrim(priced.quantity_unit))=lower(btrim(priced.main_unit)) then 1 when lower(btrim(priced.quantity_unit))=lower(btrim(coalesce(priced.alternate_unit,''))) then priced.alternate_conversion else null end;
    expected_rate:=round(priced.slab_rate*rule_factor/coalesce(nullif(priced.conversion_factor,0),1),6);
    if expected_rate is null or abs(expected_rate-priced.calculated_rate)>0.000001 then raise exception 'Sales calculated rate does not match the pricing slab unit conversion'; end if;
  end loop;
  return coalesce(new,old);
end; $$;

notify pgrst,'reload schema';
commit;
