-- Repair slab-pricing fields in the atomic voucher writer's JSON record.
-- The original migration patched the INSERT expression successfully, but
-- pg_get_functiondef() formatting prevented its record-declaration replacement
-- on some deployed function versions.
do $repair_atomic_pricing_record$
declare
  function_sql text;
  old_record_fields text := 'vat_amount numeric, cost_rate numeric';
  new_record_fields text := 'vat_amount numeric, cost_rate numeric, pricing_rule_id uuid, pricing_slab_id uuid, calculated_rate numeric, price_overridden boolean, pricing_snapshot jsonb';
begin
  select pg_get_functiondef(
    'public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure
  ) into function_sql;

  if position('item.pricing_rule_id' in function_sql) = 0 then
    raise exception 'The atomic voucher writer does not contain the pricing INSERT fields';
  end if;

  if position('pricing_rule_id uuid' in function_sql) = 0 then
    function_sql := replace(function_sql, old_record_fields, new_record_fields);
  end if;

  if position('pricing_rule_id uuid' in function_sql) = 0 then
    raise exception 'Could not extend the atomic voucher pricing record declaration';
  end if;

  execute function_sql;
end;
$repair_atomic_pricing_record$;

notify pgrst, 'reload schema';
