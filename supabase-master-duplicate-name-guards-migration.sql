-- Prevent duplicate master names inside the same company.
-- Existing duplicate historical rows are left untouched, but new inserts and
-- renames to an existing name are blocked case-insensitively.
begin;

create or replace function public.prevent_duplicate_item_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);

  if new.name = '' then
    raise exception 'Enter an item name';
  end if;

  if exists (
    select 1
    from public.items item
    where item.company_id = new.company_id
      and lower(btrim(item.name)) = lower(new.name)
      and item.id is distinct from new.id
    limit 1
  ) then
    raise exception 'Stock item already exist';
  end if;

  return new;
end;
$$;

drop trigger if exists items_duplicate_name_guard on public.items;
create trigger items_duplicate_name_guard
before insert or update of company_id, name on public.items
for each row execute function public.prevent_duplicate_item_name();

create or replace function public.prevent_duplicate_item_category_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);

  if new.name = '' then
    raise exception 'Enter a category name';
  end if;

  if exists (
    select 1
    from public.item_categories category
    where category.company_id = new.company_id
      and lower(btrim(category.name)) = lower(new.name)
      and category.id is distinct from new.id
    limit 1
  ) then
    raise exception 'Stock item category already exist';
  end if;

  return new;
end;
$$;

drop trigger if exists item_categories_duplicate_name_guard on public.item_categories;
create trigger item_categories_duplicate_name_guard
before insert or update of company_id, name on public.item_categories
for each row execute function public.prevent_duplicate_item_category_name();

create or replace function public.prevent_duplicate_account_category_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);

  if new.name = '' then
    raise exception 'Enter a category name';
  end if;

  if exists (
    select 1
    from public.account_categories category
    where category.company_id = new.company_id
      and category.account_type = new.account_type
      and lower(btrim(category.name)) = lower(new.name)
      and category.id is distinct from new.id
    limit 1
  ) then
    raise exception 'Account category already exist';
  end if;

  return new;
end;
$$;

drop trigger if exists account_categories_duplicate_name_guard on public.account_categories;
create trigger account_categories_duplicate_name_guard
before insert or update of company_id, name, account_type on public.account_categories
for each row execute function public.prevent_duplicate_account_category_name();

commit;
notify pgrst, 'reload schema';
