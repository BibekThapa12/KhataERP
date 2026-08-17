-- Allow portable restoration of returns posted by the former two-decimal
-- engine without rewriting their historical VAT, totals, or ledger balances.
do $$
declare
  function_definition text;
  changed boolean := false;
  legacy_vat_block text := $legacy$
      if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6)) > 0.000001 then
        raise exception 'Return VAT does not match server-calculated VAT';
      end if;
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6);$legacy$;
  compatible_vat_block text := $compatible$
      -- Preserve portable backups from the former two-decimal accounting
      -- engine. A half-paisa tolerance accepts only ordinary currency
      -- rounding; current six-decimal entries still match exactly.
      if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6)) > 0.005 then
        raise exception 'Return VAT does not match server-calculated VAT';
      end if;$compatible$;
  legacy_discount_block text := $legacy_discount$
    if abs(calculated_discount - expected_discount) > greatest(0.000002, item_count * 0.000001) then
      raise exception 'Return discount does not match the source invoice allocation';
    end if;$legacy_discount$;
  compatible_discount_block text := $compatible_discount$
    -- Legacy returns allocated and rounded discount per line to two decimals.
    -- Bound compatibility by half a paisa for each returned line.
    if abs(calculated_discount - expected_discount) > greatest(0.000002, item_count * 0.005) then
      raise exception 'Return discount does not match the source invoice allocation';
    end if;$compatible_discount$;
  legacy_invoice_vat_block text := $legacy_invoice_vat$
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6);
    else$legacy_invoice_vat$;
  compatible_invoice_vat_block text := $compatible_invoice_vat$
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6);
      -- Preserve Sales/Purchase vouchers posted by the former two-decimal
      -- engine when their stored VAT is ordinary half-paisa rounding.
      if abs(coalesce(voucher_record.vat_amount, 0) - calculated_vat) > 0.005 then
        raise exception 'Invoice totals do not match server-calculated values';
      end if;
      calculated_vat := coalesce(voucher_record.vat_amount, calculated_vat);
    else$compatible_invoice_vat$;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into function_definition;

  if position(legacy_vat_block in function_definition) > 0 then
    function_definition := replace(function_definition, legacy_vat_block, compatible_vat_block);
    changed := true;
  elsif position(compatible_vat_block in function_definition) = 0 then
    raise exception 'Could not locate the return VAT validation block';
  end if;

  if position(legacy_discount_block in function_definition) > 0 then
    function_definition := replace(function_definition, legacy_discount_block, compatible_discount_block);
    changed := true;
  elsif position(compatible_discount_block in function_definition) = 0 then
    raise exception 'Could not locate the return discount validation block';
  end if;

  if position(legacy_invoice_vat_block in function_definition) > 0 then
    function_definition := replace(function_definition, legacy_invoice_vat_block, compatible_invoice_vat_block);
    changed := true;
  elsif position(compatible_invoice_vat_block in function_definition) = 0 then
    raise exception 'Could not locate the invoice VAT validation block';
  end if;

  if changed then execute function_definition; end if;
end $$;
