-- Use Nepal's local calendar date for the voucher future-date safeguard.
begin;

create or replace function public.validate_voucher_financial_year()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  company_start date;
  company_configured boolean;
  nepal_today date := (clock_timestamp() at time zone 'Asia/Kathmandu')::date;
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
  if coalesce(new.date_ad, new.date) > nepal_today then
    raise exception 'Voucher date cannot be in a future financial period';
  end if;

  return new;
end;
$$;

commit;
notify pgrst, 'reload schema';
