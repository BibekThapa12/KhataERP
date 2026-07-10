-- KhataERP Sales Return / Purchase Return migration
-- Run once in Supabase SQL Editor after the main schema or Masters migration.

alter table companies add column if not exists sales_return_prefix text not null default 'SR-';
alter table companies add column if not exists purchase_return_prefix text not null default 'PR-';

alter table vouchers add column if not exists original_voucher_id uuid references vouchers(id) on delete restrict;
alter table vouchers add column if not exists return_reason text;
alter table vouchers add column if not exists settlement_mode text;
alter table vouchers add column if not exists restock_items boolean;

alter table invoice_items add column if not exists source_invoice_item_id uuid references invoice_items(id) on delete restrict;
alter table invoice_items add column if not exists item_name text;
alter table invoice_items add column if not exists unit text;
alter table invoice_items add column if not exists discount_amount numeric(14,2);
alter table invoice_items add column if not exists taxable_amount numeric(14,2);
alter table invoice_items add column if not exists vat_amount numeric(14,2);
alter table invoice_items add column if not exists cost_rate numeric(14,2);

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'vouchers'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%type%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table vouchers drop constraint %I', constraint_name);
  end if;

  alter table vouchers add constraint vouchers_type_check
    check (type in ('Sales','Purchase','Sales Return','Purchase Return','Receipt','Payment','Journal','Stock Adjustment'));
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'vouchers'::regclass and conname = 'vouchers_settlement_mode_check'
  ) then
    alter table vouchers add constraint vouchers_settlement_mode_check
      check (settlement_mode is null or settlement_mode in ('party','cash','bank'));
  end if;
end $$;

create index if not exists idx_vouchers_original
  on vouchers(original_voucher_id) where original_voucher_id is not null;
create index if not exists idx_iitems_source
  on invoice_items(source_invoice_item_id) where source_invoice_item_id is not null;

notify pgrst, 'reload schema';
