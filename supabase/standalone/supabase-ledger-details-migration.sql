-- Optional ledger details used by the conditional Ledger Creation form.
-- Safe to run repeatedly.
begin;

alter table public.accounts add column if not exists address text;
alter table public.accounts add column if not exists contact_no text;
alter table public.accounts add column if not exists pan_no text;
alter table public.accounts add column if not exists credit_days integer;
alter table public.accounts add column if not exists bank_account_no text;
alter table public.accounts add column if not exists bank_branch text;

-- Preserve the existing party master as the source of truth while making its
-- details available to the unified ledger form.
update public.accounts account
set address = coalesce(account.address, party.address),
    contact_no = coalesce(account.contact_no, party.phone),
    pan_no = coalesce(account.pan_no, party.pan_vat),
    credit_days = coalesce(account.credit_days, party.default_credit_days)
from public.parties party
where party.account_id = account.id
  and party.company_id = account.company_id;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.accounts'::regclass and conname = 'accounts_ledger_details_lengths') then
    alter table public.accounts add constraint accounts_ledger_details_lengths check (
      length(coalesce(address, '')) <= 1000
      and length(coalesce(contact_no, '')) <= 50
      and length(coalesce(pan_no, '')) <= 100
      and length(coalesce(bank_account_no, '')) <= 100
      and length(coalesce(bank_branch, '')) <= 200
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.accounts'::regclass and conname = 'accounts_credit_days_range') then
    alter table public.accounts add constraint accounts_credit_days_range check (credit_days is null or credit_days between 0 and 36500);
  end if;
end;
$$;

commit;
notify pgrst, 'reload schema';
