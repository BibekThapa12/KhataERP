-- Default Employee/Staff loan and advance account category.
-- Adds a system Asset group under Loans & Advances (Asset) for every company.

begin;

do $$
declare
  fn text;
begin
  select pg_get_functiondef('public.validate_account_category_hierarchy()'::regprocedure) into fn;
  if fn is not null then
    fn := replace(fn, 'levels > 3', 'levels > 4');
    fn := replace(fn, 'three levels', 'four levels');
    fn := replace(fn, 'levels + descendant_height - 1 > 3', 'levels + descendant_height - 1 > 4');
    execute fn;
  end if;

  select pg_get_functiondef('public.validate_item_category_hierarchy()'::regprocedure) into fn;
  if fn is not null then
    fn := replace(fn, 'levels > 3', 'levels > 4');
    fn := replace(fn, 'three levels', 'four levels');
    fn := replace(fn, 'levels + descendant_height - 1 > 3', 'levels + descendant_height - 1 > 4');
    execute fn;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.account_categories'::regclass
      and trigger_row.tgname = 'account_category_system_guard'
  ) then
    execute 'alter table public.account_categories disable trigger account_category_system_guard';
  end if;
end $$;

insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
select company.id, 'Employees / Staffs', 'Asset', parent.id, true, false
from public.companies company
join public.account_categories parent
  on parent.company_id = company.id
 and parent.name = 'Loans & Advances (Asset)'
 and parent.account_type = 'Asset'
on conflict (company_id, name, account_type) do update
set parent_category_id = excluded.parent_category_id,
    is_system = true,
    is_archived = false;

do $$
begin
  if exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.account_categories'::regclass
      and trigger_row.tgname = 'account_category_system_guard'
  ) then
    execute 'alter table public.account_categories enable trigger account_category_system_guard';
  end if;
end $$;

commit;
