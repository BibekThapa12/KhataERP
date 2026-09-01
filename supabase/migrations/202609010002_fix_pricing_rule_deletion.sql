-- Delete unused slab rows while their parent rule is still available to the
-- slab authorization trigger. Referenced rules remain protected and should be
-- deactivated instead.
create or replace function public.delete_pricing_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare source public.pricing_rules%rowtype;
begin
  select * into source from public.pricing_rules where id=p_rule_id for update;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not source.is_current then raise exception 'Superseded pricing rule versions cannot be deleted'; end if;
  if not public.has_company_permission(source.company_id,'pricing.manage') then
    raise exception 'Pricing management permission is required' using errcode='42501';
  end if;
  perform set_config('khataerp.initializing_company',source.company_id::text,true);
  if exists(select 1 from public.invoice_items where pricing_rule_id=p_rule_id)
     or exists(
       select 1 from public.vouchers voucher
       cross join lateral jsonb_array_elements(coalesce(voucher.draft_payload->'lines','[]'::jsonb)) line
       where voucher.company_id=source.company_id and voucher.status='Draft' and not voucher.cancelled
         and line->>'pricing_rule_id'=p_rule_id::text
     ) then raise exception 'This pricing rule is used by Sales invoices or drafts. Deactivate it instead.'; end if;

  delete from public.pricing_rule_slabs where pricing_rule_id=p_rule_id;
  delete from public.pricing_rules where id=p_rule_id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(source.company_id,auth.uid(),'pricing_rule',source.id::text,'delete',to_jsonb(source),'{}'::jsonb);
end; $$;

notify pgrst,'reload schema';
