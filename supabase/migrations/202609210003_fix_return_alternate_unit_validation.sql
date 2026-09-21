-- Allow linked Sales and Purchase Returns to use a different valid entry unit.
--
-- Return rates are editable snapshots and entry-unit rates legitimately change
-- when the user switches between an item's main and alternate units. Source
-- validation must therefore protect the source line/item identity, while the
-- quantity ceiling is enforced using normalized base quantities.
begin;

do $migration$
declare
  original_definition text;
  patched_definition text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into original_definition;

  if original_definition is null then
    raise exception 'validate_voucher_financial_integrity() is missing; apply the integrity migrations first';
  end if;

  -- Replace the two complete validation statements by their stable exception
  -- messages. Earlier releases changed whitespace, numeric precision, and the
  -- GROUP BY list, so patching fragments of those queries is too brittle.
  patched_definition := regexp_replace(
    original_definition,
    $pattern$if[[:space:]]+exists[[:space:]]*\([^;]*\)[[:space:]]*then[[:space:]]*raise[[:space:]]+exception[[:space:]]+'Returned item does not match its source invoice';[[:space:]]*end[[:space:]]+if;$pattern$,
    $replacement$if exists (
      select 1
      from public.invoice_items returned
      left join public.invoice_items source
        on source.id = returned.source_invoice_item_id
       and source.voucher_id = voucher_record.original_voucher_id
      where returned.voucher_id = target_voucher_id
        and (source.id is null or source.item_id is distinct from returned.item_id)
    ) then raise exception 'Returned item does not match its source invoice'; end if;$replacement$,
    'g'
  );

  patched_definition := regexp_replace(
    patched_definition,
    $pattern$if[[:space:]]+exists[[:space:]]*\([^;]*\)[[:space:]]*then[[:space:]]*raise[[:space:]]+exception[[:space:]]+'Return quantity exceeds the source invoice quantity';[[:space:]]*end[[:space:]]+if;$pattern$,
    $replacement$if exists (
      select 1
      from public.invoice_items source
      join public.invoice_items returned on returned.source_invoice_item_id = source.id
      join public.vouchers return_voucher on return_voucher.id = returned.voucher_id
      where source.voucher_id = voucher_record.original_voucher_id
        and not return_voucher.cancelled
      group by source.id
      having sum(coalesce(
        returned.base_qty,
        returned.qty / nullif(coalesce(returned.conversion_factor, 1), 0)
      )) > max(coalesce(
        source.base_qty,
        source.qty / nullif(coalesce(source.conversion_factor, 1), 0)
      )) + 0.0001
    ) then raise exception 'Return quantity exceeds the source invoice quantity'; end if;$replacement$,
    'g'
  );

  if patched_definition = original_definition
    and (patched_definition ~ 'source\.rate[^;]*returned\.rate'
      or position('returned.base_qty' in patched_definition) = 0
      or position('source.base_qty' in patched_definition) = 0) then
    raise exception 'Could not locate the deployed return validation statements';
  end if;
  if patched_definition ~ 'source\.rate[^;]*returned\.rate' then
    raise exception 'Could not remove entry-unit rate equality from return validation';
  end if;
  if position('sum(coalesce(' in patched_definition) = 0
    or position('returned.base_qty' in patched_definition) = 0
    or position('source.base_qty' in patched_definition) = 0 then
    raise exception 'Could not replace raw return quantity validation with base-quantity validation';
  end if;

  if patched_definition is distinct from original_definition then
    execute patched_definition;
  end if;
end;
$migration$;

do $verification$
declare function_definition text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into function_definition;

  if function_definition ~ 'source\.rate[^;]*returned\.rate'
    or position('returned.base_qty' in function_definition) = 0
    or position('source.base_qty' in function_definition) = 0 then
    raise exception 'Alternate-unit return validation fix was not installed completely';
  end if;
end;
$verification$;

notify pgrst, 'reload schema';
commit;
