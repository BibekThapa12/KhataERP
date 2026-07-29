-- Allow legacy invoice item quantities during portable restores and old-system imports.
-- Keep invalid conversion factors blocked. Frontend forms still validate normal voucher entry.
-- Apply after supabase-allow-negative-invoice-rates-migration.sql. Safe to rerun.
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
    'item.qty < 0 or coalesce(item.conversion_factor, 1) <= 0',
    'coalesce(item.conversion_factor, 1) <= 0'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require non-negative quantities and valid conversion factors',
    'Invoice items require valid conversion factors'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
      'coalesce(item.conversion_factor, 1) <= 0'
      in current_definition
    ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
