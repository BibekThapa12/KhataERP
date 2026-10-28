-- Optional company identity block on printed Sales invoices. Safe to rerun.
begin;

alter table public.companies
  add column if not exists show_company_details_on_sales_invoice boolean not null default true;

comment on column public.companies.show_company_details_on_sales_invoice is
  'When false, printed Sales invoices omit the company logo and identity details.';

commit;
