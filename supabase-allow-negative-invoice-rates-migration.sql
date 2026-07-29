-- Allow negative invoice item rates for portable restores and legacy imports.
-- Keep negative quantities and invalid conversion factors blocked.
-- Apply after supabase-allow-zero-invoice-quantities-migration.sql. Safe to rerun.
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
    'item.qty < 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0',
    'item.qty < 0 or coalesce(item.conversion_factor, 1) <= 0'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require non-negative quantities and non-negative rates',
    'Invoice items require non-negative quantities and valid conversion factors'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
      'item.qty < 0 or coalesce(item.conversion_factor, 1) <= 0'
      in current_definition
    ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
