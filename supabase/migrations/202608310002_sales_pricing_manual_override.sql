-- Sales staff may always replace an automatically selected slab rate.
-- The calculated rule/slab snapshot remains validated and the final manual
-- rate is retained through the existing price_overridden flag.
begin;

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
  return new;
end;
$$;

commit;
notify pgrst, 'reload schema';
