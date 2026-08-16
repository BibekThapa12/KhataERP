-- Allow portable restoration of returns posted by the former two-decimal
-- engine without rewriting their historical VAT, totals, or ledger balances.
do $$
declare
  function_definition text;
  legacy_block text := $legacy$
      if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6)) > 0.000001 then
        raise exception 'Return VAT does not match server-calculated VAT';
      end if;
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6);$legacy$;
  compatible_block text := $compatible$
      -- Preserve portable backups from the former two-decimal accounting
      -- engine. A half-paisa tolerance accepts only ordinary currency
      -- rounding; current six-decimal entries still match exactly.
      if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6)) > 0.005 then
        raise exception 'Return VAT does not match server-calculated VAT';
      end if;$compatible$;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into function_definition;

  if position(legacy_block in function_definition) = 0 then
    if position('> 0.005 then' in function_definition) > 0 then
      return;
    end if;
    raise exception 'Could not locate the return VAT validation block';
  end if;

  execute replace(function_definition, legacy_block, compatible_block);
end $$;
