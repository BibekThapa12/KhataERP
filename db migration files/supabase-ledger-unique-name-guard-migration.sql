-- Prevent duplicate ledger/account names inside the same company.
-- Existing duplicate historical rows are left untouched, but new inserts and
-- renames to an existing ledger name are blocked case-insensitively.
begin;

create or replace function public.prevent_duplicate_ledger_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);

  if new.name = '' then
    raise exception 'Enter a ledger name';
  end if;

  if exists (
    select 1
    from public.accounts account
    where account.company_id = new.company_id
      and lower(btrim(account.name)) = lower(new.name)
      and account.id is distinct from new.id
    limit 1
  ) then
    raise exception 'Ledger already exist';
  end if;

  return new;
end;
$$;

drop trigger if exists accounts_duplicate_name_guard on public.accounts;
create trigger accounts_duplicate_name_guard
before insert or update of company_id, name on public.accounts
for each row execute function public.prevent_duplicate_ledger_name();

commit;
notify pgrst, 'reload schema';
