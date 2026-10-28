-- Relax legacy invoice base quantity validation for portable restores.
-- Keep conversion_factor validation, but do not reject old base_qty snapshots.
-- Apply after supabase-allow-negative-invoice-quantities-migration.sql. Safe to rerun.
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
    'coalesce(item.conversion_factor, 1) <= 0
          or (item.base_qty is not null and abs(item.base_qty - item.qty / nullif(coalesce(item.conversion_factor, 1), 0)) > 0.0001)',
    'coalesce(item.conversion_factor, 1) <= 0'
  );

  updated_definition := replace(
    updated_definition,
    'coalesce(item.conversion_factor, 1) <= 0
          or (item.base_qty is not null and abs(item.base_qty - item.qty / nullif(coalesce(item.conversion_factor, 1), 0)) > 0.0001)',
    'coalesce(item.conversion_factor, 1) <= 0'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position('item.base_qty is not null and abs(item.base_qty' in current_definition) > 0 then
    raise exception 'Could not patch validate_voucher_financial_integrity(); expected base_qty validation block not found';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
