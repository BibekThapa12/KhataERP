-- Final invoice integrity compatibility fix for portable restores.
-- Allows legacy negative/zero invoice quantities and rates, and ignores old base_qty snapshots.
-- Still blocks invalid conversion factors. Safe to rerun.
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

  updated_definition := current_definition;

  updated_definition := regexp_replace(
    updated_definition,
    '\s*or\s*\(\s*item\.base_qty\s+is\s+not\s+null\s+and\s+abs\s*\(\s*item\.base_qty\s*-\s*item\.qty\s*/\s*nullif\s*\(\s*coalesce\s*\(\s*item\.conversion_factor\s*,\s*1\s*\)\s*,\s*0\s*\)\s*\)\s*>\s*0\.0001\s*\)',
    '',
    'gi'
  );

  updated_definition := regexp_replace(
    updated_definition,
    'item\.qty\s*<\s*0\s+or\s+item\.rate\s*<\s*0\s+or\s+coalesce\s*\(\s*item\.conversion_factor\s*,\s*1\s*\)\s*<=\s*0',
    'coalesce(item.conversion_factor, 1) <= 0',
    'gi'
  );

  updated_definition := regexp_replace(
    updated_definition,
    'item\.qty\s*<\s*0\s+or\s+coalesce\s*\(\s*item\.conversion_factor\s*,\s*1\s*\)\s*<=\s*0',
    'coalesce(item.conversion_factor, 1) <= 0',
    'gi'
  );

  updated_definition := regexp_replace(
    updated_definition,
    'item\.rate\s*<\s*0\s+or\s+coalesce\s*\(\s*item\.conversion_factor\s*,\s*1\s*\)\s*<=\s*0',
    'coalesce(item.conversion_factor, 1) <= 0',
    'gi'
  );

  updated_definition := replace(
    updated_definition,
    'Invoice items require non-negative quantities and non-negative rates',
    'Invoice items require valid conversion factors'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require non-negative quantities and valid conversion factors',
    'Invoice items require valid conversion factors'
  );

  execute updated_definition;

  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into current_definition;

  if position('item.base_qty is not null and abs(item.base_qty' in current_definition) > 0
    or position('item.qty < 0' in current_definition) > 0
    or position('item.rate < 0' in current_definition) > 0 then
    raise exception 'Invoice restore compatibility patch did not fully apply';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
