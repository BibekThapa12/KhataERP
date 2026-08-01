-- Apply after supabase-category-hierarchy-migration.sql.
-- Standardizes every party ledger under Sundry Debtors or Sundry Creditors.
begin;

insert into public.account_categories (company_id, name, account_type, is_system, is_archived)
select c.id, r.name, r.account_type, false, false
from public.companies c
cross join (values ('Assets', 'Asset'), ('Liabilities', 'Liability')) r(name, account_type)
on conflict (company_id, name, account_type) do update set is_archived = false;

insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
select c.id, n.name, n.account_type, root.id, false, false
from public.companies c
cross join (values ('Current Assets', 'Asset', 'Assets'), ('Current Liabilities', 'Liability', 'Liabilities')) n(name, account_type, root_name)
join public.account_categories root on root.company_id = c.id and root.name = n.root_name and root.account_type = n.account_type
on conflict (company_id, name, account_type) do update
set parent_category_id = excluded.parent_category_id, is_archived = false;

insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
select c.id, n.name, n.account_type, parent.id, true, false
from public.companies c
cross join (values ('Sundry Debtors', 'Asset', 'Current Assets'), ('Sundry Creditors', 'Liability', 'Current Liabilities')) n(name, account_type, parent_name)
join public.account_categories parent on parent.company_id = c.id and parent.name = n.parent_name and parent.account_type = n.account_type
on conflict (company_id, name, account_type) do update
set parent_category_id = excluded.parent_category_id, is_archived = false;

do $$
begin
  if exists (
    select 1
    from public.accounts a
    join public.account_categories old_category on old_category.id = a.category_id
    where lower(btrim(old_category.name)) in ('customer', 'customers', 'supplier', 'suppliers')
      and not exists (select 1 from public.parties p where p.account_id = a.id)
      and ((lower(btrim(old_category.name)) in ('customer', 'customers') and a.type <> 'Asset')
        or (lower(btrim(old_category.name)) in ('supplier', 'suppliers') and a.type <> 'Liability'))
  ) then
    raise exception 'Legacy Customer/Supplier categories contain non-party ledgers with incompatible account types. Correct those ledgers before rerunning this migration.';
  end if;
end $$;

update public.accounts a
set category_id = target.id,
    "group" = target.name,
    type = target.account_type,
    is_party = true
from public.parties p
join public.account_categories target
  on target.company_id = p.company_id
 and target.name = case p.type when 'customer' then 'Sundry Debtors' else 'Sundry Creditors' end
 and target.account_type = case p.type when 'customer' then 'Asset' else 'Liability' end
where p.account_id = a.id
  and a.company_id = p.company_id;

update public.accounts a
set category_id = target.id,
    "group" = target.name
from public.account_categories old_category
join public.account_categories target
  on target.company_id = old_category.company_id
 and target.name = case when lower(btrim(old_category.name)) in ('customer', 'customers') then 'Sundry Debtors' else 'Sundry Creditors' end
 and target.account_type = case when lower(btrim(old_category.name)) in ('customer', 'customers') then 'Asset' else 'Liability' end
where a.category_id = old_category.id
  and lower(btrim(old_category.name)) in ('customer', 'customers', 'supplier', 'suppliers');

-- Earlier application versions could create more than one party row for the
-- same ledger. Party IDs are not referenced by vouchers; account_id is the
-- authoritative link, so retain the oldest row before enforcing uniqueness.
delete from public.parties duplicate
using (
  select id,
         row_number() over (partition by account_id order by created_at nulls last, id) as duplicate_number
  from public.parties
) ranked
where duplicate.id = ranked.id
  and ranked.duplicate_number > 1;

create unique index if not exists parties_account_id_unique on public.parties(account_id);

insert into public.parties (company_id, name, type, account_id, is_archived)
select a.company_id,
       a.name,
       case c.name when 'Sundry Debtors' then 'customer' else 'supplier' end,
       a.id,
       coalesce(a.is_archived, false)
from public.accounts a
join public.account_categories c on c.id = a.category_id and c.company_id = a.company_id
where c.name in ('Sundry Debtors', 'Sundry Creditors')
  and c.account_type in ('Asset', 'Liability')
on conflict (account_id) do update
set name = excluded.name,
    type = excluded.type,
    is_archived = excluded.is_archived;

update public.accounts a
set is_party = true
where exists (select 1 from public.parties p where p.account_id = a.id);

update public.account_categories old_category
set is_archived = true
where lower(btrim(old_category.name)) in ('customer', 'customers', 'supplier', 'suppliers')
  and not exists (select 1 from public.accounts a where a.category_id = old_category.id)
  and not exists (select 1 from public.account_categories child where child.parent_category_id = old_category.id);

commit;
notify pgrst, 'reload schema';
