-- Schedule expensive deferred voucher validators once per affected voucher and
-- transaction. The scheduled validator still runs at transaction end and sees
-- the complete final voucher, including direct PostgREST writes.
create or replace function public.schedule_validation_once(
  validation_key text,
  target_id uuid
)
returns boolean
language plpgsql
volatile
set search_path = public
as $$
declare
  setting_key text := 'khataerp.validation_' || regexp_replace(validation_key, '[^a-z0-9_]', '_', 'g');
  seen text := coalesce(current_setting(setting_key, true), '');
  marker text := ',' || target_id::text || ',';
begin
  if target_id is null or position(marker in ',' || seen || ',') > 0 then
    return false;
  end if;
  perform set_config(setting_key, concat_ws(',', nullif(seen, ''), target_id::text), true);
  return true;
end;
$$;

revoke all on function public.schedule_validation_once(text, uuid) from public;

drop trigger if exists voucher_financial_integrity_header on public.vouchers;
create constraint trigger voucher_financial_integrity_header
after insert or update on public.vouchers
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', new.id))
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_lines on public.voucher_lines;
drop trigger if exists voucher_financial_integrity_lines_write on public.voucher_lines;
drop trigger if exists voucher_financial_integrity_lines_delete on public.voucher_lines;
create constraint trigger voucher_financial_integrity_lines_write
after insert or update on public.voucher_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', new.voucher_id))
execute function public.validate_voucher_financial_integrity();
create constraint trigger voucher_financial_integrity_lines_delete
after delete on public.voucher_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', old.voucher_id))
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_items on public.invoice_items;
drop trigger if exists voucher_financial_integrity_items_write on public.invoice_items;
drop trigger if exists voucher_financial_integrity_items_delete on public.invoice_items;
create constraint trigger voucher_financial_integrity_items_write
after insert or update on public.invoice_items
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', new.voucher_id))
execute function public.validate_voucher_financial_integrity();
create constraint trigger voucher_financial_integrity_items_delete
after delete on public.invoice_items
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', old.voucher_id))
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_stock on public.stock_lines;
drop trigger if exists voucher_financial_integrity_stock_write on public.stock_lines;
drop trigger if exists voucher_financial_integrity_stock_delete on public.stock_lines;
create constraint trigger voucher_financial_integrity_stock_write
after insert or update on public.stock_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', new.voucher_id))
execute function public.validate_voucher_financial_integrity();
create constraint trigger voucher_financial_integrity_stock_delete
after delete on public.stock_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', old.voucher_id))
execute function public.validate_voucher_financial_integrity();

create index if not exists vouchers_company_status_date_sequence_idx
  on public.vouchers (company_id, status, date_bs_key desc, seq desc, id desc);
create index if not exists vouchers_company_type_date_sequence_idx
  on public.vouchers (company_id, type, date_bs_key desc, seq desc, id desc);
create index if not exists voucher_lines_voucher_account_idx
  on public.voucher_lines (voucher_id, account_id);
create index if not exists invoice_items_voucher_item_idx
  on public.invoice_items (voucher_id, item_id);
create index if not exists invoice_items_source_voucher_idx
  on public.invoice_items (source_invoice_item_id, voucher_id)
  where source_invoice_item_id is not null;
create index if not exists stock_lines_voucher_item_direction_idx
  on public.stock_lines (voucher_id, item_id, direction);
create index if not exists settlements_company_vouchers_idx
  on public.voucher_settlements (company_id, invoice_voucher_id, settlement_voucher_id);
create index if not exists company_members_user_status_company_idx
  on public.company_members (user_id, status, company_id);
create index if not exists cheques_linked_voucher_idx
  on public.cheques (linked_voucher_id)
  where linked_voucher_id is not null;
