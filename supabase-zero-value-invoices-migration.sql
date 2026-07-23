-- Allow zero-value Sales, Purchase, Sales Return, and Purchase Return
-- documents while keeping item and positive-quantity validation compulsory.
-- Apply after supabase-critical-security-hardening-migration.sql.
-- Safe to run repeatedly.
begin;

do $migration$
declare
  current_definition text;
  updated_definition text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into current_definition;

  if current_definition is null then
    raise exception 'validate_voucher_financial_integrity() is missing; apply the critical security hardening migration first';
  end if;

  updated_definition := replace(
    current_definition,
    'voucher_record.type in (''Receipt'',''Payment'',''Journal'',''Sales Return'',''Purchase Return'')',
    'voucher_record.type in (''Receipt'',''Payment'',''Journal'')'
  );
  updated_definition := replace(
    updated_definition,
    'item.qty <= 0 or item.rate <= 0 or coalesce(item.conversion_factor, 1) <= 0',
    'item.qty <= 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require positive quantities and valid rates',
    'Invoice items require positive quantities and non-negative rates'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
      'voucher_record.type in (''Receipt'',''Payment'',''Journal'')'
      in current_definition
    ) = 0 or position(
      'item.qty <= 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0'
      in current_definition
    ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
