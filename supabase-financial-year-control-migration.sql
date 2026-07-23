-- Canonical company financial-year setup and posting safeguards.
-- Existing companies are treated as configured; new companies must confirm
-- their Financial Year and books start date before the first transaction.
begin;

alter table public.companies
  add column if not exists fiscal_year_configured boolean not null default false;

-- Fiscal-year voucher numbering is mandatory for every company. Repair
-- existing opt-outs first, then enforce the rule for both inserts and updates.
alter table public.companies
  alter column reset_numbering_fiscal_year set default true;

update public.companies
set reset_numbering_fiscal_year = true
where not reset_numbering_fiscal_year;

alter table public.companies
  drop constraint if exists companies_fiscal_numbering_required;
alter table public.companies
  add constraint companies_fiscal_numbering_required
  check (reset_numbering_fiscal_year);

-- Companies that already posted transactions necessarily operated with their
-- stored start date, so preserve them as configured. Empty/new companies must
-- explicitly confirm the setup in Settings.
update public.companies company
set fiscal_year_configured = true
where not company.fiscal_year_configured
  and exists (
    select 1 from public.vouchers voucher
    where voucher.company_id = company.id
  );

create or replace function public.protect_company_financial_year()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.fiscal_year_configured and not new.fiscal_year_configured then
    raise exception 'Financial Year setup cannot be removed';
  end if;

  if new.fiscal_year_start is distinct from old.fiscal_year_start
    and exists (
      select 1 from public.vouchers voucher
      where voucher.company_id = old.id
      limit 1
    ) then
    raise exception 'Financial Year Start Date is locked after the first transaction';
  end if;

  return new;
end;
$$;

drop trigger if exists company_financial_year_guard on public.companies;
create trigger company_financial_year_guard
before update of fiscal_year_start, fiscal_year_configured on public.companies
for each row execute function public.protect_company_financial_year();

create or replace function public.validate_voucher_financial_year()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  company_start date;
  company_configured boolean;
begin
  select company.fiscal_year_start, company.fiscal_year_configured
    into company_start, company_configured
  from public.companies company
  where company.id = new.company_id;

  if not found then
    raise exception 'Voucher company does not exist';
  end if;
  if not company_configured then
    raise exception 'Complete Financial Year setup before posting transactions';
  end if;
  if coalesce(new.date_ad, new.date) < company_start then
    raise exception 'Voucher date cannot be before the company Financial Year Start Date %', company_start;
  end if;
  if coalesce(new.date_ad, new.date) > current_date then
    raise exception 'Voucher date cannot be in a future financial period';
  end if;

  return new;
end;
$$;

drop trigger if exists voucher_financial_year_guard on public.vouchers;
create trigger voucher_financial_year_guard
before insert or update of company_id, date, date_ad on public.vouchers
for each row execute function public.validate_voucher_financial_year();

commit;
notify pgrst, 'reload schema';
