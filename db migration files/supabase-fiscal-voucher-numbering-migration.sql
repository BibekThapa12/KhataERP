-- Apply after supabase-integrity-migration.sql.
-- Allows the same voucher number to be reused in different fiscal years while
-- preserving uniqueness within each company, voucher type, and numbering period.
begin;

alter table public.vouchers
  add column if not exists numbering_period text not null default 'all';

update public.vouchers
set numbering_period = 'all'
where numbering_period is null or btrim(numbering_period) = '';

drop index if exists public.vouchers_company_type_invoice_no_unique;

create unique index if not exists vouchers_company_type_period_invoice_no_unique
  on public.vouchers (company_id, type, numbering_period, invoice_no)
  where invoice_no is not null;

commit;
notify pgrst, 'reload schema';
