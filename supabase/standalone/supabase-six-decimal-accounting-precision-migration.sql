-- Preserve six-decimal accounting and inventory precision end-to-end.
-- Apply after all existing KhataERP migrations. Safe to run repeatedly.
begin;

drop table if exists pg_temp.six_decimal_trigger_restore;
create temporary table six_decimal_trigger_restore (
  trigger_name text primary key,
  definition text not null
);

insert into six_decimal_trigger_restore(trigger_name, definition)
select trigger.tgname, pg_get_triggerdef(trigger.oid, true)
from pg_trigger trigger
where trigger.tgrelid = 'public.vouchers'::regclass
  and not trigger.tgisinternal
  and trigger.tgname in (
    'vouchers_sync_contra_metadata',
    'vouchers_validate_contra',
    'vouchers_validate_simple_entry'
  );

drop trigger if exists vouchers_sync_contra_metadata on public.vouchers;
drop trigger if exists vouchers_validate_contra on public.vouchers;
drop trigger if exists vouchers_validate_simple_entry on public.vouchers;

do $precision$
declare
  target record;
begin
  for target in
    select * from (values
      ('accounts','opening_balance'),
      ('items','alternate_conversion'), ('items','sell_rate'),
      ('items','opening_qty'), ('items','opening_rate'), ('items','reorder_level'),
      ('vouchers','contra_charge_amount'), ('vouchers','subtotal'),
      ('vouchers','discount'), ('vouchers','vat_amount'), ('vouchers','total'),
      ('voucher_lines','debit'), ('voucher_lines','credit'),
      ('stock_lines','qty'), ('stock_lines','rate'),
      ('invoice_items','qty'), ('invoice_items','rate'),
      ('invoice_items','discount_amount'), ('invoice_items','taxable_amount'),
      ('invoice_items','vat_amount'), ('invoice_items','cost_rate'),
      ('invoice_items','conversion_factor'), ('invoice_items','base_qty'),
      ('voucher_settlements','amount'),
      ('cheques','amount'),
      ('cheque_subscription_plans','default_price'),
      ('company_cheque_subscriptions','price')
    ) as columns_to_widen(table_name, column_name)
  loop
    if exists (
      select 1 from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = target.table_name
        and column_info.column_name = target.column_name
    ) then
      execute format(
        'alter table public.%I alter column %I type numeric(18,6) using %I::numeric(18,6)',
        target.table_name, target.column_name, target.column_name
      );
    end if;
  end loop;
end;
$precision$;

do $restore_precision_triggers$
declare saved_trigger record;
begin
  for saved_trigger in select definition from six_decimal_trigger_restore order by trigger_name loop
    execute saved_trigger.definition;
  end loop;
end;
$restore_precision_triggers$;
drop table pg_temp.six_decimal_trigger_restore;

alter table public.invoice_items add column if not exists amount numeric(18,6);
alter table public.invoice_items disable trigger user;
update public.invoice_items
set amount = round(qty * rate, 6)
where amount is null;
alter table public.invoice_items alter column amount set not null;
alter table public.invoice_items enable trigger user;
alter table public.invoice_items drop constraint if exists invoice_items_amount_nonnegative;

create or replace function public.numeric_json_scale_valid(payload jsonb, numeric_keys text[])
returns boolean language sql immutable set search_path = public as $$
  select not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(payload) = 'array' then payload else jsonb_build_array(payload) end) object_value
    cross join unnest(numeric_keys) key_name
    where object_value ? key_name and nullif(object_value->>key_name, '') is not null
      and (object_value->>key_name)::numeric <> round((object_value->>key_name)::numeric, 6)
  );
$$;

-- Update the existing integrity function without discarding its security,
-- company ownership, return, stock, and cheque invariants.
do $rewrite_integrity$
declare
  function_sql text;
begin
  if to_regprocedure('public.validate_voucher_financial_integrity()') is null then
    raise exception 'validate_voucher_financial_integrity() must exist before applying precision migration';
  end if;

  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into function_sql;
  function_sql := replace(function_sql,
    'coalesce(sum(round(item.qty * item.rate, 2)), 0)',
    'coalesce(sum(item.amount), 0)');
  function_sql := replace(function_sql,
    'coalesce(sum(coalesce(item.taxable_amount, round(item.qty * item.rate, 2))), 0)',
    'coalesce(sum(coalesce(item.taxable_amount, item.amount)), 0)');
  function_sql := replace(function_sql, ', 2)', ', 6)');
  function_sql := replace(function_sql, '> 0.01', '> 0.000001');
  function_sql := replace(function_sql, '> greatest(0.02, item_count * 0.01)', '> greatest(0.000002, item_count * 0.000001)');
  function_sql := replace(function_sql, '> 0.0001', '> 0.000001');
  function_sql := replace(function_sql, '+ 0.0001', '+ 0.000001');
  execute function_sql;
end;
$rewrite_integrity$;

do $rewrite_related_validators$
declare
  function_name text;
  function_sql text;
begin
  foreach function_name in array array[
    'validate_simple_entry_voucher',
    'validate_contra_voucher',
    'validate_cleared_cheque_receipt'
  ] loop
    if to_regprocedure('public.' || function_name || '()') is not null then
      select pg_get_functiondef(to_regprocedure('public.' || function_name || '()')) into function_sql;
      function_sql := replace(function_sql, ', 2)', ', 6)');
      function_sql := replace(function_sql, ',2)', ',6)');
      function_sql := replace(function_sql, '> 0.01', '> 0.000001');
      execute function_sql;
    end if;
  end loop;
end;
$rewrite_related_validators$;

-- Teach the atomic writer and its normalized response about the authoritative
-- invoice amount while retaining the deployed function signature.
do $rewrite_atomic$
declare
  function_sql text;
begin
  if to_regprocedure('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)') is null then
    raise exception 'save_voucher_atomic() must exist before applying precision migration';
  end if;

  select pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure)
    into function_sql;
  function_sql := replace(function_sql, 'numeric(14,2)', 'numeric(18,6)');
  function_sql := replace(function_sql,
    'voucher_id, item_id, qty, rate, source_invoice_item_id, item_name, unit,',
    'voucher_id, item_id, qty, rate, amount, source_invoice_item_id, item_name, unit,');
  function_sql := replace(function_sql,
    'select saved.id, item.item_id, item.qty, item.rate, item.source_invoice_item_id,',
    'select saved.id, item.item_id, item.qty, item.rate, coalesce(item.amount, round(item.qty * item.rate, 6)), item.source_invoice_item_id,');
  function_sql := replace(function_sql,
    'item_id uuid, qty numeric, rate numeric, source_invoice_item_id uuid,',
    'item_id uuid, qty numeric, rate numeric, amount numeric, source_invoice_item_id uuid,');
  function_sql := replace(function_sql,
    $$  select coalesce(sum(coalesce(line.debit, 0)), 0),$$,
    $$  if not public.numeric_json_scale_valid(p_voucher, array['subtotal','discount','vat_amount','total','contra_charge_amount'])
    or not public.numeric_json_scale_valid(coalesce(p_lines,'[]'::jsonb), array['debit','credit'])
    or not public.numeric_json_scale_valid(coalesce(p_stock_lines,'[]'::jsonb), array['qty','rate'])
    or not public.numeric_json_scale_valid(coalesce(p_invoice_items,'[]'::jsonb), array['qty','rate','amount','discount_amount','taxable_amount','vat_amount','cost_rate','conversion_factor','base_qty'])
    or not public.numeric_json_scale_valid(coalesce(p_settlements,'[]'::jsonb), array['amount']) then
    raise exception 'Accounting values support at most six decimal places';
  end if;

  select coalesce(sum(coalesce(line.debit, 0)), 0),$$);
  execute function_sql;

  select pg_get_functiondef('public.voucher_atomic_response(uuid)'::regprocedure)
    into function_sql;
  function_sql := replace(function_sql,
    $$'id', item.id, 'item_id', item.item_id, 'qty', item.qty, 'rate', item.rate,$$,
    $$'id', item.id, 'item_id', item.item_id, 'qty', item.qty, 'rate', item.rate, 'amount', item.amount,$$);
  execute function_sql;
end;
$rewrite_atomic$;

commit;
notify pgrst, 'reload schema';
