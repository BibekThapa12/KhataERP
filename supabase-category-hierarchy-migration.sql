-- Three-level account and item category hierarchy.
begin;

create index if not exists idx_account_categories_parent on public.account_categories(parent_category_id);
create index if not exists idx_item_categories_parent on public.item_categories(parent_category_id);

insert into public.account_categories (company_id, name, account_type, is_system, is_archived)
select c.id, roots.name, roots.account_type, false, false
from public.companies c cross join (values ('Assets','Asset'),('Liabilities','Liability'),('Equity','Equity'),('Income','Income'),('Expenses','Expense')) roots(name, account_type)
on conflict (company_id, name, account_type) do update
set is_system = false, is_archived = false;

insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
select c.id, nodes.name, nodes.account_type, root.id, false, false
from public.companies c
cross join (values ('Current Assets','Asset','Assets'),('Current Liabilities','Liability','Liabilities')) nodes(name, account_type, root_name)
join public.account_categories root on root.company_id = c.id and root.name = nodes.root_name and root.account_type = nodes.account_type
on conflict (company_id, name, account_type) do update set parent_category_id = excluded.parent_category_id;

update public.account_categories child set parent_category_id = root.id
from public.account_categories root
where child.company_id = root.company_id and child.parent_category_id is null and child.id <> root.id
  and root.name = case child.account_type when 'Asset' then 'Assets' when 'Liability' then 'Liabilities' when 'Equity' then 'Equity' when 'Income' then 'Income' else 'Expenses' end
  and root.account_type = child.account_type;

update public.account_categories child set parent_category_id = parent.id
from public.account_categories parent
where child.company_id = parent.company_id
  and ((child.name = 'Sundry Debtors' and parent.name = 'Current Assets' and child.account_type = 'Asset')
    or (child.name = 'Sundry Creditors' and parent.name = 'Current Liabilities' and child.account_type = 'Liability'));

create or replace function public.validate_account_category_hierarchy() returns trigger language plpgsql set search_path = public as $$
declare p record; cursor_id uuid; levels integer := 1; descendant_height integer := 1;
begin
  if exists (select 1 from public.account_categories c where c.parent_category_id = new.id and (c.company_id <> new.company_id or c.account_type <> new.account_type)) then
    raise exception 'A parent must have the same company and account type as its children';
  end if;
  if new.parent_category_id is null then return new; end if;
  if new.parent_category_id = new.id then raise exception 'A category cannot be its own parent'; end if;
  cursor_id := new.parent_category_id;
  loop
    select id, company_id, account_type, parent_category_id into p from public.account_categories where id = cursor_id;
    if not found then raise exception 'Parent category not found'; end if;
    if p.company_id <> new.company_id or p.account_type <> new.account_type then raise exception 'Parent must belong to the same company and account type'; end if;
    if p.id = new.id then raise exception 'Category hierarchy cycle detected'; end if;
    levels := levels + 1;
    if levels > 3 then raise exception 'Category hierarchy cannot exceed three levels'; end if;
    exit when p.parent_category_id is null;
    cursor_id := p.parent_category_id;
  end loop;
  with recursive descendants as (
    select c.id, 2 as depth from public.account_categories c where c.parent_category_id = new.id
    union all
    select c.id, d.depth + 1 from public.account_categories c join descendants d on c.parent_category_id = d.id
  ) select coalesce(max(depth), 1) into descendant_height from descendants;
  if levels + descendant_height - 1 > 3 then raise exception 'Moving this category would exceed three levels'; end if;
  return new;
end $$;

create or replace function public.validate_item_category_hierarchy() returns trigger language plpgsql set search_path = public as $$
declare p record; cursor_id uuid; levels integer := 1; descendant_height integer := 1;
begin
  if exists (select 1 from public.item_categories c where c.parent_category_id = new.id and c.company_id <> new.company_id) then
    raise exception 'A parent must belong to the same company as its children';
  end if;
  if new.parent_category_id is null then return new; end if;
  if new.parent_category_id = new.id then raise exception 'A category cannot be its own parent'; end if;
  cursor_id := new.parent_category_id;
  loop
    select id, company_id, parent_category_id into p from public.item_categories where id = cursor_id;
    if not found then raise exception 'Parent category not found'; end if;
    if p.company_id <> new.company_id then raise exception 'Parent must belong to the same company'; end if;
    if p.id = new.id then raise exception 'Category hierarchy cycle detected'; end if;
    levels := levels + 1;
    if levels > 3 then raise exception 'Category hierarchy cannot exceed three levels'; end if;
    exit when p.parent_category_id is null;
    cursor_id := p.parent_category_id;
  end loop;
  with recursive descendants as (
    select c.id, 2 as depth from public.item_categories c where c.parent_category_id = new.id
    union all
    select c.id, d.depth + 1 from public.item_categories c join descendants d on c.parent_category_id = d.id
  ) select coalesce(max(depth), 1) into descendant_height from descendants;
  if levels + descendant_height - 1 > 3 then raise exception 'Moving this category would exceed three levels'; end if;
  return new;
end $$;

drop trigger if exists account_category_hierarchy_guard on public.account_categories;
create trigger account_category_hierarchy_guard before insert or update of parent_category_id, company_id, account_type on public.account_categories for each row execute function public.validate_account_category_hierarchy();
drop trigger if exists item_category_hierarchy_guard on public.item_categories;
create trigger item_category_hierarchy_guard before insert or update of parent_category_id, company_id on public.item_categories for each row execute function public.validate_item_category_hierarchy();

commit;
notify pgrst, 'reload schema';
