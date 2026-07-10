-- ═══════════════════════════════════════════════════════════════════════════
--  Khata ERP — Supabase Schema
--  Run this entire file in your Supabase project's SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Developer Admins ─────────────────────────────────────────────────────────
create table if not exists developer_admins (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  email            text,
  created_at       timestamptz not null default now()
);

alter table developer_admins enable row level security;

create or replace function is_developer_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from developer_admins where user_id = auth.uid()) $$;

create or replace function get_developer_schema_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  checks jsonb := '[]'::jsonb;
begin
  if not is_developer_admin() then
    raise exception 'Developer admin access required';
  end if;

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'developer_admins_table',
    'label', 'Developer admins table',
    'status', case when to_regclass('public.developer_admins') is not null then 'ok' else 'missing' end,
    'detail', 'Required for protecting the developer dashboard'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'app_events_table',
    'label', 'App events table',
    'status', case when to_regclass('public.app_events') is not null then 'ok' else 'missing' end,
    'detail', 'Required for event log, feature usage, and error tracking'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'is_developer_admin_function',
    'label', 'Developer admin function',
    'status', case when to_regprocedure('public.is_developer_admin()') is not null then 'ok' else 'missing' end,
    'detail', 'Used by RLS policies and frontend access checks'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'schema_status_function',
    'label', 'Schema status function',
    'status', case when to_regprocedure('public.get_developer_schema_status()') is not null then 'ok' else 'missing' end,
    'detail', 'Powers this migration checklist'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'company_owner_email',
    'label', 'Company owner email column',
    'status', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'owner_email') then 'ok' else 'missing' end,
    'detail', 'Shows retailer login email in developer reports'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'company_plan_fields',
    'label', 'Company plan/support fields',
    'status', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'plan_status')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'support_status')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'suspended')
              then 'ok' else 'missing' end,
    'detail', 'Required for plan status, support queue, notes, and suspension'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'company_invoice_settings',
    'label', 'Invoice/settings columns',
    'status', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'sales_prefix')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'print_format')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'logo_url')
              then 'ok' else 'missing' end,
    'detail', 'Required for invoice numbering and print customization'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'voucher_nepali_dates',
    'label', 'Voucher Nepali date columns',
    'status', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'date_bs')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'date_bs_key')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'date_ad')
              then 'ok' else 'missing' end,
    'detail', 'Required for fiscal-year and BS-date dashboards'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'stock_adjustment_voucher_type',
    'label', 'Stock adjustment voucher type',
    'status', case when exists (
                     select 1 from pg_constraint
                     where conname = 'vouchers_type_check'
                       and pg_get_constraintdef(oid) ilike '%Stock Adjustment%'
                   ) then 'ok' else 'missing' end,
    'detail', 'Required for inventory adjustment vouchers'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'return_vouchers',
    'label', 'Sales and purchase return support',
    'status', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'original_voucher_id')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'source_invoice_item_id')
                   and exists (select 1 from pg_constraint where conname = 'vouchers_type_check' and pg_get_constraintdef(oid) ilike '%Sales Return%' and pg_get_constraintdef(oid) ilike '%Purchase Return%')
              then 'ok' else 'missing' end,
    'detail', 'Required for linked credit notes, debit notes, and partial-return validation'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'developer_rls_policies',
    'label', 'Developer RLS policies',
    'status', case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_developer_select')
                   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_events' and policyname = 'app_events_developer_select')
                   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_developer_delete')
              then 'ok' else 'missing' end,
    'detail', 'Required so admins can read company reports and events'
  ));

  checks := checks || jsonb_build_array(jsonb_build_object(
    'key', 'app_event_insert_policy',
    'label', 'App event insert policy',
    'status', case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_events' and policyname = 'app_events_own_insert') then 'ok' else 'missing' end,
    'detail', 'Required so retailer sessions can write usage and error events'
  ));

  return checks;
end $$;

grant execute on function get_developer_schema_status() to authenticated;

-- ── Companies ─────────────────────────────────────────────────────────────────
create table if not exists companies (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  owner_email      text,
  name             text not null default 'My Trading Co.',
  address          text,
  pan_vat          text,
  phone            text,
  vat_enabled      boolean not null default true,
  sales_prefix     text not null default 'INV-',
  purchase_prefix  text not null default 'PB-',
  receipt_prefix   text not null default 'RCPT-',
  payment_prefix   text not null default 'PAY-',
  sales_return_prefix text not null default 'SR-',
  purchase_return_prefix text not null default 'PR-',
  reset_numbering_fiscal_year boolean not null default false,
  print_format     text not null default 'A5' check (print_format in ('A5','A4')),
  invoice_terms    text,
  payment_qr_text  text,
  logo_url         text,
  plan_status      text not null default 'trial' check (plan_status in ('free','trial','paid','expired')),
  trial_ends_at    date,
  support_status   text not null default 'normal' check (support_status in ('normal','needs_help','blocked')),
  developer_notes  text,
  suspended        boolean not null default false,
  fiscal_year_start date not null default '2026-07-17',
  created_at       timestamptz not null default now()
);

alter table companies add column if not exists owner_email text;
alter table companies add column if not exists phone text;
alter table companies add column if not exists vat_enabled boolean not null default true;
alter table companies add column if not exists sales_prefix text not null default 'INV-';
alter table companies add column if not exists purchase_prefix text not null default 'PB-';
alter table companies add column if not exists receipt_prefix text not null default 'RCPT-';
alter table companies add column if not exists payment_prefix text not null default 'PAY-';
alter table companies add column if not exists sales_return_prefix text not null default 'SR-';
alter table companies add column if not exists purchase_return_prefix text not null default 'PR-';
alter table companies add column if not exists reset_numbering_fiscal_year boolean not null default false;
alter table companies add column if not exists print_format text not null default 'A5';
alter table companies add column if not exists invoice_terms text;
alter table companies add column if not exists payment_qr_text text;
alter table companies add column if not exists logo_url text;
alter table companies add column if not exists plan_status text not null default 'trial';
alter table companies add column if not exists trial_ends_at date;
alter table companies add column if not exists support_status text not null default 'normal';
alter table companies add column if not exists developer_notes text;
alter table companies add column if not exists suspended boolean not null default false;
alter table companies alter column fiscal_year_start set default '2026-07-17';
update companies
set fiscal_year_start = '2026-07-17'
where fiscal_year_start is null or fiscal_year_start = '2026-04-01';

-- ── App Events (feature adoption / diagnostics) ───────────────────────────────
create table if not exists app_events (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid references companies(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete set null,
  event_type       text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

-- ── Accounts (Chart of Accounts + party ledger accounts) ─────────────────────
create table if not exists accounts (
  id               text primary key,           -- uuid or seeded slug ('cash', 'bank', …)
  company_id       uuid not null references companies(id) on delete cascade,
  name             text not null,
  type             text not null check (type in ('Asset','Liability','Equity','Income','Expense')),
  "group"          text not null,
  is_system        boolean not null default false,
  is_party         boolean not null default false,
  opening_balance  numeric(14,2) not null default 0,
  created_at       timestamptz not null default now()
);

-- Managed categories used by the Masters screen.
create table if not exists account_categories (
  id                 uuid primary key default uuid_generate_v4(),
  company_id         uuid not null references companies(id) on delete cascade,
  name               text not null,
  account_type       text not null check (account_type in ('Asset','Liability','Equity','Income','Expense')),
  parent_category_id uuid references account_categories(id) on delete restrict,
  is_system          boolean not null default false,
  is_archived        boolean not null default false,
  created_at         timestamptz not null default now(),
  unique(company_id, name, account_type)
);

alter table accounts add column if not exists category_id uuid references account_categories(id) on delete restrict;
alter table accounts add column if not exists is_archived boolean not null default false;

-- ── Parties ───────────────────────────────────────────────────────────────────
create table if not exists parties (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  name             text not null,
  type             text not null check (type in ('customer','supplier')),
  phone            text,
  pan_vat          text,
  address          text,
  account_id       text not null references accounts(id) on delete cascade,
  created_at       timestamptz not null default now()
);
alter table parties add column if not exists is_archived boolean not null default false;

-- ── Items ─────────────────────────────────────────────────────────────────────
create table if not exists items (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  name             text not null,
  unit             text not null default 'pcs',
  sell_rate        numeric(14,2) not null default 0,
  opening_qty      numeric(14,4) not null default 0,
  opening_rate     numeric(14,2) not null default 0,
  reorder_level    numeric(14,4),
  created_at       timestamptz not null default now()
);

create table if not exists item_categories (
  id                 uuid primary key default uuid_generate_v4(),
  company_id         uuid not null references companies(id) on delete cascade,
  name               text not null,
  parent_category_id uuid references item_categories(id) on delete restrict,
  is_archived        boolean not null default false,
  created_at         timestamptz not null default now(),
  unique(company_id, name)
);

alter table items add column if not exists category_id uuid references item_categories(id) on delete restrict;
alter table items add column if not exists sku text;
alter table items add column if not exists barcode text;
alter table items add column if not exists vat_applicable boolean not null default true;
alter table items add column if not exists is_archived boolean not null default false;

create table if not exists master_change_logs (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  record_type text not null,
  record_id   text not null,
  action      text not null,
  old_values  jsonb not null default '{}'::jsonb,
  new_values  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Convert existing free-text account groups into managed categories.
insert into account_categories (company_id, name, account_type, is_system)
select company_id, "group", type, bool_or(is_system)
from accounts
group by company_id, "group", type
on conflict (company_id, name, account_type) do nothing;

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
where i.category_id is null and c.company_id = i.company_id and c.name = 'General';

-- ── Vouchers ──────────────────────────────────────────────────────────────────
create table if not exists vouchers (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  type             text not null check (type in ('Sales','Purchase','Sales Return','Purchase Return','Receipt','Payment','Journal','Stock Adjustment')),
  date             date not null,
  date_ad          date not null,
  date_bs          text not null,
  date_bs_key      integer not null,
  invoice_no       text,
  narration        text,
  original_voucher_id uuid references vouchers(id) on delete restrict,
  return_reason    text,
  settlement_mode text check (settlement_mode in ('party','cash','bank')),
  restock_items    boolean,
  party_account_id text references accounts(id),
  is_cash          boolean not null default false,
  subtotal         numeric(14,2),
  discount         numeric(14,2),
  vat_rate         numeric(5,2),
  vat_amount       numeric(14,2),
  total            numeric(14,2) not null default 0,
  cancelled        boolean not null default false,
  seq              integer not null,
  created_at       timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'vouchers' and constraint_name = 'vouchers_type_check'
  ) then
    alter table vouchers drop constraint vouchers_type_check;
  end if;
  alter table vouchers add constraint vouchers_type_check
    check (type in ('Sales','Purchase','Sales Return','Purchase Return','Receipt','Payment','Journal','Stock Adjustment'));
end $$;

-- Existing databases created before Nepali-date support can run this file again.
-- Old rows may keep date_bs/date_bs_key null until re-saved/imported; the app
-- normalizes them from the legacy AD date while displaying.
alter table vouchers add column if not exists date_ad date;
alter table vouchers add column if not exists date_bs text;
alter table vouchers add column if not exists date_bs_key integer;
alter table vouchers add column if not exists original_voucher_id uuid references vouchers(id) on delete restrict;
alter table vouchers add column if not exists return_reason text;
alter table vouchers add column if not exists settlement_mode text;
alter table vouchers add column if not exists restock_items boolean;
update vouchers set date_ad = coalesce(date_ad, date) where date_ad is null;

-- ── Voucher Lines (double-entry ledger rows) ──────────────────────────────────
create table if not exists voucher_lines (
  id               uuid primary key default uuid_generate_v4(),
  voucher_id       uuid not null references vouchers(id) on delete cascade,
  account_id       text not null references accounts(id),
  debit            numeric(14,2) not null default 0,
  credit           numeric(14,2) not null default 0
);

-- ── Stock Lines (inventory movements) ────────────────────────────────────────
create table if not exists stock_lines (
  id               uuid primary key default uuid_generate_v4(),
  voucher_id       uuid not null references vouchers(id) on delete cascade,
  item_id          uuid not null references items(id),
  qty              numeric(14,4) not null,
  rate             numeric(14,2) not null,
  direction        text not null check (direction in ('in','out'))
);

-- ── Invoice Items (human-readable line items for invoice display) ─────────────
create table if not exists invoice_items (
  id               uuid primary key default uuid_generate_v4(),
  voucher_id       uuid not null references vouchers(id) on delete cascade,
  item_id          uuid not null references items(id),
  qty              numeric(14,4) not null,
  rate             numeric(14,2) not null
);
alter table invoice_items add column if not exists source_invoice_item_id uuid references invoice_items(id) on delete restrict;
alter table invoice_items add column if not exists item_name text;
alter table invoice_items add column if not exists unit text;
alter table invoice_items add column if not exists discount_amount numeric(14,2);
alter table invoice_items add column if not exists taxable_amount numeric(14,2);
alter table invoice_items add column if not exists vat_amount numeric(14,2);
alter table invoice_items add column if not exists cost_rate numeric(14,2);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_accounts_company   on accounts(company_id);
create index if not exists idx_account_categories_company on account_categories(company_id, account_type, name);
create index if not exists idx_parties_company    on parties(company_id);
create index if not exists idx_items_company      on items(company_id);
create index if not exists idx_item_categories_company on item_categories(company_id, name);
create index if not exists idx_master_logs_company on master_change_logs(company_id, created_at desc);
create index if not exists idx_vouchers_company   on vouchers(company_id, date desc, seq desc);
create index if not exists idx_vouchers_company_bs on vouchers(company_id, date_bs_key desc, seq desc);
create index if not exists idx_vouchers_original on vouchers(original_voucher_id) where original_voucher_id is not null;
create index if not exists idx_iitems_source on invoice_items(source_invoice_item_id) where source_invoice_item_id is not null;
create index if not exists idx_vlines_voucher     on voucher_lines(voucher_id);
create index if not exists idx_slines_voucher     on stock_lines(voucher_id);
create index if not exists idx_iitems_voucher     on invoice_items(voucher_id);
create index if not exists idx_app_events_company on app_events(company_id, created_at desc);
create index if not exists idx_app_events_type    on app_events(event_type, created_at desc);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Users can only see/modify data belonging to their own company.

alter table companies      enable row level security;
alter table accounts       enable row level security;
alter table account_categories enable row level security;
alter table parties        enable row level security;
alter table items          enable row level security;
alter table item_categories enable row level security;
alter table master_change_logs enable row level security;
alter table vouchers       enable row level security;
alter table voucher_lines  enable row level security;
alter table stock_lines    enable row level security;
alter table invoice_items  enable row level security;
alter table app_events     enable row level security;

-- Companies: own row only
create policy "companies_own" on companies
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "developer_admins_own_select" on developer_admins
  for select using (user_id = auth.uid());

create policy "companies_developer_select" on companies
  for select using (is_developer_admin());

create policy "companies_developer_update" on companies
  for update using (is_developer_admin()) with check (is_developer_admin());

drop policy if exists "companies_developer_delete" on companies;
create policy "companies_developer_delete" on companies
  for delete using (is_developer_admin());

-- Helper function: returns the user's company_id
create or replace function my_company_id()
returns uuid language sql stable
as $$ select id from companies where user_id = auth.uid() limit 1 $$;

-- Accounts
create policy "accounts_own" on accounts
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

create policy "accounts_developer_select" on accounts
  for select using (is_developer_admin());

create policy "account_categories_own" on account_categories
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

create policy "account_categories_developer_select" on account_categories
  for select using (is_developer_admin());

-- Parties
create policy "parties_own" on parties
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

create policy "parties_developer_select" on parties
  for select using (is_developer_admin());

-- Items
create policy "items_own" on items
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

create policy "items_developer_select" on items
  for select using (is_developer_admin());

create policy "item_categories_own" on item_categories
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

create policy "item_categories_developer_select" on item_categories
  for select using (is_developer_admin());

create policy "master_change_logs_own" on master_change_logs
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

create policy "master_change_logs_developer_select" on master_change_logs
  for select using (is_developer_admin());

-- Vouchers
create policy "vouchers_own" on vouchers
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

create policy "vouchers_developer_select" on vouchers
  for select using (is_developer_admin());

-- Voucher Lines (access via parent voucher's company)
create policy "vlines_own" on voucher_lines
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

create policy "vlines_developer_select" on voucher_lines
  for select using (
    is_developer_admin() and exists (select 1 from vouchers v where v.id = voucher_id)
  );

-- Stock Lines
create policy "slines_own" on stock_lines
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

create policy "slines_developer_select" on stock_lines
  for select using (
    is_developer_admin() and exists (select 1 from vouchers v where v.id = voucher_id)
  );

-- Invoice Items
create policy "iitems_own" on invoice_items
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

create policy "iitems_developer_select" on invoice_items
  for select using (
    is_developer_admin() and exists (select 1 from vouchers v where v.id = voucher_id)
  );

create policy "app_events_own_insert" on app_events
  for insert with check (company_id = my_company_id() and user_id = auth.uid());

create policy "app_events_own_select" on app_events
  for select using (company_id = my_company_id());

create policy "app_events_developer_select" on app_events
  for select using (is_developer_admin());

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this schema, set your environment variables:
--   VITE_SUPABASE_URL      = https://your-project-id.supabase.co
--   VITE_SUPABASE_ANON_KEY = your-anon-public-key
-- Both are in: Supabase dashboard → Settings → API
