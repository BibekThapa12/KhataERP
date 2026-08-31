-- Repair the target-column list of the atomic invoice_items INSERT.
-- Some pg_get_functiondef() layouts prevented the original whitespace-sensitive
-- replacement from matching, while its SELECT expressions were still extended.
do $repair_atomic_pricing_columns$
declare
  function_sql text;
  old_target_fields text := 'vat_amount, cost_rate';
  new_target_fields text := 'vat_amount, cost_rate, pricing_rule_id, pricing_slab_id, calculated_rate, price_overridden, pricing_snapshot';
begin
  select pg_get_functiondef(
    'public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure
  ) into function_sql;

  if position('item.pricing_rule_id' in function_sql) = 0
     or position('pricing_rule_id uuid' in function_sql) = 0 then
    raise exception 'Apply the atomic voucher pricing record repair before this migration';
  end if;

  if position(new_target_fields in function_sql) = 0 then
    function_sql := replace(function_sql, old_target_fields, new_target_fields);
  end if;

  if position(new_target_fields in function_sql) = 0 then
    raise exception 'Could not extend the atomic voucher pricing target columns';
  end if;

  execute function_sql;
end;
$repair_atomic_pricing_columns$;

notify pgrst, 'reload schema';
