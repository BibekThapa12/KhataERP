-- Main/alternative unit support. Apply after the base schema.
begin;

alter table public.items add column if not exists alternate_unit text;
alter table public.items add column if not exists alternate_conversion numeric(14,4);

alter table public.items drop constraint if exists items_alternate_unit_check;
alter table public.items add constraint items_alternate_unit_check check (
  (alternate_unit is null and alternate_conversion is null)
  or (
    length(trim(alternate_unit)) > 0
    and lower(trim(alternate_unit)) <> lower(trim(unit))
    and alternate_conversion > 1
  )
);

alter table public.invoice_items add column if not exists entry_unit text;
alter table public.invoice_items add column if not exists conversion_factor numeric(14,4) not null default 1;
alter table public.invoice_items add column if not exists base_qty numeric(14,4);

update public.invoice_items
set entry_unit = coalesce(entry_unit, unit),
    conversion_factor = coalesce(conversion_factor, 1),
    base_qty = coalesce(base_qty, qty * coalesce(conversion_factor, 1))
where entry_unit is null or base_qty is null;

alter table public.invoice_items drop constraint if exists invoice_items_conversion_factor_check;
alter table public.invoice_items add constraint invoice_items_conversion_factor_check check (conversion_factor >= 1);

commit;
