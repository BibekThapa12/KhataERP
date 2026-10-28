-- Journal numbering preference and supplier physical invoice references.
-- Apply after supabase-atomic-voucher-posting-migration.sql.
-- Safe to run repeatedly.
begin;

alter table public.companies
  add column if not exists journal_numbering_mode text not null default 'auto';
alter table public.companies
  drop constraint if exists companies_journal_numbering_mode_check;
alter table public.companies
  add constraint companies_journal_numbering_mode_check
  check (journal_numbering_mode in ('auto', 'manual'));

alter table public.vouchers
  add column if not exists supplier_invoice_no text;
alter table public.vouchers
  drop constraint if exists vouchers_supplier_invoice_no_length_check;
alter table public.vouchers
  add constraint vouchers_supplier_invoice_no_length_check
  check (supplier_invoice_no is null or char_length(supplier_invoice_no) <= 100);

create or replace function public.save_voucher_with_document_metadata_atomic(
  p_voucher jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_stock_lines jsonb default '[]'::jsonb,
  p_invoice_items jsonb default '[]'::jsonb,
  p_settlements jsonb default '[]'::jsonb,
  p_voucher_id uuid default null,
  p_invoice_prefix text default null,
  p_reset_numbering boolean default false,
  p_period_start_key integer default null,
  p_next_period_start_key integer default null,
  p_audit_event_type text default null,
  p_audit_metadata jsonb default '{}'::jsonb,
  p_manual_invoice_no text default null,
  p_supplier_invoice_no text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
  saved_id uuid;
  saved_type text;
  saved_company_id uuid;
  journal_mode text;
  normalized_manual_number text := nullif(btrim(coalesce(p_manual_invoice_no, '')), '');
  normalized_supplier_number text := nullif(btrim(coalesce(p_supplier_invoice_no, '')), '');
  final_invoice_number text;
begin
  if normalized_manual_number is not null and char_length(normalized_manual_number) > 100 then
    raise exception 'Journal voucher number cannot exceed 100 characters';
  end if;
  if normalized_supplier_number is not null and char_length(normalized_supplier_number) > 100 then
    raise exception 'Supplier invoice number cannot exceed 100 characters';
  end if;

  result := public.save_voucher_atomic(
    p_voucher, p_lines, p_stock_lines, p_invoice_items, p_settlements,
    p_voucher_id, p_invoice_prefix, p_reset_numbering,
    p_period_start_key, p_next_period_start_key,
    p_audit_event_type, p_audit_metadata
  );

  saved_id := (result->>'id')::uuid;
  saved_type := result->>'type';
  saved_company_id := (result->>'company_id')::uuid;

  select company.journal_numbering_mode
    into journal_mode
  from public.companies company
  where company.id = saved_company_id;

  if saved_type = 'Journal' and coalesce(journal_mode, 'auto') = 'manual' then
    if normalized_manual_number is null then
      raise exception 'Enter the Journal voucher number';
    end if;
    update public.vouchers
    set invoice_no = normalized_manual_number
    where id = saved_id and company_id = saved_company_id;
  elsif saved_type <> 'Journal' and normalized_manual_number is not null then
    raise exception 'Manual voucher numbers are supported only for Journal vouchers';
  end if;

  if saved_type = 'Purchase' then
    update public.vouchers
    set supplier_invoice_no = normalized_supplier_number
    where id = saved_id and company_id = saved_company_id;
  elsif normalized_supplier_number is not null then
    raise exception 'Supplier invoice number is supported only for Purchase vouchers';
  end if;

  select voucher.invoice_no
    into final_invoice_number
  from public.vouchers voucher
  where voucher.id = saved_id and voucher.company_id = saved_company_id;

  return result || jsonb_build_object(
    'invoice_no', final_invoice_number,
    'supplier_invoice_no', case when saved_type = 'Purchase' then normalized_supplier_number else null end
  );
end;
$$;

revoke all on function public.save_voucher_with_document_metadata_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text) from public;
grant execute on function public.save_voucher_with_document_metadata_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text) to authenticated;

commit;
notify pgrst, 'reload schema';
