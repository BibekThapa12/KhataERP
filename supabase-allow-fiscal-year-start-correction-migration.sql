-- Allow safe correction of company Financial Year Start Date after import.
-- The date may move earlier after transactions exist only when every existing
-- voucher remains on or after the new books start. Moving it later is still blocked.
begin;

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
    if new.fiscal_year_start > old.fiscal_year_start then
      raise exception 'Financial Year Start Date is locked after the first transaction';
    end if;

    if exists (
      select 1 from public.vouchers voucher
      where voucher.company_id = old.id
        and coalesce(voucher.date_ad, voucher.date) < new.fiscal_year_start
      limit 1
    ) then
      raise exception 'Financial Year Start Date cannot be after existing transactions';
    end if;
  end if;

  return new;
end;
$$;

commit;
notify pgrst, 'reload schema';
