-- Apply after the category hierarchy, Sundry parties, and multiple-bank migrations.
-- Seeds and protects KhataERP's canonical account-group hierarchy.
begin;

drop trigger if exists account_category_system_guard on public.account_categories;

create or replace function public.ensure_system_account_groups(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, root.name, root.account_type, null, true, false
  from (values
    ('Assets', 'Asset'),
    ('Liabilities', 'Liability'),
    ('Equity', 'Equity'),
    ('Incomes', 'Income'),
    ('Expenses', 'Expense')
  ) root(name, account_type)
  on conflict (company_id, name, account_type) do update
  set parent_category_id = null, is_system = true, is_archived = false;

  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, child.name, child.account_type, parent.id, true, false
  from (values
    ('Capital Account', 'Equity', 'Equity'),
    ('Current Assets', 'Asset', 'Assets'),
    ('Fixed Assets', 'Asset', 'Assets'),
    ('Investments', 'Asset', 'Assets'),
    ('Current Liabilities', 'Liability', 'Liabilities'),
    ('Loans (Liability)', 'Liability', 'Liabilities'),
    ('Suspense A/c', 'Liability', 'Liabilities'),
    ('Direct Expenses', 'Expense', 'Expenses'),
    ('Indirect Expenses', 'Expense', 'Expenses'),
    ('Purchase Accounts', 'Expense', 'Expenses'),
    ('Direct Incomes', 'Income', 'Incomes'),
    ('Indirect Incomes', 'Income', 'Incomes'),
    ('Sales Accounts', 'Income', 'Incomes')
  ) child(name, account_type, parent_name)
  join public.account_categories parent
    on parent.company_id = target_company_id
   and parent.name = child.parent_name
   and parent.account_type = child.account_type
  on conflict (company_id, name, account_type) do update
  set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;

  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, child.name, child.account_type, parent.id, true, false
  from (values
    ('Reserves & Surplus', 'Equity', 'Capital Account'),
    ('Bank Accounts', 'Asset', 'Current Assets'),
    ('Cash-in-Hand', 'Asset', 'Current Assets'),
    ('Deposits (Asset)', 'Asset', 'Current Assets'),
    ('Loans & Advances (Asset)', 'Asset', 'Current Assets'),
    ('Sundry Debtors', 'Asset', 'Current Assets'),
    ('Duties & Taxes', 'Liability', 'Current Liabilities'),
    ('Provisions', 'Liability', 'Current Liabilities'),
    ('Sundry Creditors', 'Liability', 'Current Liabilities'),
    ('Bank OD A/c', 'Liability', 'Loans (Liability)'),
    ('Secured Loans', 'Liability', 'Loans (Liability)'),
    ('Unsecured Loans', 'Liability', 'Loans (Liability)')
  ) child(name, account_type, parent_name)
  join public.account_categories parent
    on parent.company_id = target_company_id
   and parent.name = child.parent_name
   and parent.account_type = child.account_type
  on conflict (company_id, name, account_type) do update
  set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;
end;
$$;

-- Prefer renaming a sole legacy node so its identifier and assignments survive.
update public.account_categories legacy
set name = 'Incomes'
where legacy.name = 'Income' and legacy.account_type = 'Income'
  and not exists (
    select 1 from public.account_categories target
    where target.company_id = legacy.company_id and target.name = 'Incomes' and target.account_type = 'Income'
  );

update public.account_categories legacy
set name = 'Bank Accounts'
where legacy.name = 'Bank' and legacy.account_type = 'Asset'
  and not exists (
    select 1 from public.account_categories target
    where target.company_id = legacy.company_id and target.name = 'Bank Accounts' and target.account_type = 'Asset'
  );

update public.account_categories legacy
set name = 'Duties & Taxes'
where legacy.name = 'Duties & Taxes (Liabilities)' and legacy.account_type = 'Liability'
  and not exists (
    select 1 from public.account_categories target
    where target.company_id = legacy.company_id and target.name = 'Duties & Taxes' and target.account_type = 'Liability'
  );

do $$
declare
  company_record record;
begin
  for company_record in select id from public.companies loop
    perform public.ensure_system_account_groups(company_record.id);
  end loop;
end;
$$;

-- Merge any remaining legacy nodes when both the legacy and canonical names existed.
update public.accounts account
set category_id = target.id, "group" = target.name
from public.account_categories legacy
join public.account_categories target
  on target.company_id = legacy.company_id and target.name = 'Incomes' and target.account_type = 'Income'
where legacy.name = 'Income' and legacy.account_type = 'Income'
  and account.category_id = legacy.id;

update public.account_categories child
set parent_category_id = target.id
from public.account_categories legacy
join public.account_categories target
  on target.company_id = legacy.company_id and target.name = 'Incomes' and target.account_type = 'Income'
where legacy.name = 'Income' and legacy.account_type = 'Income'
  and child.parent_category_id = legacy.id;

update public.accounts account
set category_id = target.id, "group" = target.name
from public.account_categories legacy
join public.account_categories target
  on target.company_id = legacy.company_id and target.name = 'Bank Accounts' and target.account_type = 'Asset'
where legacy.name = 'Bank' and legacy.account_type = 'Asset'
  and account.category_id = legacy.id;

update public.accounts account
set category_id = target.id, "group" = target.name
from public.account_categories legacy
join public.account_categories target
  on target.company_id = legacy.company_id and target.name = 'Duties & Taxes' and target.account_type = 'Liability'
where legacy.name = 'Duties & Taxes (Liabilities)' and legacy.account_type = 'Liability'
  and account.category_id = legacy.id;

-- Place the built-in ledgers in their canonical groups without changing IDs or vouchers.
update public.accounts account
set category_id = target.id, "group" = target.name
from public.account_categories target
where target.company_id = account.company_id
  and target.name = 'Cash-in-Hand' and target.account_type = 'Asset'
  and (account.id = account.company_id::text || ':cash' or (account.id = 'cash' and account.is_system));

update public.accounts account
set category_id = target.id, "group" = target.name
from public.account_categories target
where target.company_id = account.company_id
  and target.name = 'Bank Accounts' and target.account_type = 'Asset'
  and (account.id = account.company_id::text || ':bank' or (account.id = 'bank' and account.is_system));

update public.accounts account
set category_id = target.id,
    "group" = target.name,
    type = 'Liability',
    opening_balance = case when account.type = 'Liability' then account.opening_balance else -account.opening_balance end
from public.account_categories target
where target.company_id = account.company_id
  and target.name = 'Duties & Taxes' and target.account_type = 'Liability'
  and (account.id = account.company_id::text || ':vat_receivable' or (account.id = 'vat_receivable' and account.is_system));

update public.accounts account
set category_id = target.id, "group" = target.name, type = 'Liability'
from public.account_categories target
where target.company_id = account.company_id
  and target.name = 'Duties & Taxes' and target.account_type = 'Liability'
  and (account.id = account.company_id::text || ':vat_payable' or (account.id = 'vat_payable' and account.is_system));

-- Keep the denormalized group label aligned with every assigned category.
update public.accounts account
set "group" = category.name
from public.account_categories category
where category.id = account.category_id
  and account."group" is distinct from category.name;

update public.account_categories legacy
set is_system = false, is_archived = true
where ((legacy.name = 'Income' and legacy.account_type = 'Income')
    or (legacy.name = 'Bank' and legacy.account_type = 'Asset')
    or (legacy.name = 'Duties & Taxes (Liabilities)' and legacy.account_type = 'Liability'))
  and not exists (select 1 from public.accounts account where account.category_id = legacy.id)
  and not exists (select 1 from public.account_categories child where child.parent_category_id = legacy.id);

create or replace function public.protect_system_account_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system and exists (select 1 from public.companies company where company.id = old.company_id) then
      raise exception 'System account groups cannot be deleted';
    end if;
    return old;
  end if;

  if old.is_system and (
    new.company_id is distinct from old.company_id
    or new.name is distinct from old.name
    or new.account_type is distinct from old.account_type
    or new.parent_category_id is distinct from old.parent_category_id
    or new.is_archived is distinct from old.is_archived
    or new.is_system is distinct from old.is_system
  ) then
    raise exception 'System account groups cannot be changed';
  end if;
  return new;
end;
$$;

create trigger account_category_system_guard
before update or delete on public.account_categories
for each row execute function public.protect_system_account_category();

create or replace function public.seed_system_account_groups_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_system_account_groups(new.id);
  return new;
end;
$$;

drop trigger if exists company_system_account_groups_seed on public.companies;
create trigger company_system_account_groups_seed
after insert on public.companies
for each row execute function public.seed_system_account_groups_for_company();

commit;
notify pgrst, 'reload schema';
