-- Party default credit terms and invoice-specific due-date snapshots.
-- Apply after supabase-schema.sql. Safe to run more than once.
begin;

alter table public.parties
  add column if not exists default_credit_days integer not null default 0;

alter table public.vouchers
  add column if not exists credit_days integer,
  add column if not exists due_date_ad date,
  add column if not exists due_date_bs text,
  add column if not exists due_date_bs_key integer;

update public.parties
set default_credit_days = 0
where default_credit_days is null or default_credit_days < 0;

update public.vouchers
set credit_days = coalesce(credit_days, 0),
    due_date_ad = coalesce(due_date_ad, date_ad, date),
    due_date_bs = coalesce(due_date_bs, date_bs),
    due_date_bs_key = coalesce(due_date_bs_key, date_bs_key)
where type in ('Sales', 'Purchase')
  and (credit_days is null or due_date_ad is null or due_date_bs is null or due_date_bs_key is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parties_default_credit_days_nonnegative') then
    alter table public.parties add constraint parties_default_credit_days_nonnegative check (default_credit_days >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vouchers_credit_days_nonnegative') then
    alter table public.vouchers add constraint vouchers_credit_days_nonnegative check (credit_days is null or credit_days >= 0);
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
