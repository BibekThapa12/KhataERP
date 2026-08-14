-- Fix alternate-unit invoice integrity checks.
--
-- Khata ERP stores item stock in the main/base unit. Invoice entry quantities
-- can be in an alternate unit, so base_qty must be qty / conversion_factor.
-- Example: 1 cs = 6 pcs, selling 10 pcs stores base_qty = 10 / 6 cs.

begin;

alter table public.invoice_items add column if not exists entry_unit text;
alter table public.invoice_items add column if not exists conversion_factor numeric(18,6) not null default 1;
alter table public.invoice_items add column if not exists base_qty numeric(18,6);

update public.invoice_items
set base_qty = round(qty / nullif(coalesce(conversion_factor, 1), 0), 4),
    entry_unit = coalesce(entry_unit, unit)
where coalesce(conversion_factor, 1) > 0
  and (
    base_qty is null
    or abs(base_qty - qty / nullif(coalesce(conversion_factor, 1), 0)) > 0.0001
    or entry_unit is null
  );

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
    'abs(item.base_qty - item.qty * coalesce(item.conversion_factor, 1)) > 0.0001',
    'abs(item.base_qty - item.qty / nullif(coalesce(item.conversion_factor, 1), 0)) > 0.0001'
  );

  updated_definition := replace(
    updated_definition,
    'invoice_item.qty * coalesce(invoice_item.conversion_factor, 1)',
    'invoice_item.qty / nullif(coalesce(invoice_item.conversion_factor, 1), 0)'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
    'item.qty / nullif(coalesce(item.conversion_factor, 1), 0)'
    in current_definition
  ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
