-- KhataERP Masters migration
-- Run this file once in Supabase SQL Editor for an existing project.

create extension if not exists "uuid-ossp";

create table if not exists account_categories (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  account_type text not null check (account_type in ('Asset','Liability','Equity','Income','Expense')),
  parent_category_id uuid references account_categories(id) on delete restrict,
  is_system boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique(company_id, name, account_type)
);

create table if not exists item_categories (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  parent_category_id uuid references item_categories(id) on delete restrict,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

create table if not exists master_change_logs (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  record_type text not null,
  record_id text not null,
  action text not null,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table accounts add column if not exists category_id uuid references account_categories(id) on delete restrict;
alter table accounts add column if not exists is_archived boolean not null default false;
alter table parties add column if not exists is_archived boolean not null default false;
alter table items add column if not exists category_id uuid references item_categories(id) on delete restrict;
alter table items add column if not exists sku text;
alter table items add column if not exists barcode text;
alter table items add column if not exists vat_applicable boolean not null default true;
alter table items add column if not exists is_archived boolean not null default false;

insert into account_categories (company_id, name, account_type, is_system)
select company_id, "group", type, bool_or(is_system)
from accounts
group by company_id, "group", type
on conflict (company_id, name, account_type) do update
set is_system = account_categories.is_system or excluded.is_system;

insert into account_categories (company_id, name, account_type, is_system)
select id, 'Sundry Debtors', 'Asset', true from companies
on conflict (company_id, name, account_type) do update set is_system = true;

insert into account_categories (company_id, name, account_type, is_system)
select id, 'Sundry Creditors', 'Liability', true from companies
on conflict (company_id, name, account_type) do update set is_system = true;

update accounts a
set category_id = c.id
from account_categories c
where a.category_id is null
  and c.company_id = a.company_id
  and c.name = a."group"
  and c.account_type = a.type;

insert into item_categories (company_id, name)
select id, 'General' from companies
on conflict (company_id, name) do nothing;

update items i
set category_id = c.id
from item_categories c
where i.category_id is null
  and c.company_id = i.company_id
  and c.name = 'General';

create index if not exists idx_account_categories_company on account_categories(company_id, account_type, name);
create index if not exists idx_item_categories_company on item_categories(company_id, name);
create index if not exists idx_master_logs_company on master_change_logs(company_id, created_at desc);

alter table account_categories enable row level security;
alter table item_categories enable row level security;
alter table master_change_logs enable row level security;

drop policy if exists "account_categories_own" on account_categories;
create policy "account_categories_own" on account_categories
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "account_categories_developer_select" on account_categories;
create policy "account_categories_developer_select" on account_categories
  for select using (is_developer_admin());

drop policy if exists "item_categories_own" on item_categories;
create policy "item_categories_own" on item_categories
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "item_categories_developer_select" on item_categories;
create policy "item_categories_developer_select" on item_categories
  for select using (is_developer_admin());

drop policy if exists "master_change_logs_own" on master_change_logs;
create policy "master_change_logs_own" on master_change_logs
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "master_change_logs_developer_select" on master_change_logs;
create policy "master_change_logs_developer_select" on master_change_logs
  for select using (is_developer_admin());

notify pgrst, 'reload schema';
