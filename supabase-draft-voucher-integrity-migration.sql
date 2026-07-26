-- Let Draft vouchers save incomplete headers without ledger/invoice/stock rows.
-- Apply after supabase-critical-security-hardening-migration.sql and
-- supabase-draft-vouchers-migration.sql. Safe to rerun.
begin;

do $$
declare
  function_sql text;
  new_block text;
  patched_sql text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into function_sql;

  new_block := $block$
  if length(coalesce(voucher_record.narration, '')) > 4000
    or length(coalesce(voucher_record.return_reason, '')) > 2000
    or length(coalesce(voucher_record.invoice_no, '')) > 100 then
    raise exception 'Voucher text exceeds the allowed length';
  end if;

  if coalesce(voucher_record.status, 'Completed') = 'Draft' then
    return null;
  end if;

  if voucher_record.type <> 'Stock Adjustment' then
    if line_count < 2 then raise exception 'Posted vouchers require at least two ledger lines'; end if;
$block$;

  if function_sql is null then
    raise exception 'validate_voucher_financial_integrity() is missing';
  end if;

  if position('coalesce(voucher_record.status, ''Completed'') = ''Draft''' in function_sql) = 0 then
    patched_sql := regexp_replace(
      function_sql,
      E'\\n\\s*if voucher_record\\.type <> ''Stock Adjustment'' then\\s*\\n\\s*if line_count < 2 then raise exception ''Posted vouchers require at least two ledger lines''; end if;',
      E'\n' || new_block,
      'm'
    );
    if patched_sql = function_sql then
      raise exception 'Could not patch validate_voucher_financial_integrity(); expected block not found';
    end if;
    execute patched_sql;
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
