-- Preserve portable backups created by the former two-decimal accounting
-- engine without rewriting historical totals or ledger balances. Regex-based
-- patching supports both the original and previously hotfixed function body.
do $$
declare
  original_definition text;
  function_definition text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into original_definition;
  function_definition := original_definition;

  function_definition := replace(
    function_definition,
    'if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6)) > 0.000001 then',
    'if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6)) > 0.005 then'
  );

  function_definition := regexp_replace(
    function_definition,
    $pattern$calculated_vat := round\(calculated_taxable \* coalesce\(voucher_record\.vat_rate, 0\) / 100, 6\);[[:space:]]+(if voucher_record\.original_voucher_id is null)$pattern$,
    $replacement$\1$replacement$
  );

  function_definition := replace(
    function_definition,
    'greatest(0.000002, item_count * 0.000001)',
    'greatest(0.000002, item_count * 0.005)'
  );

  if position('calculated_vat := coalesce(voucher_record.vat_amount, calculated_vat);' in function_definition) = 0 then
    function_definition := regexp_replace(
      function_definition,
      $pattern$calculated_vat := round\(calculated_taxable \* coalesce\(voucher_record\.vat_rate, 0\) / 100, 6\);[[:space:]]+else$pattern$,
      $replacement$calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6);
      if abs(coalesce(voucher_record.vat_amount, 0) - calculated_vat) > 0.005 then
        raise exception 'Invoice totals do not match server-calculated values';
      end if;
      calculated_vat := coalesce(voucher_record.vat_amount, calculated_vat);
    else$replacement$
    );
  end if;

  if function_definition = original_definition then
    if position('item_count * 0.005' in function_definition) = 0
      or position('coalesce(voucher_record.vat_amount, calculated_vat)' in function_definition) = 0 then
      raise exception 'Could not update legacy invoice rounding validation';
    end if;
    return;
  end if;

  if position('item_count * 0.005' in function_definition) = 0
    or position('coalesce(voucher_record.vat_amount, calculated_vat)' in function_definition) = 0 then
    raise exception 'Legacy invoice rounding validation update was incomplete';
  end if;

  execute function_definition;
end $$;
