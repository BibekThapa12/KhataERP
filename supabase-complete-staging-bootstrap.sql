-- KhataERP complete staging database bootstrap
-- Generated for a BRAND-NEW Supabase project on 2026-07-23.
--
-- Run this entire file once in the Supabase SQL Editor using the postgres role.
-- It creates the complete schema, RLS policies, accounting safeguards, account
-- hierarchy, optional cheque module, atomic posting functions, indexes, and all
-- current ERP functionality. Do not run the individual migration files after
-- this bootstrap.
--
-- Read-only diagnostics and security audit queries are intentionally excluded.


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-schema.sql
-- =============================================================================
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
  inventory_valuation_method text not null default 'weighted_average' check (inventory_valuation_method in ('weighted_average','fifo','lifo')),
  sales_prefix     text not null default 'INV-',
  purchase_prefix  text not null default 'PB-',
  receipt_prefix   text not null default 'RCPT-',
  payment_prefix   text not null default 'PAY-',
  sales_return_prefix text not null default 'SR-',
  purchase_return_prefix text not null default 'PR-',
  journal_numbering_mode text not null default 'auto' check (journal_numbering_mode in ('auto','manual')),
  reset_numbering_fiscal_year boolean not null default true,
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
  fiscal_year_configured boolean not null default false,
  created_at       timestamptz not null default now()
);

create unique index if not exists companies_user_id_unique on companies(user_id);

alter table companies add column if not exists owner_email text;
alter table companies add column if not exists phone text;
alter table companies add column if not exists vat_enabled boolean not null default true;
alter table companies add column if not exists inventory_valuation_method text not null default 'weighted_average';
alter table companies add column if not exists sales_prefix text not null default 'INV-';
alter table companies add column if not exists purchase_prefix text not null default 'PB-';
alter table companies add column if not exists receipt_prefix text not null default 'RCPT-';
alter table companies add column if not exists payment_prefix text not null default 'PAY-';
alter table companies add column if not exists sales_return_prefix text not null default 'SR-';
alter table companies add column if not exists purchase_return_prefix text not null default 'PR-';
alter table companies add column if not exists journal_numbering_mode text not null default 'auto';
alter table companies drop constraint if exists companies_journal_numbering_mode_check;
alter table companies add constraint companies_journal_numbering_mode_check check (journal_numbering_mode in ('auto','manual'));
alter table companies add column if not exists reset_numbering_fiscal_year boolean not null default true;
alter table companies alter column reset_numbering_fiscal_year set default true;
update companies set reset_numbering_fiscal_year = true where not reset_numbering_fiscal_year;
alter table companies drop constraint if exists companies_fiscal_numbering_required;
alter table companies add constraint companies_fiscal_numbering_required check (reset_numbering_fiscal_year);
alter table companies add column if not exists print_format text not null default 'A5';
alter table companies add column if not exists invoice_terms text;
alter table companies add column if not exists payment_qr_text text;
alter table companies add column if not exists logo_url text;
alter table companies add column if not exists plan_status text not null default 'trial';
alter table companies add column if not exists trial_ends_at date;
alter table companies add column if not exists support_status text not null default 'normal';
alter table companies add column if not exists developer_notes text;
alter table companies add column if not exists suspended boolean not null default false;
alter table companies add column if not exists fiscal_year_configured boolean not null default false;
alter table companies alter column fiscal_year_start set default '2026-07-17';
update companies
set fiscal_year_start = '2026-07-17'
where fiscal_year_start is null;

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
  address          text,
  contact_no       text,
  pan_no           text,
  credit_days      integer,
  bank_account_no  text,
  bank_branch      text,
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
alter table parties add column if not exists default_credit_days integer not null default 0;

-- ── Items ─────────────────────────────────────────────────────────────────────
create table if not exists items (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  name             text not null,
  unit             text not null default 'pcs',
  alternate_unit   text,
  alternate_conversion numeric(14,4),
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
alter table items add column if not exists alternate_unit text;
alter table items add column if not exists alternate_conversion numeric(14,4);

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
  supplier_invoice_no text,
  numbering_period text not null default 'all',
  credit_days      integer,
  due_date_ad      date,
  due_date_bs      text,
  due_date_bs_key  integer,
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
alter table vouchers add column if not exists supplier_invoice_no text;
alter table vouchers drop constraint if exists vouchers_supplier_invoice_no_length_check;
alter table vouchers add constraint vouchers_supplier_invoice_no_length_check check (supplier_invoice_no is null or char_length(supplier_invoice_no) <= 100);
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
  direction        text not null check (direction in ('in','out')),
  stock_condition  text not null default 'saleable' check (stock_condition in ('saleable','damaged','expired')),
  is_transfer      boolean not null default false
);

-- ── Invoice Items (human-readable line items for invoice display) ─────────────
create table if not exists invoice_items (
  id               uuid primary key default uuid_generate_v4(),
  voucher_id       uuid not null references vouchers(id) on delete cascade,
  item_id          uuid not null references items(id),
  qty              numeric(14,4) not null,
  rate             numeric(14,2) not null
);

-- Voucher-to-invoice allocations. Historical receipts/payments without rows
-- remain valid and are allocated FIFO by the reporting layer.
create table if not exists voucher_settlements (
  id                    uuid primary key default uuid_generate_v4(),
  company_id            uuid not null references companies(id) on delete cascade,
  settlement_voucher_id uuid not null references vouchers(id) on delete cascade,
  invoice_voucher_id    uuid not null references vouchers(id) on delete cascade,
  party_account_id      text not null references accounts(id),
  amount                numeric(14,2) not null check (amount > 0),
  created_at            timestamptz not null default now(),
  unique (settlement_voucher_id, invoice_voucher_id, party_account_id),
  check (settlement_voucher_id <> invoice_voucher_id)
);

create or replace function validate_voucher_settlement()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from vouchers
    where id = new.settlement_voucher_id and company_id = new.company_id
      and type in ('Receipt', 'Payment') and not cancelled
  ) then raise exception 'Settlement voucher must be an active Receipt or Payment in the same company'; end if;
  if not exists (
    select 1 from vouchers
    where id = new.invoice_voucher_id and company_id = new.company_id
      and type in ('Sales', 'Purchase') and not cancelled
  ) then raise exception 'Invoice voucher must be an active Sales or Purchase voucher in the same company'; end if;
  if not exists (select 1 from accounts where id = new.party_account_id and company_id = new.company_id and is_party) then
    raise exception 'Settlement party ledger must belong to the same company';
  end if;
  return new;
end $$;

drop trigger if exists validate_voucher_settlement_trigger on voucher_settlements;
create trigger validate_voucher_settlement_trigger before insert or update on voucher_settlements
for each row execute function validate_voucher_settlement();
alter table invoice_items add column if not exists source_invoice_item_id uuid references invoice_items(id) on delete restrict;
alter table invoice_items add column if not exists item_name text;
alter table invoice_items add column if not exists unit text;
alter table invoice_items add column if not exists discount_amount numeric(14,2);
alter table invoice_items add column if not exists taxable_amount numeric(14,2);
alter table invoice_items add column if not exists vat_amount numeric(14,2);
alter table invoice_items add column if not exists cost_rate numeric(14,2);
alter table invoice_items add column if not exists entry_unit text;
alter table invoice_items add column if not exists conversion_factor numeric(14,4) not null default 1;
alter table invoice_items add column if not exists base_qty numeric(14,4);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_accounts_company   on accounts(company_id);
create index if not exists idx_account_categories_company on account_categories(company_id, account_type, name);
create index if not exists idx_parties_company    on parties(company_id);
create index if not exists idx_items_company      on items(company_id);
create index if not exists idx_item_categories_company on item_categories(company_id, name);
create index if not exists idx_master_logs_company on master_change_logs(company_id, created_at desc);
create index if not exists idx_vouchers_company   on vouchers(company_id, date desc, seq desc);
create index if not exists idx_vouchers_company_bs on vouchers(company_id, date_bs_key desc, seq desc);
create unique index if not exists vouchers_company_type_period_invoice_no_unique on vouchers(company_id, type, numbering_period, invoice_no) where invoice_no is not null;
create index if not exists idx_vouchers_original on vouchers(original_voucher_id) where original_voucher_id is not null;
create index if not exists idx_iitems_source on invoice_items(source_invoice_item_id) where source_invoice_item_id is not null;
create index if not exists idx_vlines_voucher     on voucher_lines(voucher_id);
create index if not exists idx_slines_voucher     on stock_lines(voucher_id);
create index if not exists idx_slines_item_condition on stock_lines(item_id, stock_condition);
create index if not exists idx_iitems_voucher     on invoice_items(voucher_id);
create index if not exists idx_vsettlements_company on voucher_settlements(company_id);
create index if not exists idx_vsettlements_settlement on voucher_settlements(settlement_voucher_id);
create index if not exists idx_vsettlements_invoice on voucher_settlements(invoice_voucher_id);
create index if not exists idx_vsettlements_party on voucher_settlements(company_id, party_account_id);
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
alter table voucher_settlements enable row level security;
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

drop policy if exists "voucher_settlements_own" on voucher_settlements;
create policy "voucher_settlements_own" on voucher_settlements
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "voucher_settlements_developer_select" on voucher_settlements;
create policy "voucher_settlements_developer_select" on voucher_settlements
  for select using (is_developer_admin());

create policy "app_events_own_insert" on app_events
  for insert with check (company_id = my_company_id() and user_id = auth.uid());

drop policy if exists "app_events_own_select" on app_events;

create policy "app_events_developer_select" on app_events
  for select using (is_developer_admin());

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this schema, set your environment variables:
--   VITE_SUPABASE_URL      = https://your-project-id.supabase.co
--   VITE_SUPABASE_ANON_KEY = your-anon-public-key
-- Both are in: Supabase dashboard → Settings → API

-- END INCLUDED FILE: supabase-schema.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-masters-migration.sql
-- =============================================================================
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

-- END INCLUDED FILE: supabase-masters-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-returns-migration.sql
-- =============================================================================
-- KhataERP Sales Return / Purchase Return migration
-- Run once in Supabase SQL Editor after the main schema or Masters migration.

alter table companies add column if not exists sales_return_prefix text not null default 'SR-';
alter table companies add column if not exists purchase_return_prefix text not null default 'PR-';

alter table vouchers add column if not exists original_voucher_id uuid references vouchers(id) on delete restrict;
alter table vouchers add column if not exists return_reason text;
alter table vouchers add column if not exists settlement_mode text;
alter table vouchers add column if not exists restock_items boolean;

alter table invoice_items add column if not exists source_invoice_item_id uuid references invoice_items(id) on delete restrict;
alter table invoice_items add column if not exists item_name text;
alter table invoice_items add column if not exists unit text;
alter table invoice_items add column if not exists discount_amount numeric(14,2);
alter table invoice_items add column if not exists taxable_amount numeric(14,2);
alter table invoice_items add column if not exists vat_amount numeric(14,2);
alter table invoice_items add column if not exists cost_rate numeric(14,2);

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'vouchers'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%type%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table vouchers drop constraint %I', constraint_name);
  end if;

  alter table vouchers add constraint vouchers_type_check
    check (type in ('Sales','Purchase','Sales Return','Purchase Return','Receipt','Payment','Journal','Stock Adjustment'));
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'vouchers'::regclass and conname = 'vouchers_settlement_mode_check'
  ) then
    alter table vouchers add constraint vouchers_settlement_mode_check
      check (settlement_mode is null or settlement_mode in ('party','cash','bank'));
  end if;
end $$;

create index if not exists idx_vouchers_original
  on vouchers(original_voucher_id) where original_voucher_id is not null;
create index if not exists idx_iitems_source
  on invoice_items(source_invoice_item_id) where source_invoice_item_id is not null;

notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-returns-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-integrity-migration.sql
-- =============================================================================
-- Apply after supabase-schema.sql.
-- Existing duplicate invoice numbers are repaired deterministically: the oldest
-- voucher keeps its number and later duplicates receive numbers above the
-- current maximum for the same company, voucher type, and prefix.

begin;

alter table public.vouchers add column if not exists numbering_period text not null default 'all';

create unique index if not exists vouchers_company_seq_unique
  on public.vouchers (company_id, seq);

with parsed as (
  select
    id,
    company_id,
    type,
    numbering_period,
    invoice_no,
    created_at,
    seq,
    regexp_replace(invoice_no, '[0-9]+$', '') as prefix,
    case
      when invoice_no ~ '[0-9]+$'
        then (substring(invoice_no from '([0-9]+)$'))::bigint
      else 0
    end as number_part,
    row_number() over (
      partition by company_id, type, numbering_period, invoice_no
      order by created_at nulls last, seq, id
    ) as duplicate_rank
  from public.vouchers
  where invoice_no is not null
), maxima as (
  select company_id, type, numbering_period, prefix, max(number_part) as max_number
  from parsed
  group by company_id, type, numbering_period, prefix
), duplicates as (
  select
    p.id,
    p.prefix,
    m.max_number,
    row_number() over (
      partition by p.company_id, p.type, p.numbering_period, p.prefix
      order by p.created_at nulls last, p.seq, p.id
    ) as repair_number
  from parsed p
  join maxima m using (company_id, type, numbering_period, prefix)
  where p.duplicate_rank > 1
)
update public.vouchers v
set invoice_no = d.prefix || lpad((d.max_number + d.repair_number)::text, 4, '0')
from duplicates d
where v.id = d.id;

drop index if exists public.vouchers_company_type_invoice_no_unique;

create unique index if not exists vouchers_company_type_period_invoice_no_unique
  on public.vouchers (company_id, type, numbering_period, invoice_no)
  where invoice_no is not null;

-- This deferred guard rejects malformed journals at transaction commit.
create or replace function public.validate_voucher_balance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_id uuid := coalesce(new.voucher_id, old.voucher_id);
  debit_total numeric;
  credit_total numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into debit_total, credit_total
    from public.voucher_lines where voucher_id = target_id;
  if abs(debit_total - credit_total) > 0.005 then
    raise exception 'Voucher % is not balanced (debit %, credit %)', target_id, debit_total, credit_total;
  end if;
  return null;
end;
$$;

drop trigger if exists voucher_lines_balance_guard on public.voucher_lines;
create constraint trigger voucher_lines_balance_guard
after insert or update or delete on public.voucher_lines
deferrable initially deferred
for each row execute function public.validate_voucher_balance();

commit;

-- END INCLUDED FILE: supabase-integrity-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-fiscal-voucher-numbering-migration.sql
-- =============================================================================
-- Apply after supabase-integrity-migration.sql.
-- Allows the same voucher number to be reused in different fiscal years while
-- preserving uniqueness within each company, voucher type, and numbering period.
begin;

alter table public.vouchers
  add column if not exists numbering_period text not null default 'all';

update public.vouchers
set numbering_period = 'all'
where numbering_period is null or btrim(numbering_period) = '';

drop index if exists public.vouchers_company_type_invoice_no_unique;

create unique index if not exists vouchers_company_type_period_invoice_no_unique
  on public.vouchers (company_id, type, numbering_period, invoice_no)
  where invoice_no is not null;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-fiscal-voucher-numbering-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-stock-condition-migration.sql
-- =============================================================================
-- Tracks stock condition without changing historical quantities or valuation.
-- Existing stock movements are classified as saleable.
begin;

alter table public.stock_lines
  add column if not exists stock_condition text not null default 'saleable';

alter table public.stock_lines
  add column if not exists is_transfer boolean not null default false;

update public.stock_lines
set stock_condition = 'saleable'
where stock_condition is null or stock_condition not in ('saleable', 'damaged', 'expired');

do $$
begin
  alter table public.stock_lines drop constraint if exists stock_lines_stock_condition_check;
  alter table public.stock_lines add constraint stock_lines_stock_condition_check
    check (stock_condition in ('saleable', 'damaged', 'expired'));
end $$;s

create index if not exists idx_slines_item_condition
  on public.stock_lines(item_id, stock_condition);

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-stock-condition-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-alternative-units-migration.sql
-- =============================================================================
-- Main/alternative unit support. Apply after the base schema.
begin;

alter table public.items add column if not exists alternate_unit text;
alter table public.items add column if not exists alternate_conversion numeric(14,4);

alter table public.items drop constraint if exists items_alternate_unit_check;
alter table public.items add constraint items_alternate_unit_check check (
  (alternate_unit is null and alternate_conversion is null)
  or (
    length(trim(alternate_unit)) > 0
    and lower(trim(alternate_unit)) <> lower(trim(unit))
    and alternate_conversion > 1
  )
);

alter table public.invoice_items add column if not exists entry_unit text;
alter table public.invoice_items add column if not exists conversion_factor numeric(14,4) not null default 1;
alter table public.invoice_items add column if not exists base_qty numeric(14,4);

update public.invoice_items
set entry_unit = coalesce(entry_unit, unit),
    conversion_factor = coalesce(conversion_factor, 1),
    base_qty = coalesce(base_qty, qty / nullif(coalesce(conversion_factor, 1), 0))
where entry_unit is null or base_qty is null;

alter table public.invoice_items drop constraint if exists invoice_items_conversion_factor_check;
alter table public.invoice_items add constraint invoice_items_conversion_factor_check check (conversion_factor >= 1);

commit;

-- END INCLUDED FILE: supabase-alternative-units-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-category-hierarchy-migration.sql
-- =============================================================================
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

-- END INCLUDED FILE: supabase-category-hierarchy-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-sundry-parties-migration.sql
-- =============================================================================
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

-- END INCLUDED FILE: supabase-sundry-parties-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-multiple-bank-accounts-migration.sql
-- =============================================================================
-- Apply after supabase-category-hierarchy-migration.sql.
begin;

insert into public.account_categories (company_id, name, account_type, is_system, is_archived)
select c.id, 'Assets', 'Asset', false, false from public.companies c
on conflict (company_id, name, account_type) do update set is_archived = false;

insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
select c.id, 'Current Assets', 'Asset', root.id, false, false
from public.companies c join public.account_categories root on root.company_id = c.id and root.name = 'Assets' and root.account_type = 'Asset'
on conflict (company_id, name, account_type) do update set parent_category_id = excluded.parent_category_id, is_archived = false;

insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
select c.id, 'Bank', 'Asset', parent.id, true, false
from public.companies c join public.account_categories parent on parent.company_id = c.id and parent.name = 'Current Assets' and parent.account_type = 'Asset'
on conflict (company_id, name, account_type) do update set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;

update public.accounts a set category_id = bank.id, "group" = 'Bank'
from public.account_categories bank
where bank.company_id = a.company_id and bank.name = 'Bank' and bank.account_type = 'Asset'
  and (a.id = a.company_id::text || ':bank' or (a.id = 'bank' and a.name = 'Bank Account'));

alter table public.vouchers add column if not exists settlement_account_id text references public.accounts(id) on delete restrict;
create index if not exists idx_vouchers_settlement_account on public.vouchers(settlement_account_id);

update public.vouchers v set settlement_account_id = (
  select l.account_id from public.voucher_lines l
  where l.voucher_id = v.id and (
    (v.type = 'Receipt' and l.account_id is distinct from v.party_account_id and l.debit > 0) or
    (v.type = 'Payment' and l.account_id is distinct from v.party_account_id and l.credit > 0) or
    (v.type = 'Sales Return' and l.credit > 0) or
    (v.type = 'Purchase Return' and l.debit > 0)
  ) order by greatest(l.debit, l.credit) desc limit 1
)
where v.settlement_account_id is null and v.type in ('Receipt','Payment','Sales Return','Purchase Return');

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-multiple-bank-accounts-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-system-account-groups-migration.sql
-- =============================================================================
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

-- END INCLUDED FILE: supabase-system-account-groups-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-retained-earnings-ledger-migration.sql
-- =============================================================================
-- Apply after supabase-system-account-groups-migration.sql.
-- Creates a real protected Retained Earnings ledger for every company.
begin;

create or replace function public.ensure_retained_earnings_ledger(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  retained_category_id uuid;
begin
  perform public.ensure_system_account_groups(target_company_id);

  select category.id into retained_category_id
  from public.account_categories category
  where category.company_id = target_company_id
    and category.name = 'Reserves & Surplus'
    and category.account_type = 'Equity'
  limit 1;

  if retained_category_id is null then
    raise exception 'Reserves & Surplus system group is missing for company %', target_company_id;
  end if;

  insert into public.accounts (
    id, company_id, name, type, "group", category_id,
    is_system, is_party, is_archived, opening_balance
  ) values (
    target_company_id::text || ':retained_earnings', target_company_id,
    'Retained Earnings', 'Equity', 'Reserves & Surplus', retained_category_id,
    true, false, false, 0
  )
  on conflict (id) do update set
    name = excluded.name,
    type = excluded.type,
    "group" = excluded."group",
    category_id = excluded.category_id,
    is_system = true,
    is_party = false,
    is_archived = false;
end;
$$;

do $$
declare company_record record;
begin
  for company_record in select id from public.companies loop
    perform public.ensure_retained_earnings_ledger(company_record.id);
  end loop;
end;
$$;

create or replace function public.seed_retained_earnings_ledger_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_retained_earnings_ledger(new.id);
  return new;
end;
$$;

drop trigger if exists company_retained_earnings_ledger_seed on public.companies;
create trigger company_retained_earnings_ledger_seed
after insert on public.companies
for each row execute function public.seed_retained_earnings_ledger_for_company();

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-retained-earnings-ledger-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-single-company-per-user-migration.sql
-- =============================================================================
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

-- END INCLUDED FILE: supabase-single-company-per-user-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-credit-days-migration.sql
-- =============================================================================
-- Party default credit terms and invoice-specific due-date snapshots.
-- Apply after supabase-schema.sql. Safe to run more than once.
begin;

alter table public.parties
  add column if not exists default_credit_days integer not null default 0;

alter table public.vouchers
  add column if not exists credit_days integer,
  add column if not exists due_date_ad date,
  add column if not exists due_date_bs text,
  add column if not exists due_date_bs_key integer;

update public.parties
set default_credit_days = 0
where default_credit_days is null or default_credit_days < 0;

update public.vouchers
set credit_days = coalesce(credit_days, 0),
    due_date_ad = coalesce(due_date_ad, date_ad, date),
    due_date_bs = coalesce(due_date_bs, date_bs),
    due_date_bs_key = coalesce(due_date_bs_key, date_bs_key)
where type in ('Sales', 'Purchase')
  and (credit_days is null or due_date_ad is null or due_date_bs is null or due_date_bs_key is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parties_default_credit_days_nonnegative') then
    alter table public.parties add constraint parties_default_credit_days_nonnegative check (default_credit_days >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vouchers_credit_days_nonnegative') then
    alter table public.vouchers add constraint vouchers_credit_days_nonnegative check (credit_days is null or credit_days >= 0);
  end if;
end $$;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-credit-days-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-ledger-details-migration.sql
-- =============================================================================
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

-- END INCLUDED FILE: supabase-ledger-details-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-inventory-valuation-migration.sql
-- =============================================================================
-- Company-wide perpetual inventory valuation method.
-- Safe to run more than once.
begin;

alter table public.companies
  add column if not exists inventory_valuation_method text not null default 'weighted_average';

update public.companies
set inventory_valuation_method = 'weighted_average'
where inventory_valuation_method is null
   or inventory_valuation_method not in ('weighted_average', 'fifo', 'lifo');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'companies_inventory_valuation_method_check'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_inventory_valuation_method_check
      check (inventory_valuation_method in ('weighted_average', 'fifo', 'lifo'));
  end if;
end $$;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-inventory-valuation-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-voucher-settlements-migration.sql
-- =============================================================================
-- KhataERP invoice settlement allocation migration
-- Safe to run more than once in Supabase SQL Editor.

create extension if not exists "uuid-ossp";

create table if not exists voucher_settlements (
  id                    uuid primary key default uuid_generate_v4(),
  company_id            uuid not null references companies(id) on delete cascade,
  settlement_voucher_id uuid not null references vouchers(id) on delete cascade,
  invoice_voucher_id    uuid not null references vouchers(id) on delete cascade,
  party_account_id      text not null references accounts(id),
  amount                numeric(14,2) not null check (amount > 0),
  created_at            timestamptz not null default now(),
  unique (settlement_voucher_id, invoice_voucher_id, party_account_id),
  check (settlement_voucher_id <> invoice_voucher_id)
);

create index if not exists idx_vsettlements_company on voucher_settlements(company_id);
create index if not exists idx_vsettlements_settlement on voucher_settlements(settlement_voucher_id);
create index if not exists idx_vsettlements_invoice on voucher_settlements(invoice_voucher_id);
create index if not exists idx_vsettlements_party on voucher_settlements(company_id, party_account_id);

create or replace function validate_voucher_settlement()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from vouchers
    where id = new.settlement_voucher_id and company_id = new.company_id
      and type in ('Receipt', 'Payment') and not cancelled
  ) then raise exception 'Settlement voucher must be an active Receipt or Payment in the same company'; end if;
  if not exists (
    select 1 from vouchers
    where id = new.invoice_voucher_id and company_id = new.company_id
      and type in ('Sales', 'Purchase') and not cancelled
  ) then raise exception 'Invoice voucher must be an active Sales or Purchase voucher in the same company'; end if;
  if not exists (select 1 from accounts where id = new.party_account_id and company_id = new.company_id and is_party) then
    raise exception 'Settlement party ledger must belong to the same company';
  end if;
  return new;
end $$;

drop trigger if exists validate_voucher_settlement_trigger on voucher_settlements;
create trigger validate_voucher_settlement_trigger before insert or update on voucher_settlements
for each row execute function validate_voucher_settlement();

alter table voucher_settlements enable row level security;

drop policy if exists "voucher_settlements_own" on voucher_settlements;
create policy "voucher_settlements_own" on voucher_settlements
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "voucher_settlements_developer_select" on voucher_settlements;
create policy "voucher_settlements_developer_select" on voucher_settlements
  for select using (is_developer_admin());

notify pgrst, 'reload schema';


-- END INCLUDED FILE: supabase-voucher-settlements-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-cheque-management-migration.sql
-- =============================================================================
-- Optional tenant-level Cheque Management module (received cheques only).
begin;

create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(), key text not null unique, name text not null,
  description text, default_price numeric(14,2) not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.modules(key,name,description,default_price,is_active)
values ('cheque_management','Cheque Management','Received cheque tracking, clearing and bank-linked receipts',0,true)
on conflict(key) do update set name=excluded.name, description=excluded.description;

create table if not exists public.company_modules (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  module_id uuid not null references public.modules(id), is_enabled boolean not null default false,
  status text not null default 'disabled' check(status in ('active','trial','grace_period','read_only','disabled')),
  billing_type text not null default 'included' check(billing_type in ('included','monthly','yearly','one_time','custom')),
  price numeric(14,2) not null default 0, payment_status text not null default 'pending' check(payment_status in ('paid','pending','overdue','waived','cancelled')),
  starts_at date, expires_at date, settings jsonb not null default '{"enable_dashboard_widgets":true,"allow_due_date_before_issue_date":false,"default_upcoming_days":7,"require_status_reason_for_bounce":true,"require_status_reason_for_cancel":true,"allow_account_number_override":false,"enable_cheque_notifications":false,"enable_read_only_after_expiry":true}'::jsonb,
  internal_notes text, enabled_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,module_id), check(expires_at is null or starts_at is null or expires_at >= starts_at)
);

create table if not exists public.company_user_permissions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, permission text not null,
  granted_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(company_id,user_id,permission)
);

create or replace function public.has_company_permission(target_company uuid, requested_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.companies c where c.id=target_company and c.user_id=auth.uid())
    or exists(select 1 from public.company_user_permissions p where p.company_id=target_company and p.user_id=auth.uid() and p.permission=requested_permission)
    or public.is_developer_admin()
$$;

create or replace function public.company_module_access(target_company uuid, module_key text, write_access boolean default false)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.company_modules cm join public.modules m on m.id=cm.module_id
    where cm.company_id=target_company and m.key=module_key and m.is_active and cm.is_enabled
      and (cm.starts_at is null or current_date >= cm.starts_at)
      and (
        (cm.expires_at is null or current_date <= cm.expires_at)
        or (not write_access and coalesce((cm.settings->>'enable_read_only_after_expiry')::boolean,false))
      )
      and (case when write_access then cm.status in ('active','trial') else cm.status in ('active','trial','grace_period','read_only') end)
      and cm.payment_status <> 'cancelled'
      and (not write_access or cm.status='trial' or cm.billing_type='included' or cm.payment_status in ('paid','waived'))
  ) or public.is_developer_admin()
$$;

create table if not exists public.cheque_banks (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  ledger_account_id text references public.accounts(id), bank_name text not null, branch_name text,
  account_number text not null default '', institution_type text, source text, account_holder_name text, contact_number text, notes text,
  is_active boolean not null default true, created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,ledger_account_id)
);
alter table public.cheque_banks alter column ledger_account_id drop not null;
alter table public.cheque_banks alter column account_number set default '';
alter table public.cheque_banks add column if not exists institution_type text;
alter table public.cheque_banks add column if not exists source text;
drop trigger if exists cheque_bank_guard on public.cheque_banks;

create or replace function public.seed_nepal_cheque_banks(target_company uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.cheque_banks(company_id,bank_name,institution_type,source,account_number,is_active)
  select target_company,bank.name,bank.kind,'NRB Mid-May 2026','',true from (values
    ('Nepal Bank Ltd.','Commercial Bank'),('Agricultural Development Bank Ltd.','Commercial Bank'),('Nabil Bank Ltd.','Commercial Bank'),('Nepal Investment Mega Bank Ltd.','Commercial Bank'),('Standard Chartered Bank Nepal Ltd.','Commercial Bank'),('Himalayan Bank Ltd.','Commercial Bank'),('Nepal SBI Bank Ltd.','Commercial Bank'),('Everest Bank Ltd.','Commercial Bank'),('Kumari Bank Ltd.','Commercial Bank'),('Laxmi Sunrise Bank Ltd.','Commercial Bank'),('Citizens Bank International Ltd.','Commercial Bank'),('Prime Commercial Bank Ltd.','Commercial Bank'),('Sanima Bank Ltd.','Commercial Bank'),('Machhapuchhre Bank Ltd.','Commercial Bank'),('NIC Asia Bank Ltd.','Commercial Bank'),('Global IME Bank Ltd.','Commercial Bank'),('NMB Bank Ltd.','Commercial Bank'),('Prabhu Bank Ltd.','Commercial Bank'),('Siddhartha Bank Ltd.','Commercial Bank'),('Rastriya Banijya Bank Ltd.','Commercial Bank'),
    ('Narayani Development Bank Ltd.','Development Bank'),('Karnali Development Bank Ltd.','Development Bank'),('Excel Development Bank Ltd.','Development Bank'),('Miteri Development Bank Ltd.','Development Bank'),('Muktinath Bikas Bank Ltd.','Development Bank'),('Corporate Development Bank Ltd.','Development Bank'),('Sindhu Bikas Bank Ltd.','Development Bank'),('Salapa Bikash Bank Ltd.','Development Bank'),('Green Development Bank Ltd.','Development Bank'),('Sangrila Development Bank Ltd.','Development Bank'),('Shine Resunga Development Bank Ltd.','Development Bank'),('Jyoti Bikas Bank Ltd.','Development Bank'),('Garima Bikas Bank Ltd.','Development Bank'),('Mahalaxmi Bikas Bank Ltd.','Development Bank'),('Lumbini Bikas Bank Ltd.','Development Bank'),('Kamana Sewa Bikas Bank Ltd.','Development Bank'),('Saptakoshi Development Bank Ltd.','Development Bank'),
    ('Nepal Finance Ltd.','Finance Company'),('Nepal Share Markets and Finance Ltd.','Finance Company'),('Goodwill Finance Ltd.','Finance Company'),('Progressive Finance Ltd.','Finance Company'),('Janaki Finance Co. Ltd.','Finance Company'),('Pokhara Finance Ltd.','Finance Company'),('Multipurpose Finance Ltd.','Finance Company'),('Samriddhi Finance Company Limited','Finance Company'),('Capital Merchant Banking & Finance Ltd.','Finance Company'),('Guheshwori Merchant Banking & Finance Ltd.','Finance Company'),('ICFC Finance Ltd.','Finance Company'),('Manjushree Finance Ltd.','Finance Company'),('Reliance Finance Ltd.','Finance Company'),('Gurkhas Finance Ltd.','Finance Company'),('Shree Investment & Finance Co. Ltd.','Finance Company'),('Central Finance Ltd.','Finance Company'),('Best Finance Ltd.','Finance Company')
  ) bank(name,kind)
  where not exists(select 1 from public.cheque_banks existing where existing.company_id=target_company and lower(existing.bank_name)=lower(bank.name))
  on conflict do nothing;
end $$;

create or replace function public.seed_cheque_banks_on_entitlement() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.is_enabled and exists(select 1 from public.modules m where m.id=new.module_id and m.key='cheque_management') then
    perform public.seed_nepal_cheque_banks(new.company_id);
  end if;
  return new;
end $$;
drop trigger if exists company_module_seed_cheque_banks on public.company_modules;
create trigger company_module_seed_cheque_banks after insert or update of is_enabled on public.company_modules
for each row execute function public.seed_cheque_banks_on_entitlement();

do $$ declare entitlement record; begin
  for entitlement in select cm.company_id from public.company_modules cm join public.modules m on m.id=cm.module_id where m.key='cheque_management' and cm.is_enabled loop
    perform public.seed_nepal_cheque_banks(entitlement.company_id);
  end loop;
end $$;

create table if not exists public.cheques (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  cheque_number text not null check(cheque_number ~ '^[A-Za-z0-9][A-Za-z0-9 /._-]{0,49}$'),
  bank_id uuid not null references public.cheque_banks(id), account_number text not null,
  party_ledger_id text not null references public.accounts(id), amount numeric(14,2) not null check(amount>0),
  issue_date date not null, issue_date_bs text not null, issue_date_bs_key integer not null,
  due_date date not null, due_date_bs text not null, due_date_bs_key integer not null,
  notes text, status text not null default 'pending' check(status in ('pending','cleared','bounced','cancelled')),
  cleared_at timestamptz, bounced_at timestamptz, cancelled_at timestamptz, status_reason text,
  linked_voucher_id uuid references public.vouchers(id), created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,bank_id,account_number,cheque_number)
);
alter table public.cheques add column if not exists cleared_to_account_id text references public.accounts(id);

-- Older drafts of this migration used a fixed due-date check. Module settings now control it.
do $$ declare constraint_name text; begin
  select conname into constraint_name from pg_constraint
  where conrelid='public.cheques'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%due_date%issue_date%'
  limit 1;
  if constraint_name is not null then execute format('alter table public.cheques drop constraint %I',constraint_name); end if;
end $$;

create table if not exists public.cheque_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  cheque_id uuid references public.cheques(id) on delete cascade, bank_id uuid references public.cheque_banks(id) on delete cascade,
  action text not null, old_values jsonb not null default '{}'::jsonb, new_values jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id), created_at timestamptz not null default now()
);

create index if not exists idx_company_modules_company on public.company_modules(company_id,module_id);
create index if not exists idx_cheques_company_due on public.cheques(company_id,due_date_bs_key);
create index if not exists idx_cheques_company_status on public.cheques(company_id,status);
create index if not exists idx_cheques_party on public.cheques(company_id,party_ledger_id);
create index if not exists idx_cheques_bank on public.cheques(company_id,bank_id);
create index if not exists idx_cheque_events_entity on public.cheque_events(company_id,cheque_id,created_at desc);

create or replace function public.validate_cheque_bank() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.cheque_banks b where b.company_id=new.company_id and lower(b.bank_name)=lower(new.bank_name) and b.id<>new.id) then
    raise exception 'This issuing bank already exists';
  end if;
  if new.ledger_account_id is not null and not exists(select 1 from public.accounts a where a.id=new.ledger_account_id and a.company_id=new.company_id and not coalesce(a.is_archived,false)) then
    raise exception 'Cheque bank ledger must be active and belong to the company';
  end if;
  new.updated_at=now(); new.updated_by=auth.uid(); return new;
end $$;
drop trigger if exists cheque_bank_guard on public.cheque_banks;
create trigger cheque_bank_guard before insert or update on public.cheque_banks for each row execute function public.validate_cheque_bank();

create or replace function public.cheque_touch_and_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare bank_record record; allow_early boolean; allow_override boolean;
begin
  select b.company_id,b.account_number,b.is_active into bank_record from public.cheque_banks b where b.id=new.bank_id;
  if not found or bank_record.company_id<>new.company_id then raise exception 'Issuing bank must belong to the cheque company'; end if;
  if tg_op='INSERT' and not bank_record.is_active then raise exception 'Inactive banks cannot be used for new cheques'; end if;
  if not exists(select 1 from public.accounts a where a.id=new.party_ledger_id and a.company_id=new.company_id and not coalesce(a.is_archived,false)) then raise exception 'Party ledger must be active and belong to the cheque company'; end if;
  select coalesce((cm.settings->>'allow_due_date_before_issue_date')::boolean,false), coalesce((cm.settings->>'allow_account_number_override')::boolean,false) into allow_early,allow_override
  from public.company_modules cm join public.modules m on m.id=cm.module_id where cm.company_id=new.company_id and m.key='cheque_management';
  if new.due_date<new.issue_date and not coalesce(allow_early,false) then raise exception 'Due date cannot be before issue date'; end if;
  if coalesce(bank_record.account_number,'')<>'' and new.account_number<>bank_record.account_number and not coalesce(allow_override,false) then raise exception 'Account number must match the selected bank'; end if;
  if new.cleared_to_account_id is not null and not exists(
    select 1 from public.accounts a left join public.account_categories c on c.id=a.category_id
    where a.id=new.cleared_to_account_id and a.company_id=new.company_id and not coalesce(a.is_archived,false)
      and (c.name in ('Cash-in-Hand','Bank Accounts','Bank','Bank OD A/c')
        or (a.is_system and (a.id=new.company_id::text || ':cash' or a.id='cash')))
  ) then raise exception 'Clearing account must be the active Cash-in-Hand or a company bank ledger'; end if;
  new.updated_at=now(); new.updated_by=auth.uid();
  if tg_op='UPDATE' and old.status<>'pending' and (
    new.cheque_number is distinct from old.cheque_number or new.bank_id is distinct from old.bank_id or
    new.account_number is distinct from old.account_number or new.party_ledger_id is distinct from old.party_ledger_id or
    new.amount is distinct from old.amount or new.issue_date is distinct from old.issue_date or
    new.due_date is distinct from old.due_date or new.notes is distinct from old.notes
  ) then raise exception 'Completed cheques cannot be edited'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status then
    if old.status<>'pending' then raise exception 'Only pending cheques may change status'; end if;
    if new.status='cleared' and not public.has_company_permission(new.company_id,'cheque.mark_cleared') then raise exception 'Missing cheque.mark_cleared permission'; end if;
    if new.status='bounced' and not public.has_company_permission(new.company_id,'cheque.mark_bounced') then raise exception 'Missing cheque.mark_bounced permission'; end if;
    if new.status='cancelled' and not public.has_company_permission(new.company_id,'cheque.cancel') then raise exception 'Missing cheque.cancel permission'; end if;
    if new.status='cleared' then new.cleared_at=now();
    elsif new.status='bounced' then new.bounced_at=now();
    elsif new.status='cancelled' then new.cancelled_at=now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists cheque_touch_guard on public.cheques;
create trigger cheque_touch_guard before insert or update on public.cheques for each row execute function public.cheque_touch_and_audit();

alter table public.modules enable row level security;
alter table public.company_modules enable row level security;
alter table public.company_user_permissions enable row level security;
alter table public.cheque_banks enable row level security;
alter table public.cheques enable row level security;
alter table public.cheque_events enable row level security;

drop policy if exists modules_authenticated_select on public.modules;
drop policy if exists modules_developer_all on public.modules;
drop policy if exists company_modules_owner_select on public.company_modules;
drop policy if exists company_modules_developer_all on public.company_modules;
drop policy if exists company_permissions_own_select on public.company_user_permissions;
drop policy if exists company_permissions_developer_all on public.company_user_permissions;
drop policy if exists cheque_banks_read on public.cheque_banks;
drop policy if exists cheque_banks_write on public.cheque_banks;
drop policy if exists cheques_read on public.cheques;
drop policy if exists cheques_insert on public.cheques;
drop policy if exists cheques_update on public.cheques;
drop policy if exists cheque_events_read on public.cheque_events;
drop policy if exists cheque_events_insert on public.cheque_events;
drop policy if exists cheque_events_developer_insert on public.cheque_events;
drop policy if exists cheque_module_developer_select_banks on public.cheque_banks;
drop policy if exists cheque_module_developer_select_cheques on public.cheques;
drop policy if exists cheque_module_developer_select_events on public.cheque_events;

create policy modules_authenticated_select on public.modules for select to authenticated using(true);
create policy modules_developer_all on public.modules for all using(public.is_developer_admin()) with check(public.is_developer_admin());
create policy company_modules_owner_select on public.company_modules for select using(company_id=public.my_company_id());
create policy company_modules_developer_all on public.company_modules for all using(public.is_developer_admin()) with check(public.is_developer_admin());
create policy company_permissions_own_select on public.company_user_permissions for select using(company_id=public.my_company_id() and user_id=auth.uid());
create policy company_permissions_developer_all on public.company_user_permissions for all using(public.is_developer_admin()) with check(public.is_developer_admin());

create policy cheque_banks_read on public.cheque_banks for select using(company_id=public.my_company_id() and public.company_module_access(company_id,'cheque_management',false) and public.has_company_permission(company_id,'cheque.view'));
create policy cheque_banks_write on public.cheque_banks for all using(company_id=public.my_company_id() and public.company_module_access(company_id,'cheque_management',true) and public.has_company_permission(company_id,'cheque.manage_banks')) with check(company_id=public.my_company_id() and public.company_module_access(company_id,'cheque_management',true) and public.has_company_permission(company_id,'cheque.manage_banks'));
create policy cheques_read on public.cheques for select using(company_id=public.my_company_id() and public.company_module_access(company_id,'cheque_management',false) and public.has_company_permission(company_id,'cheque.view'));
create policy cheques_insert on public.cheques for insert with check(company_id=public.my_company_id() and public.company_module_access(company_id,'cheque_management',true) and public.has_company_permission(company_id,'cheque.create'));
create policy cheques_update on public.cheques for update using(company_id=public.my_company_id() and public.company_module_access(company_id,'cheque_management',true) and (public.has_company_permission(company_id,'cheque.edit') or public.has_company_permission(company_id,'cheque.mark_cleared') or public.has_company_permission(company_id,'cheque.mark_bounced') or public.has_company_permission(company_id,'cheque.cancel'))) with check(company_id=public.my_company_id() and public.company_module_access(company_id,'cheque_management',true));
create policy cheque_events_read on public.cheque_events for select using(company_id=public.my_company_id() and public.company_module_access(company_id,'cheque_management',false) and public.has_company_permission(company_id,'cheque.view'));
create policy cheque_events_insert on public.cheque_events for insert with check(company_id=public.my_company_id() and actor_id=auth.uid() and public.company_module_access(company_id,'cheque_management',true));
create policy cheque_events_developer_insert on public.cheque_events for insert with check(public.is_developer_admin() and actor_id=auth.uid());
create policy cheque_module_developer_select_banks on public.cheque_banks for select using(public.is_developer_admin());
create policy cheque_module_developer_select_cheques on public.cheques for select using(public.is_developer_admin());
create policy cheque_module_developer_select_events on public.cheque_events for select using(public.is_developer_admin());

commit;
notify pgrst,'reload schema';

-- END INCLUDED FILE: supabase-cheque-management-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-atomic-voucher-posting-migration.sql
-- =============================================================================
-- Phase 4: atomic voucher posting.
-- Apply after the base schema, integrity, alternative-unit, multiple-bank, and
-- voucher-settlement migrations. Safe to run repeatedly.
begin;

alter table public.vouchers add column if not exists idempotency_key uuid;
create unique index if not exists vouchers_company_idempotency_unique
  on public.vouchers(company_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.voucher_atomic_response(target_voucher_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select to_jsonb(voucher) || jsonb_build_object(
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'account_id', line.account_id, 'debit', line.debit, 'credit', line.credit
    )) from public.voucher_lines line where line.voucher_id = voucher.id), '[]'::jsonb),
    'stock_lines', coalesce((select jsonb_agg(jsonb_build_object(
      'item_id', line.item_id, 'qty', line.qty, 'rate', line.rate,
      'direction', line.direction, 'stock_condition', line.stock_condition,
      'is_transfer', line.is_transfer
    )) from public.stock_lines line where line.voucher_id = voucher.id), '[]'::jsonb),
    'invoice_items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', item.id, 'item_id', item.item_id, 'qty', item.qty, 'rate', item.rate,
      'source_invoice_item_id', item.source_invoice_item_id,
      'item_name', item.item_name, 'unit', item.unit, 'entry_unit', item.entry_unit,
      'conversion_factor', item.conversion_factor, 'base_qty', item.base_qty,
      'discount_amount', item.discount_amount, 'taxable_amount', item.taxable_amount,
      'vat_amount', item.vat_amount, 'cost_rate', item.cost_rate
    )) from public.invoice_items item where item.voucher_id = voucher.id), '[]'::jsonb),
    'settlements', coalesce((select jsonb_agg(jsonb_build_object(
      'invoice_voucher_id', settlement.invoice_voucher_id,
      'party_account_id', settlement.party_account_id, 'amount', settlement.amount
    )) from public.voucher_settlements settlement where settlement.settlement_voucher_id = voucher.id), '[]'::jsonb)
  )
  from public.vouchers voucher
  where voucher.id = target_voucher_id;
$$;

create or replace function public.save_voucher_atomic(
  p_voucher jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_stock_lines jsonb default '[]'::jsonb,
  p_invoice_items jsonb default '[]'::jsonb,
  p_settlements jsonb default '[]'::jsonb,
  p_voucher_id uuid default null,
  p_invoice_prefix text default null,
  p_reset_numbering boolean default false,
  p_period_start_key integer default null,
  p_next_period_start_key integer default null,
  p_audit_event_type text default null,
  p_audit_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved public.vouchers%rowtype;
  target_company uuid;
  target_type text;
  next_seq integer;
  highest_number bigint;
  generated_number text;
  debit_total numeric(14,2);
  credit_total numeric(14,2);
  result jsonb;
  requested_idempotency uuid;
  posting_stage text := 'payload_validation';
  original_message text;
  original_detail text;
  original_hint text;
  original_state text;
begin
  if p_voucher is null or jsonb_typeof(p_voucher) <> 'object' then
    raise exception 'Voucher payload must be an object';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_stock_lines, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_invoice_items, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_settlements, '[]'::jsonb)) <> 'array' then
    raise exception 'Voucher child payloads must be arrays';
  end if;

  select coalesce(sum(coalesce(line.debit, 0)), 0),
         coalesce(sum(coalesce(line.credit, 0)), 0)
    into debit_total, credit_total
  from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
    as line(account_id text, debit numeric, credit numeric);
  if abs(debit_total - credit_total) > 0.01 then
    raise exception 'Voucher is not balanced: debit %, credit %', debit_total, credit_total;
  end if;

  if p_voucher_id is null then
    target_company := nullif(p_voucher->>'company_id', '')::uuid;
    target_type := nullif(p_voucher->>'type', '');
    requested_idempotency := nullif(p_voucher->>'idempotency_key', '')::uuid;
  else
    select * into saved from public.vouchers where id = p_voucher_id;
    if not found then raise exception 'Voucher not found'; end if;
    target_company := saved.company_id;
    target_type := saved.type;
    if p_voucher ? 'company_id' and nullif(p_voucher->>'company_id', '')::uuid is distinct from target_company then
      raise exception 'Voucher company cannot be changed';
    end if;
  end if;

  if target_company is null or target_company is distinct from public.my_company_id() then
    raise exception 'Voucher company access denied' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as line(account_id text)
    left join public.accounts account on account.id = line.account_id and account.company_id = target_company
    where account.id is null
  ) then raise exception 'Every voucher ledger must belong to the voucher company'; end if;

  if nullif(p_voucher->>'party_account_id', '') is not null and not exists (
    select 1 from public.accounts account
    where account.id = p_voucher->>'party_account_id' and account.company_id = target_company
  ) then raise exception 'Voucher party ledger must belong to the voucher company'; end if;
  if nullif(p_voucher->>'settlement_account_id', '') is not null and not exists (
    select 1 from public.accounts account
    where account.id = p_voucher->>'settlement_account_id' and account.company_id = target_company
  ) then raise exception 'Voucher settlement ledger must belong to the voucher company'; end if;
  if nullif(p_voucher->>'original_voucher_id', '') is not null and not exists (
    select 1 from public.vouchers voucher
    where voucher.id = nullif(p_voucher->>'original_voucher_id', '')::uuid
      and voucher.company_id = target_company
  ) then raise exception 'Original voucher must belong to the voucher company'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_stock_lines, '[]'::jsonb)) as line(item_id uuid)
    left join public.items item on item.id = line.item_id and item.company_id = target_company
    where item.id is null
  ) or exists (
    select 1
    from jsonb_to_recordset(coalesce(p_invoice_items, '[]'::jsonb)) as line(item_id uuid)
    left join public.items item on item.id = line.item_id and item.company_id = target_company
    where item.id is null
  ) then raise exception 'Every voucher item must belong to the voucher company'; end if;

  -- Every posting for one company uses the same short transaction-scoped lock.
  -- This protects numbering, idempotency, and the stock availability check
  -- without blocking writes for other tenants.
  posting_stage := 'company_write_lock';
  perform pg_advisory_xact_lock(hashtextextended(target_company::text, 0));

  if p_voucher_id is null then
    if target_type is null or p_invoice_prefix is null then
      raise exception 'Voucher type and numbering prefix are required';
    end if;

    if requested_idempotency is not null then
      select * into saved from public.vouchers voucher
      where voucher.company_id = target_company
        and voucher.idempotency_key = requested_idempotency;
      if found then
        return public.voucher_atomic_response(saved.id);
      end if;
    end if;

    posting_stage := 'voucher_number_generation';
    select coalesce(max(voucher.seq), 0) + 1 into next_seq
    from public.vouchers voucher where voucher.company_id = target_company;

    select coalesce(max((substring(voucher.invoice_no from '([0-9]+)$'))::bigint), 0)
      into highest_number
    from public.vouchers voucher
    where voucher.company_id = target_company
      and voucher.type = target_type
      and substring(voucher.invoice_no from '([0-9]+)$') is not null
      and (
        not p_reset_numbering
        or voucher.numbering_period = coalesce(nullif(p_voucher->>'numbering_period', ''), 'all')
      );
    generated_number := p_invoice_prefix || lpad((highest_number + 1)::text, 4, '0');

    posting_stage := 'voucher_header_insert';
    insert into public.vouchers (
      company_id, type, date, date_ad, date_bs, date_bs_key, invoice_no,
      numbering_period, credit_days, due_date_ad, due_date_bs, due_date_bs_key,
      narration, original_voucher_id, return_reason, settlement_mode,
      settlement_account_id, restock_items, party_account_id, is_cash,
      subtotal, discount, vat_rate, vat_amount, total, cancelled, seq,
      idempotency_key
    ) values (
      target_company, target_type,
      (p_voucher->>'date')::date, (p_voucher->>'date_ad')::date,
      p_voucher->>'date_bs', (p_voucher->>'date_bs_key')::integer,
      generated_number, coalesce(nullif(p_voucher->>'numbering_period', ''), 'all'),
      nullif(p_voucher->>'credit_days', '')::integer,
      nullif(p_voucher->>'due_date_ad', '')::date, nullif(p_voucher->>'due_date_bs', ''),
      nullif(p_voucher->>'due_date_bs_key', '')::integer, nullif(p_voucher->>'narration', ''),
      nullif(p_voucher->>'original_voucher_id', '')::uuid, nullif(p_voucher->>'return_reason', ''),
      nullif(p_voucher->>'settlement_mode', ''), nullif(p_voucher->>'settlement_account_id', ''),
      coalesce((p_voucher->>'restock_items')::boolean, false), nullif(p_voucher->>'party_account_id', ''),
      coalesce((p_voucher->>'is_cash')::boolean, false), nullif(p_voucher->>'subtotal', '')::numeric,
      nullif(p_voucher->>'discount', '')::numeric, nullif(p_voucher->>'vat_rate', '')::numeric,
      nullif(p_voucher->>'vat_amount', '')::numeric, coalesce((p_voucher->>'total')::numeric, 0),
      coalesce((p_voucher->>'cancelled')::boolean, false), next_seq,
      requested_idempotency
    ) returning * into saved;
  else
    posting_stage := 'voucher_header_lock';
    select * into saved from public.vouchers where id = p_voucher_id for update;
    if not found or saved.company_id is distinct from target_company then raise exception 'Voucher not found'; end if;
    posting_stage := 'voucher_header_update';
    update public.vouchers voucher set
      date = case when p_voucher ? 'date' then (p_voucher->>'date')::date else voucher.date end,
      date_ad = case when p_voucher ? 'date_ad' then (p_voucher->>'date_ad')::date else voucher.date_ad end,
      date_bs = case when p_voucher ? 'date_bs' then p_voucher->>'date_bs' else voucher.date_bs end,
      date_bs_key = case when p_voucher ? 'date_bs_key' then (p_voucher->>'date_bs_key')::integer else voucher.date_bs_key end,
      numbering_period = case when p_voucher ? 'numbering_period' then p_voucher->>'numbering_period' else voucher.numbering_period end,
      credit_days = case when p_voucher ? 'credit_days' then nullif(p_voucher->>'credit_days', '')::integer else voucher.credit_days end,
      due_date_ad = case when p_voucher ? 'due_date_ad' then nullif(p_voucher->>'due_date_ad', '')::date else voucher.due_date_ad end,
      due_date_bs = case when p_voucher ? 'due_date_bs' then nullif(p_voucher->>'due_date_bs', '') else voucher.due_date_bs end,
      due_date_bs_key = case when p_voucher ? 'due_date_bs_key' then nullif(p_voucher->>'due_date_bs_key', '')::integer else voucher.due_date_bs_key end,
      narration = case when p_voucher ? 'narration' then nullif(p_voucher->>'narration', '') else voucher.narration end,
      original_voucher_id = case when p_voucher ? 'original_voucher_id' then nullif(p_voucher->>'original_voucher_id', '')::uuid else voucher.original_voucher_id end,
      return_reason = case when p_voucher ? 'return_reason' then nullif(p_voucher->>'return_reason', '') else voucher.return_reason end,
      settlement_mode = case when p_voucher ? 'settlement_mode' then nullif(p_voucher->>'settlement_mode', '') else voucher.settlement_mode end,
      settlement_account_id = case when p_voucher ? 'settlement_account_id' then nullif(p_voucher->>'settlement_account_id', '') else voucher.settlement_account_id end,
      restock_items = case when p_voucher ? 'restock_items' then (p_voucher->>'restock_items')::boolean else voucher.restock_items end,
      party_account_id = case when p_voucher ? 'party_account_id' then nullif(p_voucher->>'party_account_id', '') else voucher.party_account_id end,
      is_cash = case when p_voucher ? 'is_cash' then (p_voucher->>'is_cash')::boolean else voucher.is_cash end,
      subtotal = case when p_voucher ? 'subtotal' then nullif(p_voucher->>'subtotal', '')::numeric else voucher.subtotal end,
      discount = case when p_voucher ? 'discount' then nullif(p_voucher->>'discount', '')::numeric else voucher.discount end,
      vat_rate = case when p_voucher ? 'vat_rate' then nullif(p_voucher->>'vat_rate', '')::numeric else voucher.vat_rate end,
      vat_amount = case when p_voucher ? 'vat_amount' then nullif(p_voucher->>'vat_amount', '')::numeric else voucher.vat_amount end,
      total = case when p_voucher ? 'total' then (p_voucher->>'total')::numeric else voucher.total end,
      cancelled = case when p_voucher ? 'cancelled' then (p_voucher->>'cancelled')::boolean else voucher.cancelled end
    where voucher.id = p_voucher_id and voucher.company_id = target_company
    returning * into saved;

    posting_stage := 'existing_children_replace';
    delete from public.voucher_settlements where settlement_voucher_id = saved.id;
    delete from public.invoice_items where voucher_id = saved.id;
    delete from public.stock_lines where voucher_id = saved.id;
    delete from public.voucher_lines where voucher_id = saved.id;
  end if;

  posting_stage := 'voucher_lines_insert';
  insert into public.voucher_lines (voucher_id, account_id, debit, credit)
  select saved.id, line.account_id, coalesce(line.debit, 0), coalesce(line.credit, 0)
  from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
    as line(account_id text, debit numeric, credit numeric);

  posting_stage := 'stock_movements_insert';
  insert into public.stock_lines (voucher_id, item_id, qty, rate, direction, stock_condition, is_transfer)
  select saved.id, line.item_id, line.qty, line.rate, line.direction,
         coalesce(line.stock_condition, 'saleable'), coalesce(line.is_transfer, false)
  from jsonb_to_recordset(coalesce(p_stock_lines, '[]'::jsonb))
    as line(item_id uuid, qty numeric, rate numeric, direction text, stock_condition text, is_transfer boolean);

  posting_stage := 'stock_validation';
  if exists (
    with affected as (
      select distinct line.item_id, coalesce(line.stock_condition, 'saleable') as stock_condition
      from jsonb_to_recordset(coalesce(p_stock_lines, '[]'::jsonb))
        as line(item_id uuid, stock_condition text)
    )
    select 1
    from affected
    join public.items item on item.id = affected.item_id and item.company_id = target_company
    left join public.stock_lines stock_line
      on stock_line.item_id = affected.item_id
     and coalesce(stock_line.stock_condition, 'saleable') = affected.stock_condition
    left join public.vouchers voucher
      on voucher.id = stock_line.voucher_id
     and voucher.company_id = target_company
     and not voucher.cancelled
    group by affected.item_id, affected.stock_condition, item.opening_qty
    having (case when affected.stock_condition = 'saleable' then coalesce(item.opening_qty, 0) else 0 end)
      + coalesce(sum(case when voucher.id is not null and stock_line.direction = 'in' then stock_line.qty
                          when voucher.id is not null and stock_line.direction = 'out' then -stock_line.qty
                          else 0 end), 0) < -0.0001
  ) then
    raise exception 'Insufficient stock for this transaction';
  end if;

  posting_stage := 'invoice_items_insert';
  insert into public.invoice_items (
    voucher_id, item_id, qty, rate, source_invoice_item_id, item_name, unit,
    entry_unit, conversion_factor, base_qty, discount_amount, taxable_amount,
    vat_amount, cost_rate
  )
  select saved.id, item.item_id, item.qty, item.rate, item.source_invoice_item_id,
         item.item_name, item.unit, item.entry_unit, coalesce(item.conversion_factor, 1),
         item.base_qty, item.discount_amount, item.taxable_amount, item.vat_amount, item.cost_rate
  from jsonb_to_recordset(coalesce(p_invoice_items, '[]'::jsonb)) as item(
    item_id uuid, qty numeric, rate numeric, source_invoice_item_id uuid,
    item_name text, unit text, entry_unit text, conversion_factor numeric,
    base_qty numeric, discount_amount numeric, taxable_amount numeric,
    vat_amount numeric, cost_rate numeric
  );

  posting_stage := 'settlements_insert';
  insert into public.voucher_settlements (
    company_id, settlement_voucher_id, invoice_voucher_id, party_account_id, amount
  )
  select target_company, saved.id, settlement.invoice_voucher_id,
         settlement.party_account_id, settlement.amount
  from jsonb_to_recordset(coalesce(p_settlements, '[]'::jsonb))
    as settlement(invoice_voucher_id uuid, party_account_id text, amount numeric);

  posting_stage := 'audit_event_insert';
  insert into public.app_events (company_id, user_id, event_type, metadata)
  values (
    target_company, auth.uid(),
    coalesce(nullif(p_audit_event_type, ''), case when p_voucher_id is null then 'voucher_created' else 'voucher_updated' end),
    coalesce(p_audit_metadata, '{}'::jsonb) || jsonb_build_object(
      'voucher_id', saved.id, 'type', saved.type,
      'ledger_line_count', jsonb_array_length(coalesce(p_lines, '[]'::jsonb)),
      'stock_line_count', jsonb_array_length(coalesce(p_stock_lines, '[]'::jsonb)),
      'invoice_item_count', jsonb_array_length(coalesce(p_invoice_items, '[]'::jsonb))
    )
  );

  posting_stage := 'response_build';
  result := public.voucher_atomic_response(saved.id);
  return result;
exception when others then
  get stacked diagnostics
    original_message = message_text,
    original_detail = pg_exception_detail,
    original_hint = pg_exception_hint,
    original_state = returned_sqlstate;
  raise using
    message = original_message,
    detail = concat_ws('; ', nullif(original_detail, ''), 'save_voucher_atomic stage=' || posting_stage),
    hint = coalesce(original_hint, ''),
    errcode = original_state;
end;
$$;

revoke all on function public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb) from public;
grant execute on function public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb) to authenticated;
revoke all on function public.voucher_atomic_response(uuid) from public;
grant execute on function public.voucher_atomic_response(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-atomic-voucher-posting-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-write-query-optimization-migration.sql
-- =============================================================================
-- Phase 5: optimize queries executed inside write operations.
-- Apply after the base schema and Phase 4 atomic voucher migration.
-- Safe to run repeatedly.
begin;

-- my_company_id() is evaluated by nearly every write RLS policy. Run the
-- indexed owner lookup without recursively evaluating companies RLS, then use
-- scalar init-plans in policies so PostgreSQL evaluates it once per statement
-- instead of once for every row in a bulk insert/update.
create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company.id
  from public.companies company
  where company.user_id = auth.uid()
  limit 1
$$;

revoke all on function public.my_company_id() from public;
grant execute on function public.my_company_id() to authenticated;

drop policy if exists "accounts_own" on public.accounts;
create policy "accounts_own" on public.accounts
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "account_categories_own" on public.account_categories;
create policy "account_categories_own" on public.account_categories
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "parties_own" on public.parties;
create policy "parties_own" on public.parties
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "items_own" on public.items;
create policy "items_own" on public.items
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "item_categories_own" on public.item_categories;
create policy "item_categories_own" on public.item_categories
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "master_change_logs_own" on public.master_change_logs;
create policy "master_change_logs_own" on public.master_change_logs
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "vouchers_own" on public.vouchers;
create policy "vouchers_own" on public.vouchers
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "vlines_own" on public.voucher_lines;
create policy "vlines_own" on public.voucher_lines
  for all using (
    exists (
      select 1 from public.vouchers voucher
      where voucher.id = voucher_id
        and voucher.company_id = (select public.my_company_id())
    )
  );

drop policy if exists "slines_own" on public.stock_lines;
create policy "slines_own" on public.stock_lines
  for all using (
    exists (
      select 1 from public.vouchers voucher
      where voucher.id = voucher_id
        and voucher.company_id = (select public.my_company_id())
    )
  );

drop policy if exists "iitems_own" on public.invoice_items;
create policy "iitems_own" on public.invoice_items
  for all using (
    exists (
      select 1 from public.vouchers voucher
      where voucher.id = voucher_id
        and voucher.company_id = (select public.my_company_id())
    )
  );

drop policy if exists "voucher_settlements_own" on public.voucher_settlements;
create policy "voucher_settlements_own" on public.voucher_settlements
  for all
  using (company_id = (select public.my_company_id()))
  with check (company_id = (select public.my_company_id()));

drop policy if exists "app_events_own_insert" on public.app_events;
create policy "app_events_own_insert" on public.app_events
  for insert with check (
    company_id = (select public.my_company_id())
    and user_id = (select auth.uid())
  );

drop policy if exists "app_events_own_select" on public.app_events;
create policy "app_events_own_select" on public.app_events
  for select using (company_id = (select public.my_company_id()));

-- Developer policies are permissive alternatives to owner policies. Wrapping
-- the stable permission function likewise prevents a repeated admin lookup
-- while rows are processed or returned.
drop policy if exists "accounts_developer_select" on public.accounts;
create policy "accounts_developer_select" on public.accounts
  for select using ((select public.is_developer_admin()));

drop policy if exists "account_categories_developer_select" on public.account_categories;
create policy "account_categories_developer_select" on public.account_categories
  for select using ((select public.is_developer_admin()));

drop policy if exists "parties_developer_select" on public.parties;
create policy "parties_developer_select" on public.parties
  for select using ((select public.is_developer_admin()));

drop policy if exists "items_developer_select" on public.items;
create policy "items_developer_select" on public.items
  for select using ((select public.is_developer_admin()));

drop policy if exists "item_categories_developer_select" on public.item_categories;
create policy "item_categories_developer_select" on public.item_categories
  for select using ((select public.is_developer_admin()));

drop policy if exists "master_change_logs_developer_select" on public.master_change_logs;
create policy "master_change_logs_developer_select" on public.master_change_logs
  for select using ((select public.is_developer_admin()));

drop policy if exists "vouchers_developer_select" on public.vouchers;
create policy "vouchers_developer_select" on public.vouchers
  for select using ((select public.is_developer_admin()));

drop policy if exists "vlines_developer_select" on public.voucher_lines;
create policy "vlines_developer_select" on public.voucher_lines
  for select using (
    (select public.is_developer_admin())
    and exists (select 1 from public.vouchers voucher where voucher.id = voucher_id)
  );

drop policy if exists "slines_developer_select" on public.stock_lines;
create policy "slines_developer_select" on public.stock_lines
  for select using (
    (select public.is_developer_admin())
    and exists (select 1 from public.vouchers voucher where voucher.id = voucher_id)
  );

drop policy if exists "iitems_developer_select" on public.invoice_items;
create policy "iitems_developer_select" on public.invoice_items
  for select using (
    (select public.is_developer_admin())
    and exists (select 1 from public.vouchers voucher where voucher.id = voucher_id)
  );

drop policy if exists "voucher_settlements_developer_select" on public.voucher_settlements;
create policy "voucher_settlements_developer_select" on public.voucher_settlements
  for select using ((select public.is_developer_admin()));

drop policy if exists "app_events_developer_select" on public.app_events;
create policy "app_events_developer_select" on public.app_events
  for select using ((select public.is_developer_admin()));

-- This is the only new write-path index justified by an uncovered application
-- predicate: renaming an account group updates every directly assigned ledger
-- with WHERE accounts.category_id = <group>. It also supports the category FK
-- check on deletion. Existing voucher and child indexes already cover every
-- Phase 4 lookup, delete, validation, and response query.
create index if not exists idx_accounts_category_id
  on public.accounts(category_id)
  where category_id is not null;

-- Refresh estimates after policy/index changes. This does not rewrite data.
analyze public.companies;
analyze public.accounts;
analyze public.vouchers;
analyze public.voucher_lines;
analyze public.stock_lines;
analyze public.invoice_items;
analyze public.voucher_settlements;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-write-query-optimization-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-trigger-rls-optimization-migration.sql
-- =============================================================================
-- Phases 6 and 7: safe trigger and RLS optimization.
-- Apply after the system-group, retained-earnings, cheque-management, and
-- Phase 5 write-query migrations. Safe to run repeatedly.
begin;

-- ---------------------------------------------------------------------------
-- Trigger consolidation
-- ---------------------------------------------------------------------------

-- Two AFTER INSERT company triggers previously called the system-group seed:
-- the retained-ledger helper called it first, then the system-group trigger
-- called it again. Keep the public repair helper self-contained, but route new
-- companies through that complete dependency chain only once.
create or replace function public.ensure_retained_earnings_ledger(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  retained_category_id uuid;
begin
  perform public.ensure_system_account_groups(target_company_id);

  select category.id into retained_category_id
  from public.account_categories category
  where category.company_id = target_company_id
    and category.name = 'Reserves & Surplus'
    and category.account_type = 'Equity'
  limit 1;

  if retained_category_id is null then
    raise exception 'Reserves & Surplus system group is missing for company %', target_company_id;
  end if;

  insert into public.accounts (
    id, company_id, name, type, "group", category_id,
    is_system, is_party, is_archived, opening_balance
  ) values (
    target_company_id::text || ':retained_earnings', target_company_id,
    'Retained Earnings', 'Equity', 'Reserves & Surplus', retained_category_id,
    true, false, false, 0
  )
  on conflict (id) do update set
    name = excluded.name,
    type = excluded.type,
    "group" = excluded."group",
    category_id = excluded.category_id,
    is_system = true,
    is_party = false,
    is_archived = false;
end;
$$;

create or replace function public.seed_system_account_groups_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_retained_earnings_ledger(new.id);
  return new;
end;
$$;

-- Retained earnings is now part of the ordered system-account bootstrap.
drop trigger if exists company_retained_earnings_ledger_seed on public.companies;
drop trigger if exists company_system_account_groups_seed on public.companies;
create trigger company_system_account_groups_seed
after insert on public.companies
for each row execute function public.seed_system_account_groups_for_company();

-- validate_cheque_bank compares lower(bank_name) for every inserted/updated
-- bank. Always index that predicate. Use a unique index when existing data is
-- clean; retain a non-unique lookup index when legacy duplicates exist so this
-- performance migration never deletes, renames, or reassigns cheque data.
do $$
begin
  if exists (
    select 1
    from public.cheque_banks
    group by company_id, lower(bank_name)
    having count(*) > 1
  ) then
    raise notice 'Legacy duplicate issuing-bank names found; creating a non-unique validation lookup index without modifying bank or cheque records.';
    if to_regclass('public.cheque_banks_company_name_ci_unique') is null then
      create index if not exists idx_cheque_banks_company_name_ci
        on public.cheque_banks(company_id, lower(bank_name));
    end if;
  else
    create unique index if not exists cheque_banks_company_name_ci_unique
      on public.cheque_banks(company_id, lower(bank_name));
    drop index if exists public.idx_cheque_banks_company_name_ci;
  end if;
end;
$$;

-- Deliberately retained without semantic changes:
--   voucher_lines_balance_guard is deferred and supports multi-statement SQL.
--   validate_voucher_settlement_trigger protects writes outside the RPC.
--   category hierarchy guards enforce depth/cycle/company/type rules.
--   cheque_touch_guard enforces transitions, entitlement, and account validity.
--   system-category guard prevents protected-group mutation.

-- ---------------------------------------------------------------------------
-- RLS init-plan optimization
-- ---------------------------------------------------------------------------

drop policy if exists "developer_admins_own_select" on public.developer_admins;
create policy "developer_admins_own_select" on public.developer_admins
  for select using (user_id = (select auth.uid()));

drop policy if exists "companies_own" on public.companies;
create policy "companies_own" on public.companies
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "companies_developer_select" on public.companies;
create policy "companies_developer_select" on public.companies
  for select using ((select public.is_developer_admin()));

drop policy if exists "companies_developer_update" on public.companies;
create policy "companies_developer_update" on public.companies
  for update
  using ((select public.is_developer_admin()))
  with check ((select public.is_developer_admin()));

drop policy if exists "companies_developer_delete" on public.companies;
create policy "companies_developer_delete" on public.companies
  for delete using ((select public.is_developer_admin()));

drop policy if exists modules_authenticated_select on public.modules;
create policy modules_authenticated_select on public.modules
  for select to authenticated using (true);

drop policy if exists modules_developer_all on public.modules;
create policy modules_developer_all on public.modules
  for all
  using ((select public.is_developer_admin()))
  with check ((select public.is_developer_admin()));

drop policy if exists company_modules_owner_select on public.company_modules;
create policy company_modules_owner_select on public.company_modules
  for select using (company_id = (select public.my_company_id()));

drop policy if exists company_modules_developer_all on public.company_modules;
create policy company_modules_developer_all on public.company_modules
  for all
  using ((select public.is_developer_admin()))
  with check ((select public.is_developer_admin()));

drop policy if exists company_permissions_own_select on public.company_user_permissions;
create policy company_permissions_own_select on public.company_user_permissions
  for select using (
    company_id = (select public.my_company_id())
    and user_id = (select auth.uid())
  );

drop policy if exists company_permissions_developer_all on public.company_user_permissions;
create policy company_permissions_developer_all on public.company_user_permissions
  for all
  using ((select public.is_developer_admin()))
  with check ((select public.is_developer_admin()));

-- For owner cheque policies, company_id is first constrained to the single
-- authenticated company. Entitlement and permission functions can therefore
-- use that scalar init-plan value once per statement without changing access.
drop policy if exists cheque_banks_read on public.cheque_banks;
create policy cheque_banks_read on public.cheque_banks
  for select using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', false))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.view'))
  );

drop policy if exists cheque_banks_write on public.cheque_banks;
create policy cheque_banks_write on public.cheque_banks
  for all
  using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.manage_banks'))
  )
  with check (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.manage_banks'))
  );

drop policy if exists cheques_read on public.cheques;
create policy cheques_read on public.cheques
  for select using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', false))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.view'))
  );

drop policy if exists cheques_insert on public.cheques;
create policy cheques_insert on public.cheques
  for insert with check (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.create'))
  );

drop policy if exists cheques_update on public.cheques;
create policy cheques_update on public.cheques
  for update
  using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
    and (
      (select public.has_company_permission((select public.my_company_id()), 'cheque.edit'))
      or (select public.has_company_permission((select public.my_company_id()), 'cheque.mark_cleared'))
      or (select public.has_company_permission((select public.my_company_id()), 'cheque.mark_bounced'))
      or (select public.has_company_permission((select public.my_company_id()), 'cheque.cancel'))
    )
  )
  with check (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
  );

drop policy if exists cheque_events_read on public.cheque_events;
create policy cheque_events_read on public.cheque_events
  for select using (
    company_id = (select public.my_company_id())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', false))
    and (select public.has_company_permission((select public.my_company_id()), 'cheque.view'))
  );

drop policy if exists cheque_events_insert on public.cheque_events;
create policy cheque_events_insert on public.cheque_events
  for insert with check (
    company_id = (select public.my_company_id())
    and actor_id = (select auth.uid())
    and (select public.company_module_access((select public.my_company_id()), 'cheque_management', true))
  );

drop policy if exists cheque_events_developer_insert on public.cheque_events;
create policy cheque_events_developer_insert on public.cheque_events
  for insert with check (
    (select public.is_developer_admin())
    and actor_id = (select auth.uid())
  );

drop policy if exists cheque_module_developer_select_banks on public.cheque_banks;
create policy cheque_module_developer_select_banks on public.cheque_banks
  for select using ((select public.is_developer_admin()));

drop policy if exists cheque_module_developer_select_cheques on public.cheques;
create policy cheque_module_developer_select_cheques on public.cheques
  for select using ((select public.is_developer_admin()));

drop policy if exists cheque_module_developer_select_events on public.cheque_events;
create policy cheque_module_developer_select_events on public.cheque_events
  for select using ((select public.is_developer_admin()));

analyze public.cheque_banks;
analyze public.cheques;
analyze public.cheque_events;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-trigger-rls-optimization-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-personal-data-protection-migration.sql
-- =============================================================================
-- Personal-data minimization and self-service account deletion.
-- Apply after the base, master, and cheque-management migrations. Safe to run repeatedly.
begin;

-- Remove full historical record snapshots from audit tables. The UI only uses
-- field names to show what changed, so values are replaced with markers.
create or replace function public.audit_field_markers(payload jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when jsonb_typeof(coalesce(payload, '{}'::jsonb)) <> 'object' then '{}'::jsonb
    else coalesce((
      select jsonb_object_agg(field_name, to_jsonb('[CHANGED]'::text))
      from jsonb_object_keys(payload) field_name
    ), '{}'::jsonb)
  end
$$;

update public.master_change_logs
set old_values = public.audit_field_markers(old_values),
    new_values = public.audit_field_markers(new_values)
where old_values <> public.audit_field_markers(old_values)
   or new_values <> public.audit_field_markers(new_values);

update public.cheque_events
set old_values = public.audit_field_markers(old_values),
    new_values = public.audit_field_markers(new_values)
where old_values <> public.audit_field_markers(old_values)
   or new_values <> public.audit_field_markers(new_values);

-- Remove record identifiers and possible personal text from older operational
-- events. Counts and non-identifying event attributes remain useful.
update public.app_events
set metadata = metadata - array[
  'email','owner_email','phone','address','pan_vat','password','token',
  'access_token','refresh_token','authorization','cookie','party_id','voucher_id'
]
where metadata ?| array[
  'email','owner_email','phone','address','pan_vat','password','token',
  'access_token','refresh_token','authorization','cookie','party_id','voucher_id'
];

update public.app_events
set metadata = jsonb_strip_nulls(jsonb_build_object(
  'source', metadata->'source',
  'path', metadata->'path'
))
where event_type = 'frontend_error';

-- The function executes as its owner because authenticated users cannot and
-- must not receive direct DELETE rights on auth.users. Deleting auth.users
-- cascades to the owned company and all company-scoped accounting/module data.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller_user_id uuid := auth.uid();
begin
  if caller_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Actor references are audit attribution, not ownership. Null them before
  -- deleting the identity so old actions in other companies do not block the
  -- user's deletion request.
  update public.company_modules set enabled_by = null where enabled_by = caller_user_id;
  update public.company_user_permissions set granted_by = null where granted_by = caller_user_id;
  update public.cheque_banks set created_by = null where created_by = caller_user_id;
  update public.cheque_banks set updated_by = null where updated_by = caller_user_id;
  update public.cheques set created_by = null where created_by = caller_user_id;
  update public.cheques set updated_by = null where updated_by = caller_user_id;
  update public.cheque_events set actor_id = null where actor_id = caller_user_id;

  delete from auth.users where id = caller_user_id;
  if not found then
    raise exception 'Authenticated user no longer exists';
  end if;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-personal-data-protection-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-production-security-migration.sql
-- =============================================================================
-- Production error-log access hardening. Safe to run repeatedly.
begin;

-- Retailer sessions may insert their own operational events but cannot read
-- sanitized stack/file details back through PostgREST. Developer
-- administrators retain support access through app_events_developer_select.
drop policy if exists "app_events_own_select" on public.app_events;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-production-security-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-critical-security-hardening-migration.sql
-- =============================================================================
-- Critical-path authorization and accounting-integrity hardening.
-- Apply after all existing schema, cheque, retained-earnings, and atomic
-- voucher migrations. Safe to run repeatedly.
begin;

-- Tenant users may edit company presentation/accounting settings, but plan,
-- support, ownership, and suspension are developer-controlled security data.
create or replace function public.protect_company_control_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_developer_admin() then return new; end if;

  if nullif(btrim(coalesce(new.logo_url, '')), '') is not null
    and (length(new.logo_url) > 2048 or new.logo_url !~ '^https://') then
    raise exception 'Company logo must use an HTTPS URL'
      using errcode = '22023';
  end if;

  -- A tenant may refresh the cached owner email only from the authenticated
  -- JWT. It may not use this presentation column to impersonate another
  -- owner in the developer dashboard.
  if new.owner_email is distinct from old.owner_email
    and new.owner_email is distinct from nullif(auth.jwt()->>'email', '') then
    raise exception 'Company owner email must match the authenticated user'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.plan_status is distinct from old.plan_status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.support_status is distinct from old.support_status
    or new.developer_notes is distinct from old.developer_notes
    or new.suspended is distinct from old.suspended then
    raise exception 'Developer-controlled company fields cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists company_control_fields_guard on public.companies;
create trigger company_control_fields_guard
before update on public.companies
for each row execute function public.protect_company_control_fields();

-- Legacy trials predated enforced expiry. Give each one the originally
-- intended fourteen-day period from company creation; developer admins can
-- extend or convert the plan before applying this migration when appropriate.
update public.companies
set trial_ends_at = created_at::date + 14
where plan_status = 'trial' and trial_ends_at is null;

-- UI route guards are not an authorization boundary. This trigger blocks a
-- suspended tenant's direct PostgREST/RPC writes as well. Service operations
-- with no end-user JWT and developer admins remain available for maintenance.
create or replace function public.enforce_tenant_write_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  owner_id uuid;
  company_suspended boolean;
  company_plan_status text;
  company_trial_ends_at date;
begin
  if auth.uid() is null or public.is_developer_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_argv[0] = 'company' then
    target_company := case when tg_op = 'DELETE' then old.id else new.id end;
    if tg_op = 'INSERT' then
      -- The company row is not visible yet in a BEFORE INSERT trigger. Check
      -- ownership and developer-controlled defaults directly on NEW.
      if new.user_id is distinct from auth.uid()
        or new.plan_status is distinct from 'trial'
        or new.trial_ends_at is not null
        or new.support_status is distinct from 'normal'
        or new.developer_notes is not null
        or coalesce(new.suspended, false) then
        raise exception 'New company security fields are invalid'
          using errcode = '42501';
      end if;
      if new.owner_email is not null
        and new.owner_email is distinct from nullif(auth.jwt()->>'email', '') then
        raise exception 'Company owner email must match the authenticated user'
          using errcode = '42501';
      end if;
      if nullif(btrim(coalesce(new.logo_url, '')), '') is not null
        and (length(new.logo_url) > 2048 or new.logo_url !~ '^https://') then
        raise exception 'Company logo must use an HTTPS URL'
          using errcode = '22023';
      end if;
      new.trial_ends_at := current_date + 14;
      return new;
    end if;
  elsif tg_argv[0] = 'voucher_child' then
    select voucher.company_id into target_company
    from public.vouchers voucher
    where voucher.id = case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  else
    target_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  end if;

  -- Parent rows can already be invisible to a trigger reached through an
  -- authorized ON DELETE CASCADE. A dangling child cannot be created because
  -- the foreign keys remain enforced, so this exception is delete-only.
  if target_company is null and tg_op = 'DELETE' then
    return old;
  end if;

  select company.user_id, company.suspended, company.plan_status, company.trial_ends_at
    into owner_id, company_suspended, company_plan_status, company_trial_ends_at
  from public.companies company
  where company.id = target_company;

  if owner_id is distinct from auth.uid() then
    raise exception 'Company write access denied' using errcode = '42501';
  end if;

  -- Owners must still be able to delete their account/company data.
  if (coalesce(company_suspended, false)
      or company_plan_status = 'expired'
      or (company_plan_status = 'trial' and company_trial_ends_at is not null
        and current_date > company_trial_ends_at))
    and not (tg_argv[0] = 'company' and tg_op = 'DELETE') then
    raise exception 'Company plan is inactive and is read-only' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts','account_categories','parties','items','item_categories',
    'master_change_logs','vouchers','voucher_settlements','app_events',
    'cheque_banks','cheques','cheque_events'
  ] loop
    execute format('drop trigger if exists tenant_write_access_guard on public.%I', table_name);
    execute format(
      'create trigger tenant_write_access_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write_access(%L)',
      table_name, 'direct'
    );
  end loop;

  foreach table_name in array array['voucher_lines','stock_lines','invoice_items'] loop
    execute format('drop trigger if exists tenant_write_access_guard on public.%I', table_name);
    execute format(
      'create trigger tenant_write_access_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write_access(%L)',
      table_name, 'voucher_child'
    );
  end loop;
end;
$$;

drop trigger if exists tenant_write_access_guard on public.companies;
create trigger tenant_write_access_guard
before insert or update or delete on public.companies
for each row execute function public.enforce_tenant_write_access('company');

-- Foreign keys guarantee existence, not tenant ownership. Validate master
-- references and numeric bounds independently of the browser forms.
create or replace function public.validate_tenant_master_record()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'accounts' then
    if length(btrim(new.name)) < 1 or length(new.name) > 200 then
      raise exception 'Account name must contain 1 to 200 characters';
    end if;
    if new.category_id is not null and not exists (
      select 1 from public.account_categories category
      where category.id = new.category_id
        and category.company_id = new.company_id
        and category.account_type = new.type
        and category.name = new."group"
    ) then raise exception 'Account category must belong to the company and match its type'; end if;
  elsif tg_table_name = 'parties' then
    if length(btrim(new.name)) < 1 or length(new.name) > 200
      or length(coalesce(new.phone, '')) > 50
      or length(coalesce(new.pan_vat, '')) > 100
      or length(coalesce(new.address, '')) > 1000 then
      raise exception 'Party field length is invalid';
    end if;
    if coalesce(new.default_credit_days, 0) < 0 or coalesce(new.default_credit_days, 0) > 36500 then
      raise exception 'Party credit days are outside the valid range';
    end if;
    if not exists (
      select 1 from public.accounts account
      where account.id = new.account_id and account.company_id = new.company_id
        and account.is_party
    ) then raise exception 'Party ledger must belong to the company'; end if;
  elsif tg_table_name = 'items' then
    if length(btrim(new.name)) < 1 or length(new.name) > 200
      or length(btrim(new.unit)) < 1 or length(new.unit) > 50
      or length(coalesce(new.alternate_unit, '')) > 50
      or length(coalesce(new.sku, '')) > 100
      or length(coalesce(new.barcode, '')) > 100 then
      raise exception 'Item field length is invalid';
    end if;
    if new.sell_rate < 0 or new.opening_qty < 0 or new.opening_rate < 0
      or coalesce(new.reorder_level, 0) < 0 then
      raise exception 'Item rates, opening stock and reorder level cannot be negative';
    end if;
    if (new.alternate_unit is null) <> (new.alternate_conversion is null)
      or (new.alternate_unit is not null and (
        new.alternate_conversion <= 1
        or lower(btrim(new.alternate_unit)) = lower(btrim(new.unit)))) then
      raise exception 'Alternative item unit configuration is invalid';
    end if;
    if new.category_id is not null and not exists (
      select 1 from public.item_categories category
      where category.id = new.category_id and category.company_id = new.company_id
    ) then raise exception 'Item category must belong to the company'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_master_record_guard on public.accounts;
create trigger tenant_master_record_guard before insert or update on public.accounts
for each row execute function public.validate_tenant_master_record();
drop trigger if exists tenant_master_record_guard on public.parties;
create trigger tenant_master_record_guard before insert or update on public.parties
for each row execute function public.validate_tenant_master_record();
drop trigger if exists tenant_master_record_guard on public.items;
create trigger tenant_master_record_guard before insert or update on public.items
for each row execute function public.validate_tenant_master_record();

-- Independently derive and verify financial totals at transaction end. This
-- prevents a modified browser request from posting a balanced ledger while
-- supplying false invoice subtotal, discount, VAT, or total fields.
create or replace function public.validate_voucher_financial_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_voucher_id uuid;
  voucher_record public.vouchers%rowtype;
  line_count integer;
  item_count integer;
  debit_total numeric;
  credit_total numeric;
  calculated_subtotal numeric;
  calculated_discount numeric;
  calculated_taxable numeric;
  calculated_vat numeric;
  calculated_total numeric;
  expected_discount numeric;
  source_voucher public.vouchers%rowtype;
begin
  -- The header table has `id`; child tables have `voucher_id`. Branch on the
  -- table before touching OLD/NEW so PostgreSQL never resolves a field that
  -- does not exist on that trigger row type.
  if tg_table_name = 'vouchers' then
    target_voucher_id := case when tg_op = 'DELETE' then old.id else new.id end;
  elsif tg_op = 'DELETE' then
    target_voucher_id := old.voucher_id;
  else
    target_voucher_id := new.voucher_id;
  end if;

  select * into voucher_record from public.vouchers where id = target_voucher_id;
  if not found then return null; end if;

  select count(*),
         coalesce(sum(coalesce(line.debit, 0)), 0),
         coalesce(sum(coalesce(line.credit, 0)), 0)
    into line_count, debit_total, credit_total
  from public.voucher_lines line
  where line.voucher_id = target_voucher_id;

  if exists (
    select 1 from public.voucher_lines line
    where line.voucher_id = target_voucher_id
      and (coalesce(line.debit, 0) < 0 or coalesce(line.credit, 0) < 0
        or (coalesce(line.debit, 0) > 0 and coalesce(line.credit, 0) > 0))
  ) then raise exception 'Voucher lines must contain one non-negative debit or credit'; end if;

  if abs(debit_total - credit_total) > 0.01 then
    raise exception 'Voucher debit and credit totals do not match';
  end if;

  if exists (
    select 1
    from public.voucher_lines line
    left join public.accounts account
      on account.id = line.account_id
     and account.company_id = voucher_record.company_id
    where line.voucher_id = target_voucher_id and account.id is null
  ) then raise exception 'Voucher ledger belongs to another company'; end if;

  if exists (
    select 1
    from public.invoice_items invoice_item
    left join public.items item
      on item.id = invoice_item.item_id
     and item.company_id = voucher_record.company_id
    where invoice_item.voucher_id = target_voucher_id and item.id is null
  ) or exists (
    select 1
    from public.stock_lines stock_line
    left join public.items item
      on item.id = stock_line.item_id
     and item.company_id = voucher_record.company_id
    where stock_line.voucher_id = target_voucher_id and item.id is null
  ) then raise exception 'Voucher item belongs to another company'; end if;

  if exists (
    select 1 from public.stock_lines stock_line
    where stock_line.voucher_id = target_voucher_id
      and (stock_line.qty <= 0 or stock_line.rate < 0)
  ) then raise exception 'Stock movements require positive quantities and non-negative rates'; end if;

  if voucher_record.party_account_id is not null and not exists (
    select 1 from public.accounts account
    where account.id = voucher_record.party_account_id
      and account.company_id = voucher_record.company_id
  ) then raise exception 'Voucher party ledger belongs to another company'; end if;

  if voucher_record.settlement_account_id is not null and not exists (
    select 1 from public.accounts account
    where account.id = voucher_record.settlement_account_id
      and account.company_id = voucher_record.company_id
  ) then raise exception 'Voucher settlement ledger belongs to another company'; end if;

  if voucher_record.original_voucher_id is not null and not exists (
    select 1 from public.vouchers original
    where original.id = voucher_record.original_voucher_id
      and original.company_id = voucher_record.company_id
  ) then raise exception 'Original voucher belongs to another company'; end if;

  if voucher_record.cancelled and exists (
    select 1 from public.vouchers return_voucher
    where return_voucher.original_voucher_id = target_voucher_id
      and return_voucher.company_id = voucher_record.company_id
      and not return_voucher.cancelled
  ) then raise exception 'Cancel linked return vouchers before cancelling the original invoice'; end if;

  if voucher_record.cancelled and exists (
    select 1 from public.cheques cheque
    where cheque.linked_voucher_id = target_voucher_id
      and cheque.company_id = voucher_record.company_id
      and cheque.status = 'cleared'
  ) then raise exception 'A Receipt linked to a cleared cheque cannot be cancelled'; end if;

  if voucher_record.type <> 'Stock Adjustment' then
    if line_count < 2 then raise exception 'Posted vouchers require at least two ledger lines'; end if;
    if abs(coalesce(voucher_record.total, 0) - debit_total) > 0.01 then
      raise exception 'Voucher total does not match its ledger posting';
    end if;
    if voucher_record.type in ('Receipt','Payment','Journal')
      and coalesce(voucher_record.total, 0) <= 0 then
      raise exception 'Voucher total must be greater than zero';
    end if;
  end if;

  if length(coalesce(voucher_record.narration, '')) > 4000
    or length(coalesce(voucher_record.return_reason, '')) > 2000
    or length(coalesce(voucher_record.invoice_no, '')) > 100 then
    raise exception 'Voucher text exceeds the allowed length';
  end if;

  if voucher_record.type in ('Sales','Purchase','Sales Return','Purchase Return') then
    select count(*),
           coalesce(sum(round(item.qty * item.rate, 2)), 0),
           coalesce(sum(coalesce(item.discount_amount, 0)), 0),
           coalesce(sum(coalesce(item.taxable_amount, round(item.qty * item.rate, 2))), 0),
           coalesce(sum(coalesce(item.vat_amount, 0)), 0)
      into item_count, calculated_subtotal, calculated_discount,
           calculated_taxable, calculated_vat
    from public.invoice_items item
    where item.voucher_id = target_voucher_id;

    if item_count = 0 or exists (
      select 1 from public.invoice_items item
      where item.voucher_id = target_voucher_id
        and (item.qty <= 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0
          or (item.base_qty is not null and abs(item.base_qty - item.qty * coalesce(item.conversion_factor, 1)) > 0.0001))
    ) then raise exception 'Invoice items require positive quantities and non-negative rates'; end if;

    if voucher_record.type in ('Sales','Purchase') then
      calculated_discount := coalesce(voucher_record.discount, 0);
      if calculated_discount < 0 or calculated_discount > calculated_subtotal then
        raise exception 'Invoice discount is outside the valid range';
      end if;
      calculated_taxable := round(calculated_subtotal - calculated_discount, 2);
      if coalesce(voucher_record.vat_rate, 0) < 0 or coalesce(voucher_record.vat_rate, 0) > 100 then
        raise exception 'VAT rate is outside the valid range';
      end if;
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 2);
    else
      if calculated_discount < 0 or calculated_discount > calculated_subtotal then
        raise exception 'Return discount is outside the valid range';
      end if;
      if abs(calculated_taxable - round(calculated_subtotal - calculated_discount, 2)) > 0.01 then
        raise exception 'Return taxable amounts are inconsistent';
      end if;
      if coalesce(voucher_record.vat_rate, 0) < 0 or coalesce(voucher_record.vat_rate, 0) > 100 then
        raise exception 'Return VAT rate is outside the valid range';
      end if;
      if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 2)) > 0.01 then
        raise exception 'Return VAT does not match server-calculated VAT';
      end if;
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 2);
      if voucher_record.original_voucher_id is null and calculated_discount <> 0 then
        raise exception 'A manual return cannot introduce an invoice discount';
      end if;
    end if;

    calculated_total := round(calculated_taxable + calculated_vat, 2);
    if abs(coalesce(voucher_record.subtotal, 0) - calculated_subtotal) > 0.01
      or abs(coalesce(voucher_record.discount, 0) - calculated_discount) > 0.01
      or abs(coalesce(voucher_record.vat_amount, 0) - calculated_vat) > 0.01
      or abs(coalesce(voucher_record.total, 0) - calculated_total) > 0.01 then
      raise exception 'Invoice totals do not match server-calculated values';
    end if;

    if voucher_record.type = 'Sales Return' and not coalesce(voucher_record.restock_items, false) then
      if exists (select 1 from public.stock_lines where voucher_id = target_voucher_id) then
        raise exception 'A non-restocked sales return cannot create stock movements';
      end if;
    else
      if exists (
        with invoice_quantity as (
          select invoice_item.item_id,
                 sum(coalesce(invoice_item.base_qty,
                   invoice_item.qty * coalesce(invoice_item.conversion_factor, 1))) as qty
          from public.invoice_items invoice_item
          where invoice_item.voucher_id = target_voucher_id
          group by invoice_item.item_id
        ), movement_quantity as (
          select stock_line.item_id, sum(stock_line.qty) as qty
          from public.stock_lines stock_line
          where stock_line.voucher_id = target_voucher_id
            and stock_line.direction = case
              when voucher_record.type in ('Purchase','Sales Return') then 'in'
              else 'out'
            end
          group by stock_line.item_id
        )
        select 1
        from invoice_quantity invoice
        full join movement_quantity movement using (item_id)
        where invoice.item_id is null or movement.item_id is null
          or abs(invoice.qty - movement.qty) > 0.0001
      ) or exists (
        select 1 from public.stock_lines stock_line
        where stock_line.voucher_id = target_voucher_id
          and stock_line.direction <> case
            when voucher_record.type in ('Purchase','Sales Return') then 'in'
            else 'out'
          end
      ) then raise exception 'Invoice stock movements do not match invoice item quantities'; end if;
    end if;
  end if;

  if voucher_record.type in ('Sales Return','Purchase Return')
    and voucher_record.original_voucher_id is not null then
    if not exists (
      select 1 from public.vouchers original
      where original.id = voucher_record.original_voucher_id
        and original.company_id = voucher_record.company_id
        and not original.cancelled
        and original.type = case when voucher_record.type = 'Sales Return' then 'Sales' else 'Purchase' end
    ) then raise exception 'Return source invoice is invalid'; end if;

    select * into source_voucher
    from public.vouchers original
    where original.id = voucher_record.original_voucher_id;

    if coalesce(voucher_record.vat_rate, 0) is distinct from coalesce(source_voucher.vat_rate, 0) then
      raise exception 'Return VAT rate must match the source invoice';
    end if;

    expected_discount := case
      when coalesce(source_voucher.subtotal, 0) > 0
        then round(coalesce(source_voucher.discount, 0) * calculated_subtotal / source_voucher.subtotal, 2)
      else 0
    end;
    if abs(calculated_discount - expected_discount) > greatest(0.02, item_count * 0.01) then
      raise exception 'Return discount does not match the source invoice allocation';
    end if;

    if exists (
      select 1
      from public.invoice_items returned
      left join public.invoice_items source
        on source.id = returned.source_invoice_item_id
       and source.voucher_id = voucher_record.original_voucher_id
      where returned.voucher_id = target_voucher_id
        and (source.id is null or source.item_id is distinct from returned.item_id
          or abs(source.rate - returned.rate) > 0.01)
    ) then raise exception 'Returned item does not match its source invoice'; end if;

    if exists (
      select 1
      from public.invoice_items source
      join public.invoice_items returned on returned.source_invoice_item_id = source.id
      join public.vouchers return_voucher on return_voucher.id = returned.voucher_id
      where source.voucher_id = voucher_record.original_voucher_id
        and not return_voucher.cancelled
      group by source.id, source.qty
      having sum(returned.qty) > source.qty + 0.0001
    ) then raise exception 'Return quantity exceeds the source invoice quantity'; end if;
  end if;

  return null;
end;
$$;

drop trigger if exists voucher_financial_integrity_header on public.vouchers;
create constraint trigger voucher_financial_integrity_header
after insert or update on public.vouchers
deferrable initially deferred for each row
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_lines on public.voucher_lines;
create constraint trigger voucher_financial_integrity_lines
after insert or update or delete on public.voucher_lines
deferrable initially deferred for each row
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_items on public.invoice_items;
create constraint trigger voucher_financial_integrity_items
after insert or update or delete on public.invoice_items
deferrable initially deferred for each row
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_stock on public.stock_lines;
create constraint trigger voucher_financial_integrity_stock
after insert or update or delete on public.stock_lines
deferrable initially deferred for each row
execute function public.validate_voucher_financial_integrity();

-- A cleared received cheque is only valid when it points to one matching,
-- active Receipt voucher. This prevents a caller from marking a cheque as
-- cleared through the Data API without creating the accounting entry.
do $$
begin
  if exists (
    select 1 from public.cheques
    where linked_voucher_id is not null
    group by linked_voucher_id having count(*) > 1
  ) then
    raise exception 'Duplicate cheque receipt links exist; resolve them before applying security hardening';
  end if;
end;
$$;

create unique index if not exists cheques_linked_receipt_unique
  on public.cheques(linked_voucher_id)
  where linked_voucher_id is not null;

create or replace function public.validate_cleared_cheque_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  receipt public.vouchers%rowtype;
  destination_debit numeric;
  party_credit numeric;
begin
  if new.status <> 'cleared' then
    if new.linked_voucher_id is not null or new.cleared_to_account_id is not null then
      raise exception 'Only cleared cheques may link a receipt voucher';
    end if;
    return null;
  end if;

  if new.linked_voucher_id is null then
    raise exception 'A cleared cheque requires a linked Receipt voucher';
  end if;

  select * into receipt
  from public.vouchers voucher
  where voucher.id = new.linked_voucher_id
    and voucher.company_id = new.company_id
    and voucher.type = 'Receipt'
    and not voucher.cancelled;

  if not found or receipt.party_account_id is distinct from new.party_ledger_id
    or receipt.total is distinct from new.amount
    or receipt.settlement_account_id is null then
    raise exception 'Linked Receipt does not match the cleared cheque';
  end if;

  select coalesce(sum(line.debit), 0) into destination_debit
  from public.voucher_lines line
  where line.voucher_id = receipt.id
    and line.account_id = receipt.settlement_account_id;

  select coalesce(sum(line.credit), 0) into party_credit
  from public.voucher_lines line
  where line.voucher_id = receipt.id
    and line.account_id = new.party_ledger_id;

  if abs(destination_debit - new.amount) > 0.01
    or abs(party_credit - new.amount) > 0.01 then
    raise exception 'Linked Receipt posting does not match the cleared cheque amount';
  end if;
  return null;
end;
$$;

drop trigger if exists cleared_cheque_receipt_guard on public.cheques;
create constraint trigger cleared_cheque_receipt_guard
after insert or update on public.cheques
deferrable initially deferred for each row
execute function public.validate_cleared_cheque_receipt();

-- Internal SECURITY DEFINER maintenance helpers are trigger/migration entry
-- points, not public APIs. PostgreSQL grants function EXECUTE to PUBLIC by
-- default, so revoke it explicitly to prevent cross-tenant seeding calls.
revoke all on function public.ensure_system_account_groups(uuid) from public, anon, authenticated;
revoke all on function public.ensure_retained_earnings_ledger(uuid) from public, anon, authenticated;
revoke all on function public.seed_nepal_cheque_banks(uuid) from public, anon, authenticated;
revoke all on function public.seed_cheque_banks_on_entitlement() from public, anon, authenticated;
revoke all on function public.seed_system_account_groups_for_company() from public, anon, authenticated;
revoke all on function public.protect_system_account_category() from public, anon, authenticated;
revoke all on function public.protect_company_control_fields() from public, anon, authenticated;
revoke all on function public.enforce_tenant_write_access() from public, anon, authenticated;
revoke all on function public.validate_cheque_bank() from public, anon, authenticated;
revoke all on function public.cheque_touch_and_audit() from public, anon, authenticated;
revoke all on function public.validate_cleared_cheque_receipt() from public, anon, authenticated;
revoke all on function public.validate_voucher_financial_integrity() from public, anon, authenticated;
revoke all on function public.validate_tenant_master_record() from public, anon, authenticated;

revoke all on function public.is_developer_admin() from public, anon;
grant execute on function public.is_developer_admin() to authenticated;
revoke all on function public.get_developer_schema_status() from public, anon;
grant execute on function public.get_developer_schema_status() to authenticated;
revoke all on function public.has_company_permission(uuid,text) from public, anon;
grant execute on function public.has_company_permission(uuid,text) to authenticated;
revoke all on function public.company_module_access(uuid,text,boolean) from public, anon;
grant execute on function public.company_module_access(uuid,text,boolean) to authenticated;

-- No application table is needed before authentication. RLS remains enabled
-- as the primary boundary, and explicit anon revocation reduces the exposed
-- surface further if a future policy is accidentally made permissive.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-critical-security-hardening-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-developer-error-log-cleanup-migration.sql
-- =============================================================================
-- Developer-only cleanup for handled frontend error records.
-- Normal audit and activity events are deliberately preserved.
begin;

create or replace function public.clear_frontend_error_logs(
  target_company_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  if not public.is_developer_admin() then
    raise exception 'Developer administrator access required'
      using errcode = '42501';
  end if;

  delete from public.app_events event
  where event.event_type = 'frontend_error'
    and (target_company_id is null or event.company_id = target_company_id);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.clear_frontend_error_logs(uuid) from public;
grant execute on function public.clear_frontend_error_logs(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-developer-error-log-cleanup-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-financial-year-control-migration.sql
-- =============================================================================
-- Canonical company financial-year setup and posting safeguards.
-- Existing companies are treated as configured; new companies must confirm
-- their Financial Year and books start date before the first transaction.
begin;

alter table public.companies
  add column if not exists fiscal_year_configured boolean not null default false;

-- Fiscal-year voucher numbering is mandatory for every company. Repair
-- existing opt-outs first, then enforce the rule for both inserts and updates.
alter table public.companies
  alter column reset_numbering_fiscal_year set default true;

update public.companies
set reset_numbering_fiscal_year = true
where not reset_numbering_fiscal_year;

alter table public.companies
  drop constraint if exists companies_fiscal_numbering_required;
alter table public.companies
  add constraint companies_fiscal_numbering_required
  check (reset_numbering_fiscal_year);

-- Companies that already posted transactions necessarily operated with their
-- stored start date, so preserve them as configured. Empty/new companies must
-- explicitly confirm the setup in Settings.
update public.companies company
set fiscal_year_configured = true
where not company.fiscal_year_configured
  and exists (
    select 1 from public.vouchers voucher
    where voucher.company_id = company.id
  );

create or replace function public.protect_company_financial_year()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.fiscal_year_configured and not new.fiscal_year_configured then
    raise exception 'Financial Year setup cannot be removed';
  end if;

  if new.fiscal_year_start is distinct from old.fiscal_year_start
    and exists (
      select 1 from public.vouchers voucher
      where voucher.company_id = old.id
      limit 1
    ) then
    raise exception 'Financial Year Start Date is locked after the first transaction';
  end if;

  return new;
end;
$$;

drop trigger if exists company_financial_year_guard on public.companies;
create trigger company_financial_year_guard
before update of fiscal_year_start, fiscal_year_configured on public.companies
for each row execute function public.protect_company_financial_year();

create or replace function public.validate_voucher_financial_year()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  company_start date;
  company_configured boolean;
begin
  select company.fiscal_year_start, company.fiscal_year_configured
    into company_start, company_configured
  from public.companies company
  where company.id = new.company_id;

  if not found then
    raise exception 'Voucher company does not exist';
  end if;
  if not company_configured then
    raise exception 'Complete Financial Year setup before posting transactions';
  end if;
  if coalesce(new.date_ad, new.date) < company_start then
    raise exception 'Voucher date cannot be before the company Financial Year Start Date %', company_start;
  end if;
  if coalesce(new.date_ad, new.date) > current_date then
    raise exception 'Voucher date cannot be in a future financial period';
  end if;

  return new;
end;
$$;

drop trigger if exists voucher_financial_year_guard on public.vouchers;
create trigger voucher_financial_year_guard
before insert or update of company_id, date, date_ad on public.vouchers
for each row execute function public.validate_voucher_financial_year();

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-financial-year-control-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-zero-value-invoices-migration.sql
-- =============================================================================
-- Allow zero-value Sales, Purchase, Sales Return, and Purchase Return
-- documents while keeping item and positive-quantity validation compulsory.
-- Apply after supabase-critical-security-hardening-migration.sql.
-- Safe to run repeatedly.
begin;

do $migration$
declare
  current_definition text;
  updated_definition text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into current_definition;

  if current_definition is null then
    raise exception 'validate_voucher_financial_integrity() is missing; apply the critical security hardening migration first';
  end if;

  updated_definition := replace(
    current_definition,
    'voucher_record.type in (''Receipt'',''Payment'',''Journal'',''Sales Return'',''Purchase Return'')',
    'voucher_record.type in (''Receipt'',''Payment'',''Journal'')'
  );
  updated_definition := replace(
    updated_definition,
    'item.qty <= 0 or item.rate <= 0 or coalesce(item.conversion_factor, 1) <= 0',
    'item.qty <= 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require positive quantities and valid rates',
    'Invoice items require positive quantities and non-negative rates'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
      'voucher_record.type in (''Receipt'',''Payment'',''Journal'')'
      in current_definition
    ) = 0 or position(
      'item.qty <= 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0'
      in current_definition
    ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-zero-value-invoices-migration.sql


-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-journal-supplier-invoice-migration.sql
-- =============================================================================
-- Journal numbering preference and supplier physical invoice references.
-- Apply after supabase-atomic-voucher-posting-migration.sql.
-- Safe to run repeatedly.
begin;

alter table public.companies
  add column if not exists journal_numbering_mode text not null default 'auto';
alter table public.companies
  drop constraint if exists companies_journal_numbering_mode_check;
alter table public.companies
  add constraint companies_journal_numbering_mode_check
  check (journal_numbering_mode in ('auto', 'manual'));

alter table public.vouchers
  add column if not exists supplier_invoice_no text;
alter table public.vouchers
  drop constraint if exists vouchers_supplier_invoice_no_length_check;
alter table public.vouchers
  add constraint vouchers_supplier_invoice_no_length_check
  check (supplier_invoice_no is null or char_length(supplier_invoice_no) <= 100);

create or replace function public.save_voucher_with_document_metadata_atomic(
  p_voucher jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_stock_lines jsonb default '[]'::jsonb,
  p_invoice_items jsonb default '[]'::jsonb,
  p_settlements jsonb default '[]'::jsonb,
  p_voucher_id uuid default null,
  p_invoice_prefix text default null,
  p_reset_numbering boolean default false,
  p_period_start_key integer default null,
  p_next_period_start_key integer default null,
  p_audit_event_type text default null,
  p_audit_metadata jsonb default '{}'::jsonb,
  p_manual_invoice_no text default null,
  p_supplier_invoice_no text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
  saved_id uuid;
  saved_type text;
  saved_company_id uuid;
  journal_mode text;
  normalized_manual_number text := nullif(btrim(coalesce(p_manual_invoice_no, '')), '');
  normalized_supplier_number text := nullif(btrim(coalesce(p_supplier_invoice_no, '')), '');
  final_invoice_number text;
begin
  if normalized_manual_number is not null and char_length(normalized_manual_number) > 100 then
    raise exception 'Journal voucher number cannot exceed 100 characters';
  end if;
  if normalized_supplier_number is not null and char_length(normalized_supplier_number) > 100 then
    raise exception 'Supplier invoice number cannot exceed 100 characters';
  end if;

  result := public.save_voucher_atomic(
    p_voucher, p_lines, p_stock_lines, p_invoice_items, p_settlements,
    p_voucher_id, p_invoice_prefix, p_reset_numbering,
    p_period_start_key, p_next_period_start_key,
    p_audit_event_type, p_audit_metadata
  );

  saved_id := (result->>'id')::uuid;
  saved_type := result->>'type';
  saved_company_id := (result->>'company_id')::uuid;

  select company.journal_numbering_mode
    into journal_mode
  from public.companies company
  where company.id = saved_company_id;

  if saved_type = 'Journal' and coalesce(journal_mode, 'auto') = 'manual' then
    if normalized_manual_number is null then
      raise exception 'Enter the Journal voucher number';
    end if;
    update public.vouchers
    set invoice_no = normalized_manual_number
    where id = saved_id and company_id = saved_company_id;
  elsif saved_type <> 'Journal' and normalized_manual_number is not null then
    raise exception 'Manual voucher numbers are supported only for Journal vouchers';
  end if;

  if saved_type = 'Purchase' then
    update public.vouchers
    set supplier_invoice_no = normalized_supplier_number
    where id = saved_id and company_id = saved_company_id;
  elsif normalized_supplier_number is not null then
    raise exception 'Supplier invoice number is supported only for Purchase vouchers';
  end if;

  select voucher.invoice_no
    into final_invoice_number
  from public.vouchers voucher
  where voucher.id = saved_id and voucher.company_id = saved_company_id;

  return result || jsonb_build_object(
    'invoice_no', final_invoice_number,
    'supplier_invoice_no', case when saved_type = 'Purchase' then normalized_supplier_number else null end
  );
end;
$$;

revoke all on function public.save_voucher_with_document_metadata_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text) from public;
grant execute on function public.save_voucher_with_document_metadata_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text) to authenticated;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-journal-supplier-invoice-migration.sql

-- =============================================================================
-- FINAL BOOTSTRAP VERIFICATION AND PERMISSION CLEANUP
-- =============================================================================

revoke all on function public.protect_company_financial_year() from public, anon, authenticated;
revoke all on function public.validate_voucher_financial_year() from public, anon, authenticated;

do $bootstrap_verification$
declare
  required_table text;
  table_oid regclass;
  rls_enabled boolean;
begin
  foreach required_table in array array[
    'developer_admins', 'companies', 'accounts', 'parties', 'items',
    'account_categories', 'item_categories', 'master_change_logs',
    'vouchers', 'voucher_lines', 'stock_lines', 'invoice_items',
    'voucher_settlements', 'app_events', 'modules', 'company_modules',
    'company_user_permissions', 'cheque_banks', 'cheques', 'cheque_events'
  ] loop
    table_oid := to_regclass('public.' || required_table);
    if table_oid is null then
      raise exception 'Bootstrap verification failed: missing table public.%', required_table;
    end if;
    select class.relrowsecurity into rls_enabled
    from pg_class class where class.oid = table_oid;
    if not coalesce(rls_enabled, false) then
      raise exception 'Bootstrap verification failed: RLS is disabled on public.%', required_table;
    end if;
  end loop;

  if to_regprocedure('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)') is null then
    raise exception 'Bootstrap verification failed: save_voucher_atomic() is missing';
  end if;
  if to_regprocedure('public.save_voucher_with_document_metadata_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text)') is null then
    raise exception 'Bootstrap verification failed: document metadata voucher RPC is missing';
  end if;
  if to_regprocedure('public.ensure_system_account_groups(uuid)') is null
    or to_regprocedure('public.ensure_retained_earnings_ledger(uuid)') is null then
    raise exception 'Bootstrap verification failed: system account bootstrap functions are missing';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'journal_numbering_mode')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'fiscal_year_configured')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'supplier_invoice_no') then
    raise exception 'Bootstrap verification failed: current release columns are missing';
  end if;
end;
$bootstrap_verification$;

notify pgrst, 'reload schema';

select 'KhataERP complete staging bootstrap applied successfully' as result,
       current_timestamp as completed_at;
