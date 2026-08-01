-- Prevent concurrent session initialization from creating duplicate companies.
-- Run once in the Supabase SQL Editor. Safe to run repeatedly.
--
-- For each owner this keeps the company containing business activity, or the
-- most complete/oldest company when every duplicate is unused. It only deletes
-- duplicate companies with no vouchers, parties, items, or custom ledgers.
-- Older app versions marked four built-in expense ledgers as non-system, so
-- bootstrap identity (not only is_system) is used to distinguish them.
begin;

create or replace function pg_temp.is_khata_bootstrap_account(account_id text, company_id uuid)
returns boolean
language sql
immutable
as $$
  select account_id = any(array[
    company_id::text || ':cash',
    company_id::text || ':bank',
    company_id::text || ':inventory',
    company_id::text || ':vat_payable',
    company_id::text || ':vat_receivable',
    company_id::text || ':sales',
    company_id::text || ':purchase',
    company_id::text || ':sales_return',
    company_id::text || ':purchase_return',
    company_id::text || ':capital',
    company_id::text || ':retained_earnings',
    company_id::text || ':discount_allowed',
    company_id::text || ':rent',
    company_id::text || ':salary',
    company_id::text || ':electricity',
    'cash', 'bank', 'inventory', 'vat_payable', 'vat_receivable',
    'sales', 'purchase', 'sales_return', 'purchase_return', 'capital', 'retained_earnings',
    'discount_allowed', 'rent', 'salary', 'electricity'
  ]);
$$;

do $$
declare
  owner_record record;
  keeper_id uuid;
  duplicate_record record;
begin
  for owner_record in
    select user_id
    from public.companies
    group by user_id
    having count(*) > 1
  loop
    select company.id
      into keeper_id
    from public.companies company
    where company.user_id = owner_record.user_id
    order by
      (
        (select count(*) from public.vouchers voucher where voucher.company_id = company.id) +
        (select count(*) from public.parties party where party.company_id = company.id) +
        (select count(*) from public.items item where item.company_id = company.id) +
        (select count(*) from public.accounts account
          where account.company_id = company.id
            and not coalesce(account.is_system, false)
            and not pg_temp.is_khata_bootstrap_account(account.id, company.id))
      ) desc,
      ((company.name is not null and company.name <> '' and company.name <> 'My Trading Co.')::integer * 5 +
       (company.address is not null and company.address <> '')::integer * 2 +
       (company.pan_vat is not null and company.pan_vat <> '')::integer * 2 +
       (company.phone is not null and company.phone <> '')::integer * 2) desc,
      company.created_at asc,
      company.id asc
    limit 1;

    for duplicate_record in
      select company.id, company.name
      from public.companies company
      where company.user_id = owner_record.user_id
        and company.id <> keeper_id
    loop
      if exists (select 1 from public.vouchers where company_id = duplicate_record.id)
        or exists (select 1 from public.parties where company_id = duplicate_record.id)
        or exists (select 1 from public.items where company_id = duplicate_record.id)
        or exists (
          select 1
          from public.accounts account
          where account.company_id = duplicate_record.id
            and not coalesce(account.is_system, false)
            and not pg_temp.is_khata_bootstrap_account(account.id, duplicate_record.id)
        )
      then
        raise exception 'Cannot merge duplicate company % (%): it contains business data. Export or merge it manually before rerunning this migration.', duplicate_record.name, duplicate_record.id;
      end if;

      delete from public.companies where id = duplicate_record.id;
    end loop;
  end loop;
end;
$$;

create unique index if not exists companies_user_id_unique
  on public.companies(user_id);

commit;
notify pgrst, 'reload schema';
