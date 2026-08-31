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
alter table invoice_items add column if not exists discount_amount numeric(18,6);
alter table invoice_items add column if not exists taxable_amount numeric(18,6);
alter table invoice_items add column if not exists vat_amount numeric(18,6);
alter table invoice_items add column if not exists cost_rate numeric(18,6);

-- Replace this exact constraint deterministically. The former definition
-- searched for any CHECK containing "type", which could drop another check
-- and then collide with an existing vouchers_type_check after a partial run.
alter table public.vouchers drop constraint if exists vouchers_type_check;
alter table public.vouchers add constraint vouchers_type_check
  check (type in ('Sales','Purchase','Sales Return','Purchase Return','Receipt','Payment','Journal','Stock Adjustment'));

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
