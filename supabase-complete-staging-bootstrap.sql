-- KhataERP complete staging database bootstrap
-- Synchronized with the base schema and every migration in supabase/migrations on 2026-08-31.
-- Run this entire file once in the Supabase SQL Editor using the postgres role.
-- Do not run individual migrations after applying this bootstrap.
--
-- Migration coverage:
-- Base-integrated: 202608140001 through 202608160008. Their final schema and
-- function definitions are folded into the base sections below so older
-- definitions never overwrite later fixes.
-- Verbatim ordered sections: 202608170001, 202608170002, 202608170003,
-- 202608170004, 202608170005, 202608170006, 202608180001, 202608180002,
-- 202608180003, and 202608310001.

-- =============================================================================

-- BEGIN SYNCED DB FILE: supabase-schema.sql
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
--  Khata ERP â€” Supabase Schema
--  Run this entire file in your Supabase project's SQL Editor.
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- â”€â”€ Extensions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create extension if not exists "uuid-ossp";

-- â”€â”€ Developer Admins â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'show_company_details_on_sales_invoice')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'payment_qr_url')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'logo_url')
                   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'enforce_sales_invoice_chronology')
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
    'status', case when (
                     exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_developer_all')
                     or (
                       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_developer_select')
                       and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_developer_delete')
                     )
                   )
                   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_events' and policyname = 'app_events_developer_select')
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

-- â”€â”€ Companies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  allow_admin_chronological_bypass boolean not null default false,
  enforce_sales_invoice_chronology boolean not null default false,
  print_format     text not null default 'A5' check (print_format in ('A5','A4')),
  show_company_details_on_sales_invoice boolean not null default true,
  invoice_terms    text,
  payment_qr_text  text,
  payment_qr_url   text,
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

-- Multiple companies per user are supported through company_members.
drop index if exists companies_user_id_unique;

alter table companies add column if not exists owner_email text;
alter table companies add column if not exists phone text;
update companies set phone = null where phone is not null and btrim(phone) !~ '^[0-9]{10}$';
update companies set pan_vat = null where pan_vat is not null and btrim(pan_vat) !~ '^[0-9]{9}$';
update companies set phone = btrim(phone), pan_vat = btrim(pan_vat);
alter table companies drop constraint if exists companies_identity_phone_check;
alter table companies add constraint companies_identity_phone_check check (phone is null or phone ~ '^[0-9]{10}$');
alter table companies drop constraint if exists companies_identity_pan_check;
alter table companies add constraint companies_identity_pan_check check (pan_vat is null or pan_vat ~ '^[0-9]{9}$');
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
alter table companies add column if not exists allow_admin_chronological_bypass boolean not null default false;
alter table companies add column if not exists enforce_sales_invoice_chronology boolean not null default false;
alter table companies add column if not exists print_format text not null default 'A5';
alter table companies add column if not exists show_company_details_on_sales_invoice boolean not null default true;
alter table companies add column if not exists invoice_terms text;
alter table companies add column if not exists payment_qr_text text;
alter table companies add column if not exists payment_qr_url text;
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

-- â”€â”€ App Events (feature adoption / diagnostics) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists app_events (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid references companies(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete set null,
  event_type       text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

-- â”€â”€ Accounts (Chart of Accounts + party ledger accounts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists accounts (
  id               text primary key,           -- uuid or seeded slug ('cash', 'bank', â€¦)
  company_id       uuid not null references companies(id) on delete cascade,
  name             text not null,
  type             text not null check (type in ('Asset','Liability','Equity','Income','Expense')),
  "group"          text not null,
  is_system        boolean not null default false,
  is_party         boolean not null default false,
  opening_balance  numeric(18,6) not null default 0,
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
update accounts set contact_no = null where contact_no is not null and btrim(contact_no) !~ '^[0-9]{10}$';
update accounts set pan_no = null where pan_no is not null and btrim(pan_no) !~ '^[0-9]{9}$';
update accounts set contact_no = btrim(contact_no), pan_no = btrim(pan_no);
alter table accounts drop constraint if exists accounts_identity_phone_check;
alter table accounts add constraint accounts_identity_phone_check check (contact_no is null or contact_no ~ '^[0-9]{10}$');
alter table accounts drop constraint if exists accounts_identity_pan_check;
alter table accounts add constraint accounts_identity_pan_check check (pan_no is null or pan_no ~ '^[0-9]{9}$');

-- â”€â”€ Parties â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
update parties set phone = null where phone is not null and btrim(phone) !~ '^[0-9]{10}$';
update parties set pan_vat = null where pan_vat is not null and btrim(pan_vat) !~ '^[0-9]{9}$';
update parties set phone = btrim(phone), pan_vat = btrim(pan_vat);
alter table parties drop constraint if exists parties_identity_phone_check;
alter table parties add constraint parties_identity_phone_check check (phone is null or phone ~ '^[0-9]{10}$');
alter table parties drop constraint if exists parties_identity_pan_check;
alter table parties add constraint parties_identity_pan_check check (pan_vat is null or pan_vat ~ '^[0-9]{9}$');

-- â”€â”€ Items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists items (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  name             text not null,
  unit             text not null default 'pcs',
  alternate_unit   text,
  alternate_conversion numeric(18,6),
  sell_rate        numeric(18,6) not null default 0,
  opening_qty      numeric(18,6) not null default 0,
  opening_rate     numeric(18,6) not null default 0,
  reorder_level    numeric(18,6),
  is_service        boolean not null default false,
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
alter table items add column if not exists alternate_conversion numeric(18,6);

alter table items add column if not exists category_id uuid references item_categories(id) on delete restrict;
alter table items add column if not exists sku text;
alter table items add column if not exists barcode text;
alter table items add column if not exists vat_applicable boolean not null default true;
alter table items add column if not exists is_service boolean not null default false;
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

-- A previous partial/bootstrap run may already have installed the duplicate-name
-- guards. Legacy seed statements below use ON CONFLICT, but PostgreSQL executes
-- BEFORE INSERT triggers first. Temporarily disable only these guards; the
-- synced duplicate-name migration later drops and recreates them as enabled.
do $disable_duplicate_seed_guards$
declare guard record;
begin
  for guard in
    select *
    from (values
      ('accounts', 'accounts_duplicate_name_guard'),
      ('account_categories', 'account_categories_duplicate_name_guard'),
      ('item_categories', 'item_categories_duplicate_name_guard'),
      ('items', 'items_duplicate_name_guard')
    ) configured(table_name, trigger_name)
  loop
    if exists (
      select 1 from pg_trigger trigger_row
      join pg_class table_row on table_row.oid = trigger_row.tgrelid
      join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      where schema_row.nspname = 'public'
        and table_row.relname = guard.table_name
        and trigger_row.tgname = guard.trigger_name
        and not trigger_row.tgisinternal
    ) then
      execute format('alter table public.%I disable trigger %I', guard.table_name, guard.trigger_name);
    end if;
  end loop;
end;
$disable_duplicate_seed_guards$;


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

-- â”€â”€ Vouchers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists vouchers (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  type             text not null check (type in ('Sales','Purchase','Sales Return','Purchase Return','Receipt','Payment','Journal','Stock Adjustment')),
  date             date not null,
  date_ad          date not null,
  date_bs          text not null,
  date_bs_key      integer not null,
  invoice_no       text,
  draft_no         text,
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
  simple_entry_type text check (simple_entry_type in ('Income','Expense')),
  contra_entry boolean not null default false,
  contra_destination_account_id text references accounts(id),
  contra_charge_amount numeric(18,6) not null default 0,
  restock_items    boolean,
  party_account_id text references accounts(id),
  is_cash          boolean not null default false,
  subtotal         numeric(18,6),
  discount         numeric(18,6),
  vat_rate         numeric(5,2),
  vat_amount       numeric(18,6),
  total            numeric(18,6) not null default 0,
  cancelled        boolean not null default false,
  status           text not null default 'Completed' check (status in ('Draft','Completed')),
  seq              integer not null,
  created_by       uuid references auth.users(id),
  updated_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_by     uuid references auth.users(id),
  completed_at     timestamptz,
  draft_payload    jsonb
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
alter table vouchers add column if not exists simple_entry_type text;
alter table vouchers add column if not exists contra_entry boolean not null default false;
alter table vouchers add column if not exists contra_destination_account_id text references accounts(id);
alter table vouchers add column if not exists contra_charge_amount numeric(18,6) not null default 0;
alter table vouchers add column if not exists draft_no text;
alter table vouchers drop constraint if exists vouchers_supplier_invoice_no_length_check;
alter table vouchers add constraint vouchers_supplier_invoice_no_length_check check (supplier_invoice_no is null or char_length(supplier_invoice_no) <= 100);
alter table vouchers add column if not exists date_bs text;
alter table vouchers add column if not exists date_bs_key integer;
alter table vouchers add column if not exists original_voucher_id uuid references vouchers(id) on delete restrict;
alter table vouchers add column if not exists return_reason text;
alter table vouchers add column if not exists settlement_mode text;
alter table vouchers add column if not exists status text not null default 'Completed';
alter table vouchers drop constraint if exists vouchers_status_check;
alter table vouchers add constraint vouchers_status_check check (status in ('Draft','Completed'));
alter table vouchers add column if not exists created_by uuid references auth.users(id);
alter table vouchers add column if not exists updated_by uuid references auth.users(id);
alter table vouchers add column if not exists updated_at timestamptz not null default now();
alter table vouchers add column if not exists completed_by uuid references auth.users(id);
alter table vouchers add column if not exists completed_at timestamptz;
alter table vouchers add column if not exists draft_payload jsonb;
alter table vouchers add column if not exists restock_items boolean;
update vouchers set date_ad = coalesce(date_ad, date) where date_ad is null;

-- â”€â”€ Voucher Lines (double-entry ledger rows) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists voucher_lines (
  id               uuid primary key default uuid_generate_v4(),
  voucher_id       uuid not null references vouchers(id) on delete cascade,
  account_id       text not null references accounts(id),
  debit            numeric(18,6) not null default 0,
  credit           numeric(18,6) not null default 0
);

-- â”€â”€ Stock Lines (inventory movements) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists stock_lines (
  id               uuid primary key default uuid_generate_v4(),
  voucher_id       uuid not null references vouchers(id) on delete cascade,
  item_id          uuid not null references items(id),
  qty              numeric(18,6) not null,
  rate             numeric(18,6) not null,
  direction        text not null check (direction in ('in','out')),
  stock_condition  text not null default 'saleable' check (stock_condition in ('saleable','damaged','expired')),
  is_transfer      boolean not null default false
);

create or replace function public.prevent_service_item_stock_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.items item
    where item.id = new.item_id
      and coalesce(item.is_service, false)
  ) then
    raise exception 'Service items cannot create stock movements';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_lines_reject_service_items on public.stock_lines;
create trigger stock_lines_reject_service_items
before insert or update of item_id on public.stock_lines
for each row
execute function public.prevent_service_item_stock_line();

revoke all on function public.prevent_service_item_stock_line() from public, anon, authenticated;

-- â”€â”€ Invoice Items (human-readable line items for invoice display) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table if not exists invoice_items (
  id               uuid primary key default uuid_generate_v4(),
  voucher_id       uuid not null references vouchers(id) on delete cascade,
  item_id          uuid not null references items(id),
  qty              numeric(18,6) not null,
  rate             numeric(18,6) not null,
  amount           numeric(18,6) not null
);
alter table invoice_items add column if not exists amount numeric(18,6);
alter table invoice_items disable trigger user;
update invoice_items set amount = round(qty * rate, 6) where amount is null;
alter table invoice_items alter column amount set not null;
alter table invoice_items enable trigger user;

-- Voucher-to-invoice allocations. Historical receipts/payments without rows
-- remain valid and are allocated FIFO by the reporting layer.
create table if not exists voucher_settlements (
  id                    uuid primary key default uuid_generate_v4(),
  company_id            uuid not null references companies(id) on delete cascade,
  settlement_voucher_id uuid not null references vouchers(id) on delete cascade,
  invoice_voucher_id    uuid not null references vouchers(id) on delete cascade,
  party_account_id      text not null references accounts(id),
  amount                numeric(18,6) not null check (amount > 0),
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
alter table invoice_items add column if not exists discount_amount numeric(18,6);
alter table invoice_items add column if not exists taxable_amount numeric(18,6);
alter table invoice_items add column if not exists vat_amount numeric(18,6);
alter table invoice_items add column if not exists cost_rate numeric(18,6);
alter table invoice_items add column if not exists entry_unit text;
alter table invoice_items add column if not exists conversion_factor numeric(18,6) not null default 1;
alter table invoice_items add column if not exists base_qty numeric(18,6);

-- â”€â”€ Indexes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create index if not exists idx_accounts_company   on accounts(company_id);
create index if not exists idx_account_categories_company on account_categories(company_id, account_type, name);
create index if not exists idx_parties_company    on parties(company_id);
create index if not exists idx_items_company      on items(company_id);
create index if not exists idx_item_categories_company on item_categories(company_id, name);
create index if not exists idx_master_logs_company on master_change_logs(company_id, created_at desc);
create index if not exists idx_vouchers_company   on vouchers(company_id, date desc, seq desc);
create index if not exists idx_vouchers_company_bs on vouchers(company_id, date_bs_key desc, seq desc);
create unique index if not exists vouchers_company_type_period_invoice_no_unique on vouchers(company_id, type, numbering_period, invoice_no) where invoice_no is not null;
create unique index if not exists vouchers_company_draft_no_unique on vouchers(company_id, draft_no) where draft_no is not null;
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

-- â”€â”€ Row-Level Security â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
drop policy if exists "companies_own" on companies;
create policy "companies_own" on companies
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "developer_admins_own_select" on developer_admins;
create policy "developer_admins_own_select" on developer_admins
  for select using (user_id = auth.uid());

drop policy if exists "companies_developer_select" on companies;
create policy "companies_developer_select" on companies
  for select using (is_developer_admin());

drop policy if exists "companies_developer_update" on companies;
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
drop policy if exists "accounts_own" on accounts;
create policy "accounts_own" on accounts
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "accounts_developer_select" on accounts;
create policy "accounts_developer_select" on accounts
  for select using (is_developer_admin());

drop policy if exists "account_categories_own" on account_categories;
create policy "account_categories_own" on account_categories
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "account_categories_developer_select" on account_categories;
create policy "account_categories_developer_select" on account_categories
  for select using (is_developer_admin());

-- Parties
drop policy if exists "parties_own" on parties;
create policy "parties_own" on parties
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "parties_developer_select" on parties;
create policy "parties_developer_select" on parties
  for select using (is_developer_admin());

-- Items
drop policy if exists "items_own" on items;
create policy "items_own" on items
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "items_developer_select" on items;
create policy "items_developer_select" on items
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

-- Vouchers
drop policy if exists "vouchers_own" on vouchers;
create policy "vouchers_own" on vouchers
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "vouchers_developer_select" on vouchers;
create policy "vouchers_developer_select" on vouchers
  for select using (is_developer_admin());

-- Voucher Lines (access via parent voucher's company)
drop policy if exists "vlines_own" on voucher_lines;
create policy "vlines_own" on voucher_lines
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

drop policy if exists "vlines_developer_select" on voucher_lines;
create policy "vlines_developer_select" on voucher_lines
  for select using (
    is_developer_admin() and exists (select 1 from vouchers v where v.id = voucher_id)
  );

-- Stock Lines
drop policy if exists "slines_own" on stock_lines;
create policy "slines_own" on stock_lines
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

drop policy if exists "slines_developer_select" on stock_lines;
create policy "slines_developer_select" on stock_lines
  for select using (
    is_developer_admin() and exists (select 1 from vouchers v where v.id = voucher_id)
  );

-- Invoice Items
drop policy if exists "iitems_own" on invoice_items;
create policy "iitems_own" on invoice_items
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

drop policy if exists "iitems_developer_select" on invoice_items;
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

drop policy if exists "app_events_own_insert" on app_events;
create policy "app_events_own_insert" on app_events
  for insert with check (company_id = my_company_id() and user_id = auth.uid());

drop policy if exists "app_events_own_select" on app_events;

drop policy if exists "app_events_developer_select" on app_events;
create policy "app_events_developer_select" on app_events
  for select using (is_developer_admin());

-- â”€â”€ Done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- =============================================================================
-- BEGIN INCLUDED FILE: supabase-multi-company-migration.sql
-- =============================================================================
-- Single-login multi-company tenancy, licensing, active-company selection, and membership RLS.
-- Apply after the complete current schema/migrations. Safe to rerun.

begin;

drop index if exists public.companies_user_id_unique;

create table if not exists public.company_members (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'Admin',
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, user_id),
  check (role in ('Admin')),
  check (status in ('active','inactive'))
);

create table if not exists public.user_company_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_companies integer not null default 1 check (max_companies >= 0),
  unlimited_companies boolean not null default false,
  company_creation_enabled boolean not null default true,
  license_status text not null default 'active' check (license_status in ('active','expired','suspended')),
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_user_permissions (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  permission text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, user_id, permission)
);

create index if not exists idx_company_members_user_status on public.company_members(user_id, status);
create index if not exists idx_company_members_company_status on public.company_members(company_id, status);
create index if not exists idx_companies_owner on public.companies(user_id, created_at);

insert into public.company_members(company_id, user_id, role, status, created_by)
select company.id, company.user_id, 'Admin', 'active', company.user_id
from public.companies company
where company.user_id is not null
on conflict (company_id, user_id) do update
set role = 'Admin',
    status = 'active',
    updated_at = now();

insert into public.user_preferences(user_id, active_company_id)
select distinct on (member.user_id) member.user_id, member.company_id
from public.company_members member
join public.companies company on company.id = member.company_id
where member.status = 'active'
order by member.user_id, company.created_at
on conflict (user_id) do nothing;

create or replace function public.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_developer_admin()
    or exists (
      select 1
      from public.company_members member
      where member.company_id = target_company
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  )
$$;

create or replace function public.is_company_admin(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_developer_admin()
    or exists (
      select 1
      from public.company_members member
      where member.company_id = target_company
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role = 'Admin'
    )
  )
$$;

create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select preference.active_company_id
      from public.user_preferences preference
      join public.company_members member
        on member.company_id = preference.active_company_id
       and member.user_id = preference.user_id
       and member.status = 'active'
      where preference.user_id = auth.uid()
      limit 1
    ),
    (
      select member.company_id
      from public.company_members member
      join public.companies company on company.id = member.company_id
      where member.user_id = auth.uid()
        and member.status = 'active'
      order by company.created_at
      limit 1
    )
  )
$$;

create or replace function public.has_company_permission(target_company uuid, requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_admin(target_company)
    or exists (
      select 1
      from public.company_user_permissions permission
      where permission.company_id = target_company
        and permission.user_id = auth.uid()
        and permission.permission = requested_permission
    )
$$;

create or replace function public.company_creation_license(target_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with license as (
    select
      coalesce(limit_row.max_companies, 1) as max_companies,
      coalesce(limit_row.unlimited_companies, false) as unlimited_companies,
      coalesce(limit_row.company_creation_enabled, true) as company_creation_enabled,
      coalesce(limit_row.license_status, 'active') as license_status,
      limit_row.expires_at
    from (select 1) seed
    left join public.user_company_limits limit_row on limit_row.user_id = target_user
  ),
  usage as (
    select count(*)::integer as current_companies
    from public.companies company
    where company.user_id = target_user
  )
  select jsonb_build_object(
    'user_id', target_user,
    'current_companies', usage.current_companies,
    'max_companies', license.max_companies,
    'unlimited_companies', license.unlimited_companies,
    'company_creation_enabled', license.company_creation_enabled,
    'license_status', case
      when license.license_status = 'active' and license.expires_at is not null and license.expires_at < current_date then 'expired'
      else license.license_status
    end,
    'expires_at', license.expires_at,
    'remaining_companies', case when license.unlimited_companies then null else greatest(license.max_companies - usage.current_companies, 0) end,
    'can_create_company', license.company_creation_enabled
      and license.license_status = 'active'
      and (license.expires_at is null or license.expires_at >= current_date)
      and (license.unlimited_companies or usage.current_companies < license.max_companies)
  )
  from license, usage
$$;

create or replace function public.assert_company_creation_allowed(target_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  license jsonb;
begin
  license := public.company_creation_license(target_user);
  if coalesce((license->>'company_creation_enabled')::boolean, false) = false
    or license->>'license_status' <> 'active'
    or coalesce((license->>'can_create_company')::boolean, false) = false then
    raise exception 'You have reached your maximum allowed company limit. Please contact the administrator.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.ensure_default_company_accounts(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.ensure_system_account_groups(uuid)') is not null then
    perform public.ensure_system_account_groups(target_company_id);
  end if;
  if to_regprocedure('public.ensure_retained_earnings_ledger(uuid)') is not null then
    perform public.ensure_retained_earnings_ledger(target_company_id);
  end if;

  insert into public.accounts(id, company_id, name, type, "group", category_id, is_system, is_party, opening_balance)
  select target_company_id::text || ':' || seed.account_key, target_company_id, seed.account_name, seed.account_type, seed.group_name, category.id, seed.is_system, false, 0
  from (values
    ('cash','Cash','Asset','Cash-in-Hand',true),
    ('bank','Bank Account','Asset','Bank Accounts',true),
    ('inventory','Stock-in-Hand','Asset','Current Assets',true),
    ('vat_payable','VAT Payable (Output)','Liability','Duties & Taxes',true),
    ('vat_receivable','VAT Receivable (Input)','Liability','Duties & Taxes',true),
    ('sales','Sales Account','Income','Sales Accounts',true),
    ('purchase','Purchase Account','Expense','Purchase Accounts',true),
    ('sales_return','Sales Return Account','Income','Sales Accounts',true),
    ('purchase_return','Purchase Return Account','Expense','Purchase Accounts',true),
    ('capital','Owner''s Capital','Equity','Capital Account',true),
    ('retained_earnings','Retained Earnings','Equity','Reserves & Surplus',true),
    ('discount_allowed','Discount Allowed','Expense','Indirect Expenses',false),
    ('bank_charges','Bank Charges','Expense','Indirect Expenses',true),
    ('rent','Rent Expense','Expense','Indirect Expenses',false),
    ('salary','Salary Expense','Expense','Indirect Expenses',false),
    ('electricity','Electricity Expense','Expense','Indirect Expenses',false)
  ) seed(account_key, account_name, account_type, group_name, is_system)
  left join public.account_categories category
    on category.company_id = target_company_id
   and category.name = seed.group_name
   and category.account_type = seed.account_type
  where not exists (
    select 1 from public.accounts existing
    where existing.company_id = target_company_id
      and (
        existing.id = target_company_id::text || ':' || seed.account_key
        or lower(btrim(existing.name)) = lower(btrim(seed.account_name))
      )
  )
  on conflict (id) do nothing;

  insert into public.item_categories(company_id, name, is_archived)
  select target_company_id, 'General', false
  where not exists (
    select 1 from public.item_categories existing
    where existing.company_id = target_company_id
      and lower(btrim(existing.name)) = lower('General')
  )
  on conflict (company_id, name) do nothing;
end;
$$;

create or replace function public.set_active_company(target_company uuid)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_company public.companies%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_member(target_company) then raise exception 'Company access denied' using errcode = '42501'; end if;
  insert into public.user_preferences(user_id, active_company_id, updated_at)
  values (auth.uid(), target_company, now())
  on conflict (user_id) do update
  set active_company_id = excluded.active_company_id,
      updated_at = now();
  select * into selected_company from public.companies where id = target_company;
  return selected_company;
end;
$$;

create or replace function public.create_company_atomic(p_company jsonb)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  user_email text;
  saved public.companies%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform public.assert_company_creation_allowed(caller);
  select email into user_email from auth.users where id = caller;

  insert into public.companies(
    user_id, owner_email, name, address, pan_vat, phone, vat_enabled,
    inventory_valuation_method, sales_prefix, purchase_prefix, receipt_prefix,
    payment_prefix, sales_return_prefix, purchase_return_prefix,
    journal_numbering_mode, reset_numbering_fiscal_year, print_format,
    invoice_terms, payment_qr_text, fiscal_year_start, fiscal_year_configured
  ) values (
    caller,
    user_email,
    coalesce(nullif(btrim(coalesce(p_company->>'name', '')), ''), 'My Company'),
    nullif(btrim(coalesce(p_company->>'address', '')), ''),
    nullif(btrim(coalesce(p_company->>'pan_vat', '')), ''),
    nullif(btrim(coalesce(p_company->>'phone', '')), ''),
    coalesce((p_company->>'vat_enabled')::boolean, true),
    coalesce(nullif(p_company->>'inventory_valuation_method', ''), 'weighted_average'),
    coalesce(nullif(btrim(p_company->>'sales_prefix'), ''), 'INV-'),
    coalesce(nullif(btrim(p_company->>'purchase_prefix'), ''), 'PB-'),
    coalesce(nullif(btrim(p_company->>'receipt_prefix'), ''), 'RCPT-'),
    coalesce(nullif(btrim(p_company->>'payment_prefix'), ''), 'PAY-'),
    coalesce(nullif(btrim(p_company->>'sales_return_prefix'), ''), 'SR-'),
    coalesce(nullif(btrim(p_company->>'purchase_return_prefix'), ''), 'PR-'),
    coalesce(nullif(p_company->>'journal_numbering_mode', ''), 'auto'),
    true,
    coalesce(nullif(p_company->>'print_format', ''), 'A5'),
    nullif(btrim(coalesce(p_company->>'invoice_terms', '')), ''),
    nullif(btrim(coalesce(p_company->>'payment_qr_text', '')), ''),
    coalesce(nullif(p_company->>'fiscal_year_start', '')::date, '2026-07-17'::date),
    coalesce((p_company->>'fiscal_year_configured')::boolean, true)
  ) returning * into saved;

  insert into public.company_members(company_id, user_id, role, status, created_by)
  values (saved.id, caller, 'Admin', 'active', caller)
  on conflict (company_id, user_id) do update
  set role = 'Admin', status = 'active', updated_at = now();

  perform public.ensure_default_company_accounts(saved.id);
  perform public.set_active_company(saved.id);
  return saved;
end;
$$;

create or replace function public.get_my_companies()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with memberships as (
    select
      member.company_id,
      member.role,
      member.status,
      member.created_at as member_since,
      to_jsonb(company.*) as company
    from public.company_members member
    join public.companies company on company.id = member.company_id
    where member.user_id = auth.uid()
      and member.status = 'active'
    order by company.created_at
  ),
  preferred as (
    select coalesce(
      (
        select preference.active_company_id
        from public.user_preferences preference
        join public.company_members member
          on member.company_id = preference.active_company_id
         and member.user_id = preference.user_id
         and member.status = 'active'
        where preference.user_id = auth.uid()
        limit 1
      ),
      (select company_id from memberships limit 1)
    ) as active_company_id
  )
  select jsonb_build_object(
    'active_company_id', preferred.active_company_id,
    'memberships', coalesce((select jsonb_agg(to_jsonb(memberships)) from memberships), '[]'::jsonb),
    'license', public.company_creation_license(auth.uid())
  )
  from preferred
$$;

create or replace function public.add_existing_company_admin(target_company uuid, target_email text)
returns public.company_members
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
  saved public.company_members%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_admin(target_company) then raise exception 'Company admin access required' using errcode = '42501'; end if;
  select id into target_user
  from auth.users
  where lower(email) = lower(btrim(target_email))
  limit 1;
  if target_user is null then raise exception 'No existing user found for this email address'; end if;

  insert into public.company_members(company_id, user_id, role, status, created_by)
  values (target_company, target_user, 'Admin', 'active', auth.uid())
  on conflict (company_id, user_id) do update
  set role = 'Admin', status = 'active', updated_at = now()
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.developer_user_company_licenses()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_developer_admin() then coalesce(jsonb_agg(row_data order by lower(coalesce(row_data->>'email', ''))), '[]'::jsonb) else '[]'::jsonb end
  from (
    select jsonb_build_object(
      'user_id', user_record.id,
      'email', user_record.email,
      'license', public.company_creation_license(user_record.id),
      'companies', coalesce((
        select jsonb_agg(jsonb_build_object('id', company.id, 'name', company.name, 'created_at', company.created_at) order by company.created_at)
        from public.companies company
        where company.user_id = user_record.id
      ), '[]'::jsonb)
    ) as row_data
    from auth.users user_record
    where exists (select 1 from public.companies company where company.user_id = user_record.id)
       or exists (select 1 from public.user_company_limits limit_row where limit_row.user_id = user_record.id)
  ) rows;
$$;

create or replace function public.update_user_company_limit(
  target_user uuid,
  p_max_companies integer,
  p_unlimited_companies boolean,
  p_company_creation_enabled boolean,
  p_license_status text,
  p_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode = '42501'; end if;
  insert into public.user_company_limits(user_id, max_companies, unlimited_companies, company_creation_enabled, license_status, expires_at, updated_by, updated_at)
  values (
    target_user,
    greatest(coalesce(p_max_companies, 1), 0),
    coalesce(p_unlimited_companies, false),
    coalesce(p_company_creation_enabled, true),
    coalesce(nullif(p_license_status, ''), 'active'),
    p_expires_at,
    auth.uid(),
    now()
  )
  on conflict (user_id) do update
  set max_companies = excluded.max_companies,
      unlimited_companies = excluded.unlimited_companies,
      company_creation_enabled = excluded.company_creation_enabled,
      license_status = excluded.license_status,
      expires_at = excluded.expires_at,
      updated_by = auth.uid(),
      updated_at = now();
  return public.company_creation_license(target_user);
end;
$$;

create or replace function public.prevent_company_id_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'Company cannot be changed for %.%', tg_table_schema, tg_table_name;
  end if;
  return new;
end;
$$;

create or replace function public.validate_company_reference_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_company uuid;
  source_company uuid;
begin
  if tg_table_name = 'accounts' then
    if new.category_id is not null and not exists(select 1 from public.account_categories c where c.id = new.category_id and c.company_id = new.company_id) then
      raise exception 'Ledger category must belong to the same company';
    end if;
  elsif tg_table_name = 'account_categories' then
    if new.parent_category_id is not null and not exists(select 1 from public.account_categories c where c.id = new.parent_category_id and c.company_id = new.company_id and c.account_type = new.account_type) then
      raise exception 'Parent account group must belong to the same company and type';
    end if;
  elsif tg_table_name = 'parties' then
    if not exists(select 1 from public.accounts a where a.id = new.account_id and a.company_id = new.company_id) then
      raise exception 'Party ledger must belong to the same company';
    end if;
  elsif tg_table_name = 'items' then
    if new.category_id is not null and not exists(select 1 from public.item_categories c where c.id = new.category_id and c.company_id = new.company_id) then
      raise exception 'Item category must belong to the same company';
    end if;
  elsif tg_table_name = 'item_categories' then
    if new.parent_category_id is not null and not exists(select 1 from public.item_categories c where c.id = new.parent_category_id and c.company_id = new.company_id) then
      raise exception 'Parent item category must belong to the same company';
    end if;
  elsif tg_table_name = 'vouchers' then
    if new.party_account_id is not null and not exists(select 1 from public.accounts a where a.id = new.party_account_id and a.company_id = new.company_id) then
      raise exception 'Voucher party ledger must belong to the same company';
    end if;
    if new.settlement_account_id is not null and not exists(select 1 from public.accounts a where a.id = new.settlement_account_id and a.company_id = new.company_id) then
      raise exception 'Voucher settlement ledger must belong to the same company';
    end if;
    if new.original_voucher_id is not null and not exists(select 1 from public.vouchers v where v.id = new.original_voucher_id and v.company_id = new.company_id) then
      raise exception 'Original voucher must belong to the same company';
    end if;
  elsif tg_table_name = 'voucher_settlements' then
    if not exists(select 1 from public.vouchers v where v.id = new.settlement_voucher_id and v.company_id = new.company_id) then
      raise exception 'Settlement voucher must belong to the same company';
    end if;
    if not exists(select 1 from public.vouchers v where v.id = new.invoice_voucher_id and v.company_id = new.company_id) then
      raise exception 'Invoice voucher must belong to the same company';
    end if;
    if not exists(select 1 from public.accounts a where a.id = new.party_account_id and a.company_id = new.company_id) then
      raise exception 'Settlement ledger must belong to the same company';
    end if;
  end if;

  if tg_table_name = 'voucher_lines' then
    select company_id into parent_company from public.vouchers where id = new.voucher_id;
    if parent_company is null then raise exception 'Voucher line parent voucher is missing'; end if;
    if not exists(select 1 from public.accounts a where a.id = new.account_id and a.company_id = parent_company) then
      raise exception 'Voucher line ledger must belong to the voucher company';
    end if;
  elsif tg_table_name = 'stock_lines' then
    select company_id into parent_company from public.vouchers where id = new.voucher_id;
    if parent_company is null then raise exception 'Stock line parent voucher is missing'; end if;
    if not exists(select 1 from public.items i where i.id = new.item_id and i.company_id = parent_company) then
      raise exception 'Stock line item must belong to the voucher company';
    end if;
  elsif tg_table_name = 'invoice_items' then
    select company_id into parent_company from public.vouchers where id = new.voucher_id;
    if parent_company is null then raise exception 'Invoice item parent voucher is missing'; end if;
    if not exists(select 1 from public.items i where i.id = new.item_id and i.company_id = parent_company) then
      raise exception 'Invoice item must belong to the voucher company';
    end if;
    if new.source_invoice_item_id is not null then
      select source_voucher.company_id into source_company
      from public.invoice_items source_item
      join public.vouchers source_voucher on source_voucher.id = source_item.voucher_id
      where source_item.id = new.source_invoice_item_id;
      if source_company is distinct from parent_company then raise exception 'Source invoice item must belong to the same company'; end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_active_company_preference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active_company_id is not null and not exists (
    select 1 from public.company_members member
    where member.company_id = new.active_company_id
      and member.user_id = new.user_id
      and member.status = 'active'
  ) then
    raise exception 'Active company must belong to the user';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_preferences_company_guard on public.user_preferences;
create trigger user_preferences_company_guard
before insert or update on public.user_preferences
for each row execute function public.validate_active_company_preference();

do $triggers$
declare
  table_name text;
begin
  foreach table_name in array array['accounts','account_categories','parties','items','item_categories','vouchers','voucher_settlements'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_company_static_guard', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_company_id_change()', table_name || '_company_static_guard', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_company_reference_guard', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_company_reference_integrity()', table_name || '_company_reference_guard', table_name);
  end loop;

  foreach table_name in array array['voucher_lines','stock_lines','invoice_items'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_company_reference_guard', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_company_reference_integrity()', table_name || '_company_reference_guard', table_name);
  end loop;
end;
$triggers$;

alter table public.company_members enable row level security;
alter table public.user_company_limits enable row level security;
alter table public.user_preferences enable row level security;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companies','accounts','account_categories','parties','items','item_categories',
    'master_change_logs','vouchers','voucher_settlements','app_events',
    'company_modules','company_user_permissions','cheque_banks','cheques','cheque_events'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
    end if;
  end loop;

  drop policy if exists "companies_own" on public.companies;
  drop policy if exists "companies_owner_select" on public.companies;
  drop policy if exists "companies_developer_select" on public.companies;
  drop policy if exists "companies_developer_update" on public.companies;
  drop policy if exists "companies_developer_delete" on public.companies;
  drop policy if exists "companies_member_select" on public.companies;
  drop policy if exists "companies_admin_update" on public.companies;
  drop policy if exists "companies_developer_all" on public.companies;
  create policy "companies_member_select" on public.companies for select using (public.is_company_member(id));
  create policy "companies_admin_update" on public.companies for update using (public.is_company_admin(id)) with check (public.is_company_admin(id));
  create policy "companies_developer_all" on public.companies for all using (public.is_developer_admin()) with check (public.is_developer_admin());

  foreach table_name in array array['accounts','account_categories','parties','items','item_categories','master_change_logs','vouchers','voucher_settlements'] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_developer_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_member_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_write', table_name);
    execute format('create policy %I on public.%I for select using (public.is_company_member(company_id))', table_name || '_member_select', table_name);
    execute format('create policy %I on public.%I for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id))', table_name || '_admin_write', table_name);
  end loop;

  foreach table_name in array array['voucher_lines','stock_lines','invoice_items'] loop
    execute format('drop policy if exists %I on public.%I', case when table_name = 'voucher_lines' then 'vlines_own' when table_name = 'stock_lines' then 'slines_own' else 'iitems_own' end, table_name);
    execute format('drop policy if exists %I on public.%I', case when table_name = 'voucher_lines' then 'vlines_developer_select' when table_name = 'stock_lines' then 'slines_developer_select' else 'iitems_developer_select' end, table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_member_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_write', table_name);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_member(voucher.company_id)))', table_name || '_member_select', table_name);
    execute format('create policy %I on public.%I for all using (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_admin(voucher.company_id))) with check (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_admin(voucher.company_id)))', table_name || '_admin_write', table_name);
  end loop;
end;
$policies$;

drop policy if exists company_members_own_select on public.company_members;
drop policy if exists company_members_admin_write on public.company_members;
drop policy if exists company_members_developer_all on public.company_members;
create policy company_members_own_select on public.company_members
  for select using (user_id = auth.uid() or public.is_company_admin(company_id));
create policy company_members_admin_write on public.company_members
  for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy company_members_developer_all on public.company_members
  for all using (public.is_developer_admin()) with check (public.is_developer_admin());

drop policy if exists user_preferences_own on public.user_preferences;
drop policy if exists user_preferences_developer_select on public.user_preferences;
create policy user_preferences_own on public.user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_preferences_developer_select on public.user_preferences
  for select using (public.is_developer_admin());

drop policy if exists user_company_limits_own_select on public.user_company_limits;
drop policy if exists user_company_limits_developer_all on public.user_company_limits;
create policy user_company_limits_own_select on public.user_company_limits
  for select using (user_id = auth.uid());
create policy user_company_limits_developer_all on public.user_company_limits
  for all using (public.is_developer_admin()) with check (public.is_developer_admin());

drop policy if exists app_events_own_insert on public.app_events;
drop policy if exists app_events_developer_select on public.app_events;
drop policy if exists app_events_member_select on public.app_events;
create policy app_events_own_insert on public.app_events
  for insert with check (public.is_company_member(company_id) and user_id = auth.uid());
create policy app_events_member_select on public.app_events
  for select using (public.is_company_admin(company_id));
create policy app_events_developer_select on public.app_events
  for select using (public.is_developer_admin());

do $optional_policies$
begin
  if to_regclass('public.company_modules') is not null then
    drop policy if exists company_modules_owner_select on public.company_modules;
    drop policy if exists company_modules_developer_all on public.company_modules;
    create policy company_modules_owner_select on public.company_modules for select using (public.is_company_member(company_id));
    create policy company_modules_developer_all on public.company_modules for all using (public.is_developer_admin()) with check (public.is_developer_admin());
  end if;
  if to_regclass('public.company_user_permissions') is not null then
    drop policy if exists company_permissions_own_select on public.company_user_permissions;
    drop policy if exists company_permissions_developer_all on public.company_user_permissions;
    create policy company_permissions_own_select on public.company_user_permissions for select using (public.is_company_member(company_id) and (user_id = auth.uid() or public.is_company_admin(company_id)));
    create policy company_permissions_developer_all on public.company_user_permissions for all using (public.is_developer_admin()) with check (public.is_developer_admin());
  end if;
end;
$optional_policies$;

create or replace function public.delete_developer_company(target_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  account_category_guard_exists boolean;
begin
  if not public.is_developer_admin() then
    raise exception 'Developer admin access required' using errcode = '42501';
  end if;

  if target_company is null then
    raise exception 'Company id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.companies company where company.id = target_company) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  perform 1 from public.companies company where company.id = target_company for update;

  select exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.account_categories'::regclass
      and trigger_row.tgname = 'account_category_system_guard'
      and not trigger_row.tgisinternal
  ) into account_category_guard_exists;

  if account_category_guard_exists then
    execute 'alter table public.account_categories disable trigger account_category_system_guard';
  end if;

  begin
  update public.user_preferences
  set active_company_id = null,
      updated_at = now()
  where active_company_id = target_company;

  if to_regclass('public.cheque_events') is not null then
    delete from public.cheque_events where company_id = target_company;
  end if;
  if to_regclass('public.cheques') is not null then
    delete from public.cheques where company_id = target_company;
  end if;
  if to_regclass('public.cheque_banks') is not null then
    delete from public.cheque_banks where company_id = target_company;
  end if;

  delete from public.voucher_settlements settlement
  where settlement.company_id = target_company
     or exists (select 1 from public.vouchers voucher where voucher.id = settlement.settlement_voucher_id and voucher.company_id = target_company)
     or exists (select 1 from public.vouchers voucher where voucher.id = settlement.invoice_voucher_id and voucher.company_id = target_company);

  update public.invoice_items item
  set source_invoice_item_id = null
  where source_invoice_item_id is not null
    and (
      exists (select 1 from public.vouchers voucher where voucher.id = item.voucher_id and voucher.company_id = target_company)
      or exists (
        select 1
        from public.invoice_items source_item
        join public.vouchers source_voucher on source_voucher.id = source_item.voucher_id
        where source_item.id = item.source_invoice_item_id
          and source_voucher.company_id = target_company
      )
    );

  delete from public.invoice_items item
  where exists (select 1 from public.vouchers voucher where voucher.id = item.voucher_id and voucher.company_id = target_company);
  delete from public.stock_lines line
  where exists (select 1 from public.vouchers voucher where voucher.id = line.voucher_id and voucher.company_id = target_company);
  delete from public.voucher_lines line
  where exists (select 1 from public.vouchers voucher where voucher.id = line.voucher_id and voucher.company_id = target_company);

  update public.vouchers voucher
  set original_voucher_id = null
  where voucher.original_voucher_id is not null
    and exists (select 1 from public.vouchers original where original.id = voucher.original_voucher_id and original.company_id = target_company);
  delete from public.vouchers where company_id = target_company;

  delete from public.parties where company_id = target_company;
  delete from public.master_change_logs where company_id = target_company;
  delete from public.items where company_id = target_company;

  update public.item_categories
  set parent_category_id = null
  where company_id = target_company
    and parent_category_id is not null;
  delete from public.item_categories where company_id = target_company;

  delete from public.accounts where company_id = target_company;

  update public.account_categories
  set parent_category_id = null
  where company_id = target_company
    and parent_category_id is not null;
  delete from public.account_categories where company_id = target_company;

  if to_regclass('public.company_modules') is not null then
    delete from public.company_modules where company_id = target_company;
  end if;
  if to_regclass('public.company_user_permissions') is not null then
    delete from public.company_user_permissions where company_id = target_company;
  end if;

  delete from public.company_members where company_id = target_company;
  delete from public.app_events where company_id = target_company;
  delete from public.companies where id = target_company;

  exception when others then
    if account_category_guard_exists then
      execute 'alter table public.account_categories enable trigger account_category_system_guard';
    end if;
    raise;
  end;

  if account_category_guard_exists then
    execute 'alter table public.account_categories enable trigger account_category_system_guard';
  end if;
end;
$$;

revoke all on function public.is_company_member(uuid) from public, anon;
revoke all on function public.is_company_admin(uuid) from public, anon;
revoke all on function public.company_creation_license(uuid) from public, anon;
revoke all on function public.assert_company_creation_allowed(uuid) from public, anon;
revoke all on function public.ensure_default_company_accounts(uuid) from public, anon, authenticated;
revoke all on function public.create_company_atomic(jsonb) from public, anon;
revoke all on function public.set_active_company(uuid) from public, anon;
revoke all on function public.get_my_companies() from public, anon;
revoke all on function public.add_existing_company_admin(uuid,text) from public, anon;
revoke all on function public.developer_user_company_licenses() from public, anon;
revoke all on function public.update_user_company_limit(uuid,integer,boolean,boolean,text,date) from public, anon;
revoke all on function public.delete_developer_company(uuid) from public, anon;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.is_company_admin(uuid) to authenticated;
grant execute on function public.company_creation_license(uuid) to authenticated;
grant execute on function public.create_company_atomic(jsonb) to authenticated;
grant execute on function public.set_active_company(uuid) to authenticated;
grant execute on function public.get_my_companies() to authenticated;
grant execute on function public.add_existing_company_admin(uuid,text) to authenticated;
grant execute on function public.developer_user_company_licenses() to authenticated;
grant execute on function public.update_user_company_limit(uuid,integer,boolean,boolean,text,date) to authenticated;
grant execute on function public.delete_developer_company(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-multi-company-migration.sql

-- BEGIN INCLUDED FILE: supabase-sales-invoice-chronology-setting-migration.sql

-- Add an opt-in Sales-only chronological invoice date setting.
-- When disabled, all voucher types only require dates inside the active fiscal year.
begin;

alter table public.companies
  add column if not exists enforce_sales_invoice_chronology boolean not null default false;

create or replace function public.voucher_number_value(value text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select nullif(substring(coalesce(value, '') from '([0-9]+)$'), '')::bigint;
$$;

create or replace function public.validate_voucher_chronology()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  company_record public.companies%rowtype;
  current_number bigint;
  previous_voucher public.vouchers%rowtype;
  next_voucher public.vouchers%rowtype;
  bypass_allowed boolean := false;
begin
  if coalesce(new.status, 'Completed') = 'Draft' then
    return new;
  end if;

  if new.type <> 'Sales' then
    return new;
  end if;

  select * into company_record from public.companies where id = new.company_id;
  if not found then
    return new;
  end if;

  if not coalesce(company_record.enforce_sales_invoice_chronology, false) then
    return new;
  end if;

  current_number := public.voucher_number_value(new.invoice_no);
  if current_number is null then
    return new;
  end if;

  select voucher.* into previous_voucher
  from public.vouchers voucher
  where voucher.company_id = new.company_id
    and voucher.type = new.type
    and coalesce(voucher.status, 'Completed') <> 'Draft'
    and coalesce(voucher.numbering_period, 'all') = coalesce(new.numbering_period, 'all')
    and voucher.id is distinct from new.id
    and public.voucher_number_value(voucher.invoice_no) < current_number
  order by public.voucher_number_value(voucher.invoice_no) desc, voucher.seq desc
  limit 1;

  select voucher.* into next_voucher
  from public.vouchers voucher
  where voucher.company_id = new.company_id
    and voucher.type = new.type
    and coalesce(voucher.status, 'Completed') <> 'Draft'
    and coalesce(voucher.numbering_period, 'all') = coalesce(new.numbering_period, 'all')
    and voucher.id is distinct from new.id
    and public.voucher_number_value(voucher.invoice_no) > current_number
  order by public.voucher_number_value(voucher.invoice_no) asc, voucher.seq asc
  limit 1;

  if (previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key)
    or (next_voucher.id is not null and new.date_bs_key > next_voucher.date_bs_key) then
    bypass_allowed := coalesce(company_record.allow_admin_chronological_bypass, false)
      and public.is_company_admin(new.company_id);

    if not bypass_allowed then
      if tg_op = 'INSERT' and previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key then
        raise exception 'The voucher date cannot be earlier than the previous voucher (%). Please select the same or a later date.', previous_voucher.invoice_no;
      elsif previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key then
        raise exception 'The voucher date cannot be earlier than Voucher %.', previous_voucher.invoice_no;
      else
        raise exception 'The voucher date cannot be later than Voucher %.', next_voucher.invoice_no;
      end if;
    end if;

    insert into public.app_events (company_id, user_id, event_type, metadata)
    values (
      new.company_id,
      auth.uid(),
      'voucher_chronology_bypass',
      jsonb_build_object(
        'voucher_type', new.type,
        'voucher_number', new.invoice_no,
        'previous_voucher', previous_voucher.invoice_no,
        'previous_date', previous_voucher.date_bs,
        'next_voucher', next_voucher.invoice_no,
        'next_date', next_voucher.date_bs,
        'new_date', new.date_bs,
        'source', 'database'
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists vouchers_chronology_guard on public.vouchers;
create trigger vouchers_chronology_guard
before insert or update of date_bs, date_bs_key, invoice_no, numbering_period, type, status on public.vouchers
for each row execute function public.validate_voucher_chronology();

revoke all on function public.validate_voucher_chronology() from public, anon, authenticated;
revoke all on function public.voucher_number_value(text) from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';

-- END INCLUDED FILE: supabase-sales-invoice-chronology-setting-migration.sql

-- Developer full portable backup and local export status
create table if not exists public.developer_backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  initiated_by uuid not null references auth.users(id),
  total_companies integer not null check (total_companies >= 0),
  successful_companies integer not null default 0 check (successful_companies >= 0),
  failed_companies integer not null default 0 check (failed_companies >= 0),
  status text not null default 'running' check (status in ('running','successful','partial','failed'))
);

create table if not exists public.developer_company_backup_status (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_exported_at timestamptz,
  last_attempted_at timestamptz not null default now(),
  last_export_status text not null check (last_export_status in ('successful','failed')),
  last_exported_by uuid references auth.users(id),
  last_error text
);

alter table public.developer_backup_runs enable row level security;
alter table public.developer_company_backup_status enable row level security;

drop policy if exists developer_backup_runs_select on public.developer_backup_runs;
create policy developer_backup_runs_select on public.developer_backup_runs for select using ((select public.is_developer_admin()));
drop policy if exists developer_company_backup_status_select on public.developer_company_backup_status;
create policy developer_company_backup_status_select on public.developer_company_backup_status for select using ((select public.is_developer_admin()));

create or replace function public.developer_user_company_licenses()
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when public.is_developer_admin() then coalesce(jsonb_agg(row_data order by lower(coalesce(row_data->>'display_name', row_data->>'email', ''))), '[]'::jsonb) else '[]'::jsonb end
  from (
    select jsonb_build_object(
      'user_id', user_record.id,
      'email', user_record.email,
      'display_name', coalesce(nullif(btrim(user_record.raw_user_meta_data->>'full_name'), ''), nullif(btrim(user_record.raw_user_meta_data->>'name'), '')),
      'license', public.company_creation_license(user_record.id),
      'companies', coalesce((select jsonb_agg(jsonb_build_object('id', company.id, 'name', company.name, 'created_at', company.created_at) order by company.created_at) from public.companies company where company.user_id = user_record.id), '[]'::jsonb)
    ) row_data
    from auth.users user_record
    where exists (select 1 from public.companies company where company.user_id = user_record.id)
       or exists (select 1 from public.user_company_limits limit_row where limit_row.user_id = user_record.id)
  ) rows;
$$;

create or replace function public.developer_export_company_backup(target_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies where id = target_company) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'company', to_jsonb(c) - array['developer_notes','owner_email','user_id'],
    'accountCategories', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.account_categories x where x.company_id=target_company),'[]'::jsonb),
    'itemCategories', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.item_categories x where x.company_id=target_company),'[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.accounts x where x.company_id=target_company),'[]'::jsonb),
    'parties', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.parties x where x.company_id=target_company),'[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.items x where x.company_id=target_company),'[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(
      (to_jsonb(v)-array['created_by','updated_by','completed_by']) || jsonb_build_object(
        'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.voucher_lines l where l.voucher_id=v.id),'[]'::jsonb),
        'stock_lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.stock_lines l where l.voucher_id=v.id),'[]'::jsonb),
        'invoice_items',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.invoice_items l where l.voucher_id=v.id),'[]'::jsonb),
        'settlements',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.voucher_settlements l where l.settlement_voucher_id=v.id),'[]'::jsonb)
      ) order by v.date_bs_key,v.seq,v.id) from public.vouchers v where v.company_id=target_company),'[]'::jsonb),
    'chequeBanks',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.created_at,x.id) from public.cheque_banks x where x.company_id=target_company),'[]'::jsonb),
    'cheques',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.created_at,x.id) from public.cheques x where x.company_id=target_company),'[]'::jsonb),
    'chequeEvents',coalesce((select jsonb_agg(to_jsonb(x)-array['actor_id'] order by x.created_at,x.id) from public.cheque_events x where x.company_id=target_company),'[]'::jsonb),
    'companyModules',coalesce((select jsonb_agg((to_jsonb(x)-array['enabled_by','internal_notes']) || jsonb_build_object('module_key',m.key) order by x.created_at,x.id) from public.company_modules x join public.modules m on m.id=x.module_id where x.company_id=target_company),'[]'::jsonb),
    'masterChangeLogs',coalesce((select jsonb_agg(to_jsonb(x)-array['user_id'] order by x.created_at,x.id) from public.master_change_logs x where x.company_id=target_company),'[]'::jsonb),
    'appEvents',coalesce((select jsonb_agg(to_jsonb(x)-array['user_id'] order by x.created_at,x.id) from public.app_events x where x.company_id=target_company),'[]'::jsonb)
  ) into result from public.companies c where c.id=target_company;
  return result;
end;
$$;

create or replace function public.start_developer_backup_run(p_total_companies integer)
returns public.developer_backup_runs language plpgsql security definer set search_path=public
as $$ declare saved public.developer_backup_runs; begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  insert into public.developer_backup_runs(initiated_by,total_companies) values(auth.uid(),greatest(coalesce(p_total_companies,0),0)) returning * into saved; return saved;
end $$;

create or replace function public.record_developer_company_backup_result(p_run_id uuid,p_company_id uuid,p_successful boolean,p_error text default null)
returns public.developer_company_backup_status language plpgsql security definer set search_path=public
as $$ declare saved public.developer_company_backup_status; begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  if not exists(select 1 from public.developer_backup_runs where id=p_run_id and status='running') then raise exception 'Backup run is not active'; end if;
  insert into public.developer_company_backup_status(company_id,last_exported_at,last_attempted_at,last_export_status,last_exported_by,last_error)
  values(p_company_id,case when p_successful then now() end,now(),case when p_successful then 'successful' else 'failed' end,case when p_successful then auth.uid() end,case when p_successful then null else left(coalesce(p_error,'Export failed'),1000) end)
  on conflict(company_id) do update set last_attempted_at=excluded.last_attempted_at,last_export_status=excluded.last_export_status,last_exported_at=case when p_successful then excluded.last_exported_at else developer_company_backup_status.last_exported_at end,last_exported_by=case when p_successful then excluded.last_exported_by else developer_company_backup_status.last_exported_by end,last_error=excluded.last_error returning * into saved;
  update public.developer_backup_runs set successful_companies=successful_companies+case when p_successful then 1 else 0 end,failed_companies=failed_companies+case when p_successful then 0 else 1 end where id=p_run_id;
  return saved;
end $$;

create or replace function public.complete_developer_backup_run(p_run_id uuid)
returns public.developer_backup_runs language plpgsql security definer set search_path=public
as $$ declare saved public.developer_backup_runs; begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  update public.developer_backup_runs set completed_at=now(),status=case when failed_companies=0 then 'successful' when successful_companies=0 then 'failed' else 'partial' end where id=p_run_id and status='running' returning * into saved;
  if saved.id is null then raise exception 'Backup run is not active'; end if; return saved;
end $$;

revoke all on table public.developer_backup_runs,public.developer_company_backup_status from public,anon,authenticated;
grant select on table public.developer_backup_runs,public.developer_company_backup_status to authenticated;
revoke all on function public.developer_export_company_backup(uuid),public.start_developer_backup_run(integer),public.record_developer_company_backup_result(uuid,uuid,boolean,text),public.complete_developer_backup_run(uuid) from public,anon;
grant execute on function public.developer_export_company_backup(uuid),public.start_developer_backup_run(integer),public.record_developer_company_backup_result(uuid,uuid,boolean,text),public.complete_developer_backup_run(uuid) to authenticated;

-- Automated cloud backup and Windows agent
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

alter table public.developer_backup_runs alter column initiated_by drop not null;
alter table public.developer_backup_runs add column if not exists initiator_type text not null default 'manual'
  check (initiator_type in ('manual','automated','agent_retry'));

create table if not exists public.developer_backup_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  token_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
alter table public.developer_backup_agents enable row level security;
drop policy if exists developer_backup_agents_select on public.developer_backup_agents;
create policy developer_backup_agents_select on public.developer_backup_agents for select using ((select public.is_developer_admin()));

create or replace function public.create_developer_backup_agent(p_name text default 'Windows Backup Agent')
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$ declare saved public.developer_backup_agents; secret text; begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  secret:=encode(gen_random_bytes(32),'hex');
  insert into public.developer_backup_agents(name,token_hash,created_by) values(left(btrim(coalesce(nullif(p_name,''),'Windows Backup Agent')),100),encode(digest(secret,'sha256'),'hex'),auth.uid()) returning * into saved;
  return jsonb_build_object('id',saved.id,'name',saved.name,'token',saved.id::text||'.'||secret,'created_at',saved.created_at);
end $$;

create or replace function public.revoke_developer_backup_agent(p_agent_id uuid)
returns void language plpgsql security definer set search_path=public
as $$ begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  update public.developer_backup_agents set revoked_at=now() where id=p_agent_id;
end $$;

create or replace function public.list_developer_backup_agents()
returns table(id uuid,name text,created_at timestamptz,last_seen_at timestamptz,revoked_at timestamptz)
language plpgsql stable security definer set search_path=public
as $$ begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  return query select a.id,a.name,a.created_at,a.last_seen_at,a.revoked_at from public.developer_backup_agents a order by a.created_at desc;
end $$;

create or replace function public.system_export_company_backup(target_company uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$ declare result jsonb; begin
  if current_user <> 'service_role' and current_setting('request.jwt.claim.role',true) <> 'service_role' then raise exception 'Server backup access required' using errcode='42501'; end if;
  if not exists(select 1 from public.companies where id=target_company) then raise exception 'Company not found' using errcode='P0002'; end if;
  select jsonb_build_object(
    'company',to_jsonb(c)-array['developer_notes','owner_email','user_id'],
    'accountCategories',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.account_categories x where x.company_id=target_company),'[]'::jsonb),
    'itemCategories',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.item_categories x where x.company_id=target_company),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.accounts x where x.company_id=target_company),'[]'::jsonb),
    'parties',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.parties x where x.company_id=target_company),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.items x where x.company_id=target_company),'[]'::jsonb),
    'vouchers',coalesce((select jsonb_agg((to_jsonb(v)-array['created_by','updated_by','completed_by'])||jsonb_build_object(
      'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.voucher_lines l where l.voucher_id=v.id),'[]'::jsonb),
      'stock_lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.stock_lines l where l.voucher_id=v.id),'[]'::jsonb),
      'invoice_items',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.invoice_items l where l.voucher_id=v.id),'[]'::jsonb),
      'settlements',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.voucher_settlements l where l.settlement_voucher_id=v.id),'[]'::jsonb)
    ) order by v.date_bs_key,v.seq,v.id) from public.vouchers v where v.company_id=target_company),'[]'::jsonb),
    'chequeBanks',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.created_at,x.id) from public.cheque_banks x where x.company_id=target_company),'[]'::jsonb),
    'cheques',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.created_at,x.id) from public.cheques x where x.company_id=target_company),'[]'::jsonb),
    'chequeEvents',coalesce((select jsonb_agg(to_jsonb(x)-array['actor_id'] order by x.created_at,x.id) from public.cheque_events x where x.company_id=target_company),'[]'::jsonb),
    'companyModules',coalesce((select jsonb_agg((to_jsonb(x)-array['enabled_by','internal_notes'])||jsonb_build_object('module_key',m.key) order by x.created_at,x.id) from public.company_modules x join public.modules m on m.id=x.module_id where x.company_id=target_company),'[]'::jsonb),
    'masterChangeLogs',coalesce((select jsonb_agg(to_jsonb(x)-array['user_id'] order by x.created_at,x.id) from public.master_change_logs x where x.company_id=target_company),'[]'::jsonb),
    'appEvents',coalesce((select jsonb_agg(to_jsonb(x)-array['user_id'] order by x.created_at,x.id) from public.app_events x where x.company_id=target_company),'[]'::jsonb)
  ) into result from public.companies c where c.id=target_company;
  return result;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('developer-company-backups','developer-company-backups',false,52428800,array['application/json'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

do $$ begin
  if exists(select 1 from cron.job where jobname='khataerp-automated-company-backup') then perform cron.unschedule('khataerp-automated-company-backup'); end if;
  perform cron.schedule('khataerp-automated-company-backup','0 */2 * * *',$job$
    select net.http_post(
      url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/developer-backup',
      headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',(select decrypted_secret from vault.decrypted_secrets where name='backup_automation_secret')),
      body:='{"action":"run"}'::jsonb,
      timeout_milliseconds:=600000
    );
  $job$);
end $$;

revoke all on table public.developer_backup_agents from public,anon,authenticated;
revoke all on function public.system_export_company_backup(uuid) from public,anon,authenticated;
grant execute on function public.system_export_company_backup(uuid) to service_role;
revoke all on function public.create_developer_backup_agent(text),public.revoke_developer_backup_agent(uuid),public.list_developer_backup_agents() from public,anon;
grant execute on function public.create_developer_backup_agent(text),public.revoke_developer_backup_agent(uuid),public.list_developer_backup_agents() to authenticated;

-- One trial per user, company paid terms, and authoritative read-only enforcement.
begin;

alter table public.companies add column if not exists plan_expires_at timestamptz;

-- Preserve the effective access of legacy rows. The old date was inclusive in
-- Nepal time, so its equivalent timestamp is midnight immediately afterward.
update public.companies
set plan_expires_at = case
  when trial_ends_at is not null then ((trial_ends_at + 1)::timestamp at time zone 'Asia/Kathmandu')
  else created_at + interval '14 days'
end
where plan_status = 'trial' and plan_expires_at is null;

update public.companies
set plan_expires_at = ((trial_ends_at + 1)::timestamp at time zone 'Asia/Kathmandu')
where plan_status = 'paid' and plan_expires_at is null and trial_ends_at is not null;

create or replace function public.company_billing_status(target_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  company_row public.companies%rowtype;
  effective_status text;
  remaining_days integer;
  elapsed_days integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_developer_admin() and not public.is_company_admin(target_company) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  select * into company_row from public.companies where id = target_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;

  effective_status := case
    when company_row.suspended then 'suspended'
    when company_row.plan_status = 'expired' then 'expired'
    when company_row.plan_status in ('trial','paid')
      and company_row.plan_expires_at is not null
      and company_row.plan_expires_at <= clock_timestamp() then 'expired'
    else company_row.plan_status
  end;
  if company_row.plan_expires_at is not null then
    remaining_days := greatest(ceil(extract(epoch from (company_row.plan_expires_at - clock_timestamp())) / 86400.0)::integer, 0);
    elapsed_days := greatest(ceil(extract(epoch from (clock_timestamp() - company_row.plan_expires_at)) / 86400.0)::integer, 0);
  end if;
  return jsonb_build_object(
    'configured_status', company_row.plan_status,
    'effective_status', effective_status,
    'expires_at', company_row.plan_expires_at,
    'remaining_days', remaining_days,
    'days_since_expiry', elapsed_days,
    'can_write', effective_status not in ('expired','suspended')
  );
end;
$$;

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
    raise exception 'Company logo must use an HTTPS URL' using errcode = '22023';
  end if;
  if new.owner_email is distinct from old.owner_email
    and new.owner_email is distinct from nullif(auth.jwt()->>'email', '') then
    raise exception 'Company owner email must match the authenticated user' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
    or new.plan_status is distinct from old.plan_status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.plan_expires_at is distinct from old.plan_expires_at
    or new.support_status is distinct from old.support_status
    or new.developer_notes is distinct from old.developer_notes
    or new.suspended is distinct from old.suspended then
    raise exception 'Developer-controlled company fields cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_tenant_write_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  company_row public.companies%rowtype;
  signup_at timestamptz;
  initializing_company text;
begin
  if auth.uid() is null or public.is_developer_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_argv[0] = 'company' then
    target_company := case when tg_op = 'DELETE' then old.id else new.id end;
    if tg_op = 'INSERT' then
      if new.user_id is distinct from auth.uid() or new.plan_status is distinct from 'trial'
        or new.trial_ends_at is not null or new.plan_expires_at is not null
        or new.support_status is distinct from 'normal' or new.developer_notes is not null
        or coalesce(new.suspended, false) then
        raise exception 'New company security fields are invalid' using errcode = '42501';
      end if;
      select created_at into signup_at from auth.users where id = auth.uid();
      new.plan_expires_at := signup_at + interval '14 days';
      new.trial_ends_at := (new.plan_expires_at at time zone 'Asia/Kathmandu')::date;
      return new;
    end if;
  elsif tg_argv[0] = 'voucher_child' then
    select voucher.company_id into target_company from public.vouchers voucher
    where voucher.id = case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  else
    target_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  end if;

  if target_company is null and tg_op = 'DELETE' then return old; end if;
  select * into company_row from public.companies where id = target_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;
  initializing_company := current_setting('khataerp.initializing_company', true);
  if initializing_company = target_company::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not public.is_company_admin(target_company) then
    raise exception 'Company write access denied' using errcode = '42501';
  end if;

  if (company_row.suspended or company_row.plan_status = 'expired'
      or (company_row.plan_status in ('trial','paid') and company_row.plan_expires_at is not null
          and company_row.plan_expires_at <= clock_timestamp()))
    and not (tg_argv[0] = 'company' and tg_op = 'DELETE') then
    raise exception 'Company plan expired. This company is read-only until renewed.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists company_control_fields_guard on public.companies;
create trigger company_control_fields_guard before update on public.companies
for each row execute function public.protect_company_control_fields();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'accounts','account_categories','parties','items','item_categories','master_change_logs',
    'vouchers','voucher_settlements','app_events','cheque_banks','cheques','cheque_events','company_modules',
    'company_members','company_user_permissions'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists tenant_write_access_guard on public.%I', table_name);
      execute format('create trigger tenant_write_access_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write_access(%L)', table_name, 'direct');
    end if;
  end loop;
  foreach table_name in array array['voucher_lines','stock_lines','invoice_items'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists tenant_write_access_guard on public.%I', table_name);
      execute format('create trigger tenant_write_access_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write_access(%L)', table_name, 'voucher_child');
    end if;
  end loop;
end $$;

drop trigger if exists tenant_write_access_guard on public.companies;
create trigger tenant_write_access_guard before insert or update or delete on public.companies
for each row execute function public.enforce_tenant_write_access('company');

-- Keep atomic initialization working even when a user first confirms their
-- email after the shared trial deadline. The resulting company is read-only.
create or replace function public.create_company_atomic(p_company jsonb)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare caller uuid := auth.uid(); generated_company_id uuid := gen_random_uuid(); user_email text; saved public.companies%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform public.assert_company_creation_allowed(caller);
  select email into user_email from auth.users where id = caller;
  perform set_config('khataerp.initializing_company', generated_company_id::text, true);
  insert into public.companies(id,user_id,owner_email,name,address,pan_vat,phone,vat_enabled,inventory_valuation_method,sales_prefix,purchase_prefix,receipt_prefix,payment_prefix,sales_return_prefix,purchase_return_prefix,journal_numbering_mode,reset_numbering_fiscal_year,print_format,invoice_terms,payment_qr_text,fiscal_year_start,fiscal_year_configured)
  values(generated_company_id,caller,user_email,coalesce(nullif(btrim(coalesce(p_company->>'name','')),''),'My Company'),nullif(btrim(coalesce(p_company->>'address','')),''),nullif(btrim(coalesce(p_company->>'pan_vat','')),''),nullif(btrim(coalesce(p_company->>'phone','')),''),coalesce((p_company->>'vat_enabled')::boolean,true),coalesce(nullif(p_company->>'inventory_valuation_method',''),'weighted_average'),coalesce(nullif(btrim(p_company->>'sales_prefix'),''),'INV-'),coalesce(nullif(btrim(p_company->>'purchase_prefix'),''),'PB-'),coalesce(nullif(btrim(p_company->>'receipt_prefix'),''),'RCPT-'),coalesce(nullif(btrim(p_company->>'payment_prefix'),''),'PAY-'),coalesce(nullif(btrim(p_company->>'sales_return_prefix'),''),'SR-'),coalesce(nullif(btrim(p_company->>'purchase_return_prefix'),''),'PR-'),coalesce(nullif(p_company->>'journal_numbering_mode',''),'auto'),true,coalesce(nullif(p_company->>'print_format',''),'A5'),nullif(btrim(coalesce(p_company->>'invoice_terms','')),''),nullif(btrim(coalesce(p_company->>'payment_qr_text','')),''),coalesce(nullif(p_company->>'fiscal_year_start','')::date,'2026-07-17'::date),coalesce((p_company->>'fiscal_year_configured')::boolean,true)) returning * into saved;
  insert into public.company_members(company_id,user_id,role,status,created_by) values(saved.id,caller,'Admin','active',caller)
  on conflict(company_id,user_id) do update set role='Admin',status='active',updated_at=now();
  perform public.ensure_default_company_accounts(saved.id);
  perform public.set_active_company(saved.id);
  perform set_config('khataerp.initializing_company', '', true);
  return saved;
end;
$$;

revoke all on function public.company_billing_status(uuid) from public, anon;
grant execute on function public.company_billing_status(uuid) to authenticated;
revoke all on function public.enforce_tenant_write_access(), public.protect_company_control_fields() from public, anon, authenticated;

commit;


begin;

create or replace function public.delete_developer_backup_agent(p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_developer_admin() then
    raise exception 'Developer admin access required' using errcode = '42501';
  end if;
  delete from public.developer_backup_agents where id = p_agent_id;
  if not found then raise exception 'Windows backup agent not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.delete_developer_backup_agent(uuid) from public, anon;
grant execute on function public.delete_developer_backup_agent(uuid) to authenticated;

commit;

-- After running this schema, set your environment variables:
--   VITE_SUPABASE_URL      = https://your-project-id.supabase.co
--   VITE_SUPABASE_ANON_KEY = your-anon-public-key
-- Both are in: Supabase dashboard â†’ Settings â†’ API
-- END SYNCED DB FILE: supabase-schema.sql

-- BEGIN SYNCED DB FILE: supabase-masters-migration.sql
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
-- END SYNCED DB FILE: supabase-masters-migration.sql

-- BEGIN SYNCED DB FILE: supabase-returns-migration.sql
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
alter table invoice_items add column if not exists discount_amount numeric(18,6);
alter table invoice_items add column if not exists taxable_amount numeric(18,6);
alter table invoice_items add column if not exists vat_amount numeric(18,6);
alter table invoice_items add column if not exists cost_rate numeric(18,6);

-- Replace this exact constraint deterministically. The former definition
-- searched for any CHECK containing "type", which could drop another check
-- and then collide with an existing vouchers_type_check after a partial run.
alter table public.vouchers drop constraint if exists vouchers_type_check;
alter table public.vouchers add constraint vouchers_type_check
  check (type in ('Sales','Purchase','Sales Return','Purchase Return','Receipt','Payment','Journal','Stock Adjustment'));

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
-- END SYNCED DB FILE: supabase-returns-migration.sql

-- BEGIN SYNCED DB FILE: supabase-integrity-migration.sql
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
-- END SYNCED DB FILE: supabase-integrity-migration.sql

-- BEGIN SYNCED DB FILE: supabase-fiscal-voucher-numbering-migration.sql
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
-- END SYNCED DB FILE: supabase-fiscal-voucher-numbering-migration.sql

-- BEGIN SYNCED DB FILE: supabase-stock-condition-migration.sql
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
end $$;

create index if not exists idx_slines_item_condition
  on public.stock_lines(item_id, stock_condition);

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-stock-condition-migration.sql

-- BEGIN SYNCED DB FILE: supabase-alternative-units-migration.sql
-- Main/alternative unit support. Apply after the base schema.
begin;

alter table public.items add column if not exists alternate_unit text;
alter table public.items add column if not exists alternate_conversion numeric(18,6);

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
alter table public.invoice_items add column if not exists conversion_factor numeric(18,6) not null default 1;
alter table public.invoice_items add column if not exists base_qty numeric(18,6);

update public.invoice_items
set entry_unit = coalesce(entry_unit, unit),
    conversion_factor = coalesce(conversion_factor, 1),
    base_qty = coalesce(base_qty, qty / nullif(coalesce(conversion_factor, 1), 0))
where entry_unit is null or base_qty is null;

alter table public.invoice_items drop constraint if exists invoice_items_conversion_factor_check;
alter table public.invoice_items add constraint invoice_items_conversion_factor_check check (conversion_factor >= 1);

commit;
-- END SYNCED DB FILE: supabase-alternative-units-migration.sql

-- BEGIN SYNCED DB FILE: supabase-category-hierarchy-migration.sql
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
-- END SYNCED DB FILE: supabase-category-hierarchy-migration.sql

-- BEGIN SYNCED DB FILE: supabase-sundry-parties-migration.sql
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
-- END SYNCED DB FILE: supabase-sundry-parties-migration.sql

-- BEGIN SYNCED DB FILE: supabase-multiple-bank-accounts-migration.sql
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
-- END SYNCED DB FILE: supabase-multiple-bank-accounts-migration.sql

-- BEGIN SYNCED DB FILE: supabase-system-account-groups-migration.sql
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
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = root.account_type
      and lower(btrim(existing.name)) = lower(btrim(root.name))
  )
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
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = child.account_type
      and lower(btrim(existing.name)) = lower(btrim(child.name))
  )
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
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = child.account_type
      and lower(btrim(existing.name)) = lower(btrim(child.name))
  )
  on conflict (company_id, name, account_type) do update
  set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;

  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, 'Employees / Staffs', 'Asset', parent.id, true, false
  from public.account_categories parent
  where parent.company_id = target_company_id
    and parent.name = 'Loans & Advances (Asset)'
    and parent.account_type = 'Asset'
    and not exists (
      select 1 from public.account_categories existing
      where existing.company_id = target_company_id
        and existing.account_type = 'Asset'
        and lower(btrim(existing.name)) = lower('Employees / Staffs')
    )
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
-- END SYNCED DB FILE: supabase-system-account-groups-migration.sql

-- BEGIN SYNCED DB FILE: supabase-employee-staff-account-category-migration.sql
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
-- END SYNCED DB FILE: supabase-employee-staff-account-category-migration.sql

-- BEGIN SYNCED DB FILE: supabase-retained-earnings-ledger-migration.sql
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
-- END SYNCED DB FILE: supabase-retained-earnings-ledger-migration.sql

-- BEGIN SYNCED DB FILE: supabase-single-company-per-user-migration.sql
-- Compatibility migration retained for historical deployment order.
-- KhataERP now supports multiple companies per user through company_members.
-- Never merge companies or recreate companies_user_id_unique.
begin;
drop index if exists public.companies_user_id_unique;
commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-single-company-per-user-migration.sql

-- BEGIN SYNCED DB FILE: supabase-credit-days-migration.sql
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
-- END SYNCED DB FILE: supabase-credit-days-migration.sql

-- BEGIN SYNCED DB FILE: supabase-ledger-details-migration.sql
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
-- END SYNCED DB FILE: supabase-ledger-details-migration.sql

-- BEGIN SYNCED DB FILE: supabase-inventory-valuation-migration.sql
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
-- END SYNCED DB FILE: supabase-inventory-valuation-migration.sql

-- BEGIN SYNCED DB FILE: supabase-voucher-settlements-migration.sql
-- KhataERP invoice settlement allocation migration
-- Safe to run more than once in Supabase SQL Editor.

create extension if not exists "uuid-ossp";

create table if not exists voucher_settlements (
  id                    uuid primary key default uuid_generate_v4(),
  company_id            uuid not null references companies(id) on delete cascade,
  settlement_voucher_id uuid not null references vouchers(id) on delete cascade,
  invoice_voucher_id    uuid not null references vouchers(id) on delete cascade,
  party_account_id      text not null references accounts(id),
  amount                numeric(18,6) not null check (amount > 0),
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

-- END SYNCED DB FILE: supabase-voucher-settlements-migration.sql

-- BEGIN SYNCED DB FILE: supabase-cheque-management-migration.sql
-- Optional tenant-level Cheque Management module (received cheques only).
begin;

create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(), key text not null unique, name text not null,
  description text, default_price numeric(18,6) not null default 0, is_active boolean not null default true,
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
  price numeric(18,6) not null default 0, payment_status text not null default 'pending' check(payment_status in ('paid','pending','overdue','waived','cancelled')),
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
  party_ledger_id text not null references public.accounts(id), amount numeric(18,6) not null check(amount>0),
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
-- END SYNCED DB FILE: supabase-cheque-management-migration.sql

-- BEGIN SYNCED DB FILE: supabase-atomic-voucher-posting-migration.sql
-- Phase 4: atomic voucher posting.
-- Apply after the base schema, integrity, alternative-unit, multiple-bank, and
-- voucher-settlement migrations. Safe to run repeatedly.
begin;

alter table public.vouchers add column if not exists idempotency_key uuid;
alter table public.vouchers add column if not exists status text not null default 'Completed';
alter table public.vouchers drop constraint if exists vouchers_status_check;
alter table public.vouchers add constraint vouchers_status_check check (status in ('Draft','Completed'));
alter table public.vouchers add column if not exists created_by uuid references auth.users(id);
alter table public.vouchers add column if not exists updated_by uuid references auth.users(id);
alter table public.vouchers add column if not exists updated_at timestamptz not null default now();
alter table public.vouchers add column if not exists completed_by uuid references auth.users(id);
alter table public.vouchers add column if not exists completed_at timestamptz;
alter table public.vouchers add column if not exists draft_payload jsonb;
create unique index if not exists vouchers_company_idempotency_unique
  on public.vouchers(company_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.numeric_json_scale_valid(payload jsonb, numeric_keys text[])
returns boolean language sql immutable set search_path = public as $$
  select not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(payload) = 'array' then payload else jsonb_build_array(payload) end) object_value
    cross join unnest(numeric_keys) key_name
    where object_value ? key_name
      and nullif(object_value->>key_name, '') is not null
      and (object_value->>key_name)::numeric <> round((object_value->>key_name)::numeric, 6)
  );
$$;

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
      'id', item.id, 'item_id', item.item_id, 'qty', item.qty, 'rate', item.rate, 'amount', item.amount,
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
  target_status text;
  next_seq integer;
  highest_number bigint;
  generated_number text;
  debit_total numeric(18,6);
  credit_total numeric(18,6);
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
  target_status := coalesce(nullif(p_voucher->>'status', ''), 'Completed');
  if target_status not in ('Draft', 'Completed') then
    raise exception 'Voucher status must be Draft or Completed';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_stock_lines, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_invoice_items, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_settlements, '[]'::jsonb)) <> 'array' then
    raise exception 'Voucher child payloads must be arrays';
  end if;
  if not public.numeric_json_scale_valid(p_voucher, array['subtotal','discount','vat_amount','total','contra_charge_amount'])
    or not public.numeric_json_scale_valid(coalesce(p_lines,'[]'::jsonb), array['debit','credit'])
    or not public.numeric_json_scale_valid(coalesce(p_stock_lines,'[]'::jsonb), array['qty','rate'])
    or not public.numeric_json_scale_valid(coalesce(p_invoice_items,'[]'::jsonb), array['qty','rate','amount','discount_amount','taxable_amount','vat_amount','cost_rate','conversion_factor','base_qty'])
    or not public.numeric_json_scale_valid(coalesce(p_settlements,'[]'::jsonb), array['amount']) then
    raise exception 'Accounting values support at most six decimal places';
  end if;

  select coalesce(sum(coalesce(line.debit, 0)), 0),
         coalesce(sum(coalesce(line.credit, 0)), 0)
    into debit_total, credit_total
  from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
    as line(account_id text, debit numeric, credit numeric);
  if abs(debit_total - credit_total) > 0.000001 then
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
      status, created_by, updated_by, updated_at, completed_by, completed_at,
      draft_payload, idempotency_key
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
      target_status, auth.uid(), auth.uid(), now(),
      case when target_status = 'Completed' then auth.uid() else null end,
      case when target_status = 'Completed' then now() else null end,
      case when p_voucher ? 'draft_payload' then p_voucher->'draft_payload' else null end,
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
      cancelled = case when p_voucher ? 'cancelled' then (p_voucher->>'cancelled')::boolean else voucher.cancelled end,
      status = case when p_voucher ? 'status' then target_status else voucher.status end,
      updated_by = auth.uid(),
      updated_at = now(),
      completed_by = case when p_voucher ? 'status' and target_status = 'Completed' and voucher.status = 'Draft' then auth.uid() else voucher.completed_by end,
      completed_at = case when p_voucher ? 'status' and target_status = 'Completed' and voucher.status = 'Draft' then now() else voucher.completed_at end,
      draft_payload = case when p_voucher ? 'draft_payload' then p_voucher->'draft_payload' else voucher.draft_payload end
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
     and voucher.status = 'Completed'
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
    voucher_id, item_id, qty, rate, amount, source_invoice_item_id, item_name, unit,
    entry_unit, conversion_factor, base_qty, discount_amount, taxable_amount,
    vat_amount, cost_rate
  )
  select saved.id, item.item_id, item.qty, item.rate, coalesce(item.amount, round(item.qty * item.rate, 6)), item.source_invoice_item_id,
         item.item_name, item.unit, item.entry_unit, coalesce(item.conversion_factor, 1),
         item.base_qty, item.discount_amount, item.taxable_amount, item.vat_amount, item.cost_rate
  from jsonb_to_recordset(coalesce(p_invoice_items, '[]'::jsonb)) as item(
    item_id uuid, qty numeric, rate numeric, amount numeric, source_invoice_item_id uuid,
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
-- END SYNCED DB FILE: supabase-atomic-voucher-posting-migration.sql

-- BEGIN SYNCED DB FILE: supabase-write-query-optimization-migration.sql
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
-- END SYNCED DB FILE: supabase-write-query-optimization-migration.sql

-- BEGIN SYNCED DB FILE: supabase-trigger-rls-optimization-migration.sql
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
-- END SYNCED DB FILE: supabase-trigger-rls-optimization-migration.sql

-- BEGIN SYNCED DB FILE: supabase-personal-data-protection-migration.sql
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

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-personal-data-protection-migration.sql

-- BEGIN SYNCED DB FILE: supabase-production-security-migration.sql
-- Production error-log access hardening. Safe to run repeatedly.
begin;

-- Retailer sessions may insert their own operational events but cannot read
-- sanitized stack/file details back through PostgREST. Developer
-- administrators retain support access through app_events_developer_select.
drop policy if exists "app_events_own_select" on public.app_events;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-production-security-migration.sql

-- BEGIN SYNCED DB FILE: supabase-critical-security-hardening-migration.sql
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

  if abs(debit_total - credit_total) > 0.000001 then
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

  if length(coalesce(voucher_record.narration, '')) > 4000
    or length(coalesce(voucher_record.return_reason, '')) > 2000
    or length(coalesce(voucher_record.invoice_no, '')) > 100 then
    raise exception 'Voucher text exceeds the allowed length';
  end if;

  if coalesce(voucher_record.status, 'Completed') = 'Draft' then
    return null;
  end if;

  if voucher_record.type <> 'Stock Adjustment' then
    if line_count < 2 then raise exception 'Posted vouchers require at least two ledger lines'; end if;
    if abs(coalesce(voucher_record.total, 0) - debit_total) > 0.000001 then
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
           coalesce(sum(item.amount), 0),
           coalesce(sum(coalesce(item.discount_amount, 0)), 0),
           coalesce(sum(coalesce(item.taxable_amount, item.amount)), 0),
           coalesce(sum(coalesce(item.vat_amount, 0)), 0)
      into item_count, calculated_subtotal, calculated_discount,
           calculated_taxable, calculated_vat
    from public.invoice_items item
    where item.voucher_id = target_voucher_id;

    if item_count = 0 or exists (
      select 1 from public.invoice_items item
      where item.voucher_id = target_voucher_id
        and (item.qty <= 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0
          or (item.base_qty is not null and abs(item.base_qty - item.qty / nullif(coalesce(item.conversion_factor, 1), 0)) > 0.0001))
    ) then raise exception 'Invoice items require positive quantities and non-negative rates'; end if;

    if voucher_record.type in ('Sales','Purchase') then
      calculated_discount := coalesce(voucher_record.discount, 0);
      if calculated_discount < 0 or calculated_discount > calculated_subtotal then
        raise exception 'Invoice discount is outside the valid range';
      end if;
      calculated_taxable := round(calculated_subtotal - calculated_discount, 6);
      if coalesce(voucher_record.vat_rate, 0) < 0 or coalesce(voucher_record.vat_rate, 0) > 100 then
        raise exception 'VAT rate is outside the valid range';
      end if;
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6);
      -- Preserve Sales/Purchase vouchers posted by the former two-decimal
      -- engine when their stored VAT is ordinary half-paisa rounding.
      if abs(coalesce(voucher_record.vat_amount, 0) - calculated_vat) > 0.005 then
        raise exception 'Invoice totals do not match server-calculated values';
      end if;
      calculated_vat := coalesce(voucher_record.vat_amount, calculated_vat);
    else
      if calculated_discount < 0 or calculated_discount > calculated_subtotal then
        raise exception 'Return discount is outside the valid range';
      end if;
      if abs(calculated_taxable - round(calculated_subtotal - calculated_discount, 6)) > 0.000001 then
        raise exception 'Return taxable amounts are inconsistent';
      end if;
      if coalesce(voucher_record.vat_rate, 0) < 0 or coalesce(voucher_record.vat_rate, 0) > 100 then
        raise exception 'Return VAT rate is outside the valid range';
      end if;
      -- Preserve portable backups from the former two-decimal accounting
      -- engine. A half-paisa tolerance accepts only ordinary currency
      -- rounding; current six-decimal entries still match exactly.
      if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 6)) > 0.005 then
        raise exception 'Return VAT does not match server-calculated VAT';
      end if;
      if voucher_record.original_voucher_id is null and calculated_discount <> 0 then
        raise exception 'A manual return cannot introduce an invoice discount';
      end if;
    end if;

    calculated_total := round(calculated_taxable + calculated_vat, 6);
    if abs(coalesce(voucher_record.subtotal, 0) - calculated_subtotal) > 0.000001
      or abs(coalesce(voucher_record.discount, 0) - calculated_discount) > 0.000001
      or abs(coalesce(voucher_record.vat_amount, 0) - calculated_vat) > 0.000001
      or abs(coalesce(voucher_record.total, 0) - calculated_total) > 0.000001 then
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
                   invoice_item.qty / nullif(coalesce(invoice_item.conversion_factor, 1), 0))) as qty
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
        then round(coalesce(source_voucher.discount, 0) * calculated_subtotal / source_voucher.subtotal, 6)
      else 0
    end;
    -- Legacy returns allocated and rounded discount per line to two decimals.
    -- Bound compatibility by half a paisa for each returned line.
    if abs(calculated_discount - expected_discount) > greatest(0.000002, item_count * 0.005) then
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
          or abs(source.rate - returned.rate) > 0.000001)
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

  if abs(destination_debit - new.amount) > 0.000001
    or abs(party_credit - new.amount) > 0.000001 then
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
-- END SYNCED DB FILE: supabase-critical-security-hardening-migration.sql

-- BEGIN SYNCED DB FILE: supabase-developer-error-log-cleanup-migration.sql
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
-- END SYNCED DB FILE: supabase-developer-error-log-cleanup-migration.sql

-- BEGIN SYNCED DB FILE: supabase-developer-company-delete-rpc-migration.sql
-- Developer-only company deletion in dependency order.
-- Fixes FK failures from account/item/voucher child tables during company cleanup.
-- Safe to rerun.

begin;

create or replace function public.delete_developer_company(target_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  account_category_guard_exists boolean;
begin
  if not public.is_developer_admin() then
    raise exception 'Developer admin access required' using errcode = '42501';
  end if;

  if target_company is null then
    raise exception 'Company id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.companies company where company.id = target_company) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  perform 1 from public.companies company where company.id = target_company for update;

  select exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.account_categories'::regclass
      and trigger_row.tgname = 'account_category_system_guard'
      and not trigger_row.tgisinternal
  ) into account_category_guard_exists;

  if account_category_guard_exists then
    execute 'alter table public.account_categories disable trigger account_category_system_guard';
  end if;

  begin
  update public.user_preferences
  set active_company_id = null,
      updated_at = now()
  where active_company_id = target_company;

  if to_regclass('public.cheque_events') is not null then
    delete from public.cheque_events where company_id = target_company;
  end if;
  if to_regclass('public.cheques') is not null then
    delete from public.cheques where company_id = target_company;
  end if;
  if to_regclass('public.cheque_banks') is not null then
    delete from public.cheque_banks where company_id = target_company;
  end if;

  delete from public.voucher_settlements settlement
  where settlement.company_id = target_company
     or exists (select 1 from public.vouchers voucher where voucher.id = settlement.settlement_voucher_id and voucher.company_id = target_company)
     or exists (select 1 from public.vouchers voucher where voucher.id = settlement.invoice_voucher_id and voucher.company_id = target_company);

  update public.invoice_items item
  set source_invoice_item_id = null
  where source_invoice_item_id is not null
    and (
      exists (select 1 from public.vouchers voucher where voucher.id = item.voucher_id and voucher.company_id = target_company)
      or exists (
        select 1
        from public.invoice_items source_item
        join public.vouchers source_voucher on source_voucher.id = source_item.voucher_id
        where source_item.id = item.source_invoice_item_id
          and source_voucher.company_id = target_company
      )
    );

  delete from public.invoice_items item
  where exists (select 1 from public.vouchers voucher where voucher.id = item.voucher_id and voucher.company_id = target_company);

  delete from public.stock_lines line
  where exists (select 1 from public.vouchers voucher where voucher.id = line.voucher_id and voucher.company_id = target_company);

  delete from public.voucher_lines line
  where exists (select 1 from public.vouchers voucher where voucher.id = line.voucher_id and voucher.company_id = target_company);

  update public.vouchers voucher
  set original_voucher_id = null
  where voucher.original_voucher_id is not null
    and exists (select 1 from public.vouchers original where original.id = voucher.original_voucher_id and original.company_id = target_company);

  delete from public.vouchers where company_id = target_company;

  delete from public.parties where company_id = target_company;
  delete from public.master_change_logs where company_id = target_company;

  delete from public.items where company_id = target_company;

  update public.item_categories
  set parent_category_id = null
  where company_id = target_company
    and parent_category_id is not null;
  delete from public.item_categories where company_id = target_company;

  delete from public.accounts where company_id = target_company;

  update public.account_categories
  set parent_category_id = null
  where company_id = target_company
    and parent_category_id is not null;
  delete from public.account_categories where company_id = target_company;

  if to_regclass('public.company_modules') is not null then
    delete from public.company_modules where company_id = target_company;
  end if;
  if to_regclass('public.company_user_permissions') is not null then
    delete from public.company_user_permissions where company_id = target_company;
  end if;

  delete from public.company_members where company_id = target_company;
  delete from public.app_events where company_id = target_company;
  delete from public.companies where id = target_company;

  exception when others then
    if account_category_guard_exists then
      execute 'alter table public.account_categories enable trigger account_category_system_guard';
    end if;
    raise;
  end;

  if account_category_guard_exists then
    execute 'alter table public.account_categories enable trigger account_category_system_guard';
  end if;
end;
$$;

revoke all on function public.delete_developer_company(uuid) from public, anon;
grant execute on function public.delete_developer_company(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-developer-company-delete-rpc-migration.sql

-- BEGIN SYNCED DB FILE: supabase-developer-schema-status-policy-check-fix.sql
-- Fix developer dashboard schema-status policy check after multi-company RLS.
-- Safe to rerun.

begin;

create or replace function public.get_developer_schema_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  checks jsonb := '[]'::jsonb;
begin
  if not public.is_developer_admin() then
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
    'status', case when (
                     exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_developer_all')
                     or (
                       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_developer_select')
                       and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_developer_delete')
                     )
                   )
                   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_events' and policyname = 'app_events_developer_select')
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
end;
$$;

revoke all on function public.get_developer_schema_status() from public, anon;
grant execute on function public.get_developer_schema_status() to authenticated;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-developer-schema-status-policy-check-fix.sql

-- BEGIN SYNCED DB FILE: supabase-financial-year-control-migration.sql
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
  if coalesce(new.date_ad, new.date) > (clock_timestamp() at time zone 'Asia/Kathmandu')::date then
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
-- END SYNCED DB FILE: supabase-financial-year-control-migration.sql

-- BEGIN SYNCED DB FILE: supabase-zero-value-invoices-migration.sql
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
-- END SYNCED DB FILE: supabase-zero-value-invoices-migration.sql

-- BEGIN SYNCED DB FILE: supabase-journal-supplier-invoice-migration.sql
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
-- END SYNCED DB FILE: supabase-journal-supplier-invoice-migration.sql

-- BEGIN SYNCED DB FILE: supabase-draft-vouchers-migration.sql
-- Draft voucher workflow columns.
-- Apply after the voucher schema and atomic posting migrations. Safe to rerun.
begin;

alter table public.vouchers add column if not exists status text not null default 'Completed';
alter table public.vouchers drop constraint if exists vouchers_status_check;
alter table public.vouchers add constraint vouchers_status_check check (status in ('Draft','Completed'));
alter table public.vouchers add column if not exists created_by uuid references auth.users(id);
alter table public.vouchers add column if not exists updated_by uuid references auth.users(id);
alter table public.vouchers add column if not exists updated_at timestamptz not null default now();
alter table public.vouchers add column if not exists completed_by uuid references auth.users(id);
alter table public.vouchers add column if not exists completed_at timestamptz;
alter table public.vouchers add column if not exists draft_payload jsonb;
alter table public.vouchers add column if not exists draft_no text;

update public.vouchers
set status = 'Completed',
    completed_at = coalesce(completed_at, created_at)
where status is null;

create index if not exists idx_vouchers_company_status on public.vouchers(company_id, status);
create unique index if not exists vouchers_company_draft_no_unique
  on public.vouchers(company_id, draft_no)
  where draft_no is not null;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-draft-vouchers-migration.sql

-- BEGIN SYNCED DB FILE: supabase-draft-voucher-integrity-migration.sql
-- Let Draft vouchers save incomplete headers without ledger/invoice/stock rows.
-- Apply after supabase-critical-security-hardening-migration.sql and
-- supabase-draft-vouchers-migration.sql. Safe to rerun.
begin;

do $$
declare
  function_sql text;
  new_block text;
  patched_sql text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into function_sql;

  new_block := $block$
  if length(coalesce(voucher_record.narration, '')) > 4000
    or length(coalesce(voucher_record.return_reason, '')) > 2000
    or length(coalesce(voucher_record.invoice_no, '')) > 100 then
    raise exception 'Voucher text exceeds the allowed length';
  end if;

  if coalesce(voucher_record.status, 'Completed') = 'Draft' then
    return null;
  end if;

  if voucher_record.type <> 'Stock Adjustment' then
    if line_count < 2 then raise exception 'Posted vouchers require at least two ledger lines'; end if;
$block$;

  if function_sql is null then
    raise exception 'validate_voucher_financial_integrity() is missing';
  end if;

  if position('coalesce(voucher_record.status, ''Completed'') = ''Draft''' in function_sql) = 0 then
    patched_sql := regexp_replace(
      function_sql,
      E'\\n\\s*if voucher_record\\.type <> ''Stock Adjustment'' then\\s*\\n\\s*if line_count < 2 then raise exception ''Posted vouchers require at least two ledger lines''; end if;',
      E'\n' || new_block,
      'm'
    );
    if patched_sql = function_sql then
      raise exception 'Could not patch validate_voucher_financial_integrity(); expected block not found';
    end if;
    execute patched_sql;
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-draft-voucher-integrity-migration.sql

-- BEGIN SYNCED DB FILE: supabase-alternative-unit-base-qty-integrity-fix.sql
-- Fix alternate-unit invoice integrity checks.
--
-- Khata ERP stores item stock in the main/base unit. Invoice entry quantities
-- can be in an alternate unit, so base_qty must be qty / conversion_factor.
-- Example: 1 cs = 6 pcs, selling 10 pcs stores base_qty = 10 / 6 cs.

begin;

alter table public.invoice_items add column if not exists entry_unit text;
alter table public.invoice_items add column if not exists conversion_factor numeric(18,6) not null default 1;
alter table public.invoice_items add column if not exists base_qty numeric(18,6);

update public.invoice_items
set base_qty = round(qty / nullif(coalesce(conversion_factor, 1), 0), 4),
    entry_unit = coalesce(entry_unit, unit)
where coalesce(conversion_factor, 1) > 0
  and (
    base_qty is null
    or abs(base_qty - qty / nullif(coalesce(conversion_factor, 1), 0)) > 0.0001
    or entry_unit is null
  );

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
    'abs(item.base_qty - item.qty * coalesce(item.conversion_factor, 1)) > 0.0001',
    'abs(item.base_qty - item.qty / nullif(coalesce(item.conversion_factor, 1), 0)) > 0.0001'
  );

  updated_definition := replace(
    updated_definition,
    'invoice_item.qty * coalesce(invoice_item.conversion_factor, 1)',
    'invoice_item.qty / nullif(coalesce(invoice_item.conversion_factor, 1), 0)'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
    'item.qty / nullif(coalesce(item.conversion_factor, 1), 0)'
    in current_definition
  ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-alternative-unit-base-qty-integrity-fix.sql

-- BEGIN SYNCED DB FILE: supabase-service-items-migration.sql
-- Service Item Support
-- Service items are invoiceable but must never create inventory movement.

begin;

alter table public.items
  add column if not exists is_service boolean not null default false;

update public.items
set is_service = false
where is_service is null;

create or replace function public.prevent_service_item_stock_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.items item
    where item.id = new.item_id
      and coalesce(item.is_service, false)
  ) then
    raise exception 'Service items cannot create stock movements';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_lines_reject_service_items on public.stock_lines;
create trigger stock_lines_reject_service_items
before insert or update of item_id on public.stock_lines
for each row
execute function public.prevent_service_item_stock_line();

do $service_items$
declare
  fn text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into fn;

  if fn is null then
    raise exception 'validate_voucher_financial_integrity() is missing';
  end if;

  if fn not like '%Service items cannot create stock movements%' then
    fn := replace(fn,
      $$  if exists (
    select 1 from public.stock_lines stock_line
    where stock_line.voucher_id = target_voucher_id
      and (stock_line.qty <= 0 or stock_line.rate < 0)
  ) then raise exception 'Stock movements require positive quantities and non-negative rates'; end if;$$,
      $$  if exists (
    select 1 from public.stock_lines stock_line
    where stock_line.voucher_id = target_voucher_id
      and (stock_line.qty <= 0 or stock_line.rate < 0)
  ) then raise exception 'Stock movements require positive quantities and non-negative rates'; end if;

  if exists (
    select 1
    from public.stock_lines stock_line
    join public.items item
      on item.id = stock_line.item_id
    where stock_line.voucher_id = target_voucher_id
      and coalesce(item.is_service, false)
  ) then raise exception 'Service items cannot create stock movements'; end if;$$);
  end if;

  if fn not like '%tracked_item.id = invoice_item.item_id%' then
    fn := replace(fn,
      $$          from public.invoice_items invoice_item
          where invoice_item.voucher_id = target_voucher_id
          group by invoice_item.item_id$$,
      $$          from public.invoice_items invoice_item
          join public.items tracked_item
            on tracked_item.id = invoice_item.item_id
           and tracked_item.company_id = voucher_record.company_id
           and not coalesce(tracked_item.is_service, false)
          where invoice_item.voucher_id = target_voucher_id
          group by invoice_item.item_id$$);
  end if;

  execute fn;
end $service_items$;

revoke all on function public.prevent_service_item_stock_line() from public, anon, authenticated;

commit;
-- END SYNCED DB FILE: supabase-service-items-migration.sql

-- BEGIN SYNCED DB FILE: supabase-multi-company-migration.sql
-- Single-login multi-company tenancy, licensing, active-company selection, and membership RLS.
-- Apply after the complete current schema/migrations. Safe to rerun.

begin;

drop index if exists public.companies_user_id_unique;

create table if not exists public.company_members (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'Admin',
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, user_id),
  check (role in ('Admin')),
  check (status in ('active','inactive'))
);

create table if not exists public.user_company_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_companies integer not null default 1 check (max_companies >= 0),
  unlimited_companies boolean not null default false,
  company_creation_enabled boolean not null default true,
  license_status text not null default 'active' check (license_status in ('active','expired','suspended')),
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_user_permissions (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  permission text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, user_id, permission)
);

create index if not exists idx_company_members_user_status on public.company_members(user_id, status);
create index if not exists idx_company_members_company_status on public.company_members(company_id, status);
create index if not exists idx_companies_owner on public.companies(user_id, created_at);

insert into public.company_members(company_id, user_id, role, status, created_by)
select company.id, company.user_id, 'Admin', 'active', company.user_id
from public.companies company
where company.user_id is not null
on conflict (company_id, user_id) do update
set role = 'Admin',
    status = 'active',
    updated_at = now();

insert into public.user_preferences(user_id, active_company_id)
select distinct on (member.user_id) member.user_id, member.company_id
from public.company_members member
join public.companies company on company.id = member.company_id
where member.status = 'active'
order by member.user_id, company.created_at
on conflict (user_id) do nothing;

create or replace function public.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_developer_admin()
    or exists (
      select 1
      from public.company_members member
      where member.company_id = target_company
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  )
$$;

create or replace function public.is_company_admin(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_developer_admin()
    or exists (
      select 1
      from public.company_members member
      where member.company_id = target_company
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role = 'Admin'
    )
  )
$$;

create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select preference.active_company_id
      from public.user_preferences preference
      join public.company_members member
        on member.company_id = preference.active_company_id
       and member.user_id = preference.user_id
       and member.status = 'active'
      where preference.user_id = auth.uid()
      limit 1
    ),
    (
      select member.company_id
      from public.company_members member
      join public.companies company on company.id = member.company_id
      where member.user_id = auth.uid()
        and member.status = 'active'
      order by company.created_at
      limit 1
    )
  )
$$;

create or replace function public.has_company_permission(target_company uuid, requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_admin(target_company)
    or exists (
      select 1
      from public.company_user_permissions permission
      where permission.company_id = target_company
        and permission.user_id = auth.uid()
        and permission.permission = requested_permission
    )
$$;

create or replace function public.company_creation_license(target_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with license as (
    select
      coalesce(limit_row.max_companies, 1) as max_companies,
      coalesce(limit_row.unlimited_companies, false) as unlimited_companies,
      coalesce(limit_row.company_creation_enabled, true) as company_creation_enabled,
      coalesce(limit_row.license_status, 'active') as license_status,
      limit_row.expires_at
    from (select 1) seed
    left join public.user_company_limits limit_row on limit_row.user_id = target_user
  ),
  usage as (
    select count(*)::integer as current_companies
    from public.companies company
    where company.user_id = target_user
  )
  select jsonb_build_object(
    'user_id', target_user,
    'current_companies', usage.current_companies,
    'max_companies', license.max_companies,
    'unlimited_companies', license.unlimited_companies,
    'company_creation_enabled', license.company_creation_enabled,
    'license_status', case
      when license.license_status = 'active' and license.expires_at is not null and license.expires_at < current_date then 'expired'
      else license.license_status
    end,
    'expires_at', license.expires_at,
    'remaining_companies', case when license.unlimited_companies then null else greatest(license.max_companies - usage.current_companies, 0) end,
    'can_create_company', license.company_creation_enabled
      and license.license_status = 'active'
      and (license.expires_at is null or license.expires_at >= current_date)
      and (license.unlimited_companies or usage.current_companies < license.max_companies)
  )
  from license, usage
$$;

create or replace function public.assert_company_creation_allowed(target_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  license jsonb;
begin
  license := public.company_creation_license(target_user);
  if coalesce((license->>'company_creation_enabled')::boolean, false) = false
    or license->>'license_status' <> 'active'
    or coalesce((license->>'can_create_company')::boolean, false) = false then
    raise exception 'You have reached your maximum allowed company limit. Please contact the administrator.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.ensure_default_company_accounts(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.ensure_system_account_groups(uuid)') is not null then
    perform public.ensure_system_account_groups(target_company_id);
  end if;
  if to_regprocedure('public.ensure_retained_earnings_ledger(uuid)') is not null then
    perform public.ensure_retained_earnings_ledger(target_company_id);
  end if;

  insert into public.accounts(id, company_id, name, type, "group", category_id, is_system, is_party, opening_balance)
  select target_company_id::text || ':' || seed.account_key, target_company_id, seed.account_name, seed.account_type, seed.group_name, category.id, seed.is_system, false, 0
  from (values
    ('cash','Cash','Asset','Cash-in-Hand',true),
    ('bank','Bank Account','Asset','Bank Accounts',true),
    ('inventory','Stock-in-Hand','Asset','Current Assets',true),
    ('vat_payable','VAT Payable (Output)','Liability','Duties & Taxes',true),
    ('vat_receivable','VAT Receivable (Input)','Liability','Duties & Taxes',true),
    ('sales','Sales Account','Income','Sales Accounts',true),
    ('purchase','Purchase Account','Expense','Purchase Accounts',true),
    ('sales_return','Sales Return Account','Income','Sales Accounts',true),
    ('purchase_return','Purchase Return Account','Expense','Purchase Accounts',true),
    ('capital','Owner''s Capital','Equity','Capital Account',true),
    ('retained_earnings','Retained Earnings','Equity','Reserves & Surplus',true),
    ('discount_allowed','Discount Allowed','Expense','Indirect Expenses',false),
    ('rent','Rent Expense','Expense','Indirect Expenses',false),
    ('salary','Salary Expense','Expense','Indirect Expenses',false),
    ('electricity','Electricity Expense','Expense','Indirect Expenses',false)
  ) seed(account_key, account_name, account_type, group_name, is_system)
  left join public.account_categories category
    on category.company_id = target_company_id
   and category.name = seed.group_name
   and category.account_type = seed.account_type
  where not exists (
    select 1 from public.accounts existing
    where existing.company_id = target_company_id
      and (
        existing.id = target_company_id::text || ':' || seed.account_key
        or lower(btrim(existing.name)) = lower(btrim(seed.account_name))
      )
  )
  on conflict (id) do nothing;

  insert into public.item_categories(company_id, name, is_archived)
  select target_company_id, 'General', false
  where not exists (
    select 1 from public.item_categories existing
    where existing.company_id = target_company_id
      and lower(btrim(existing.name)) = lower('General')
  )
  on conflict (company_id, name) do nothing;
end;
$$;

create or replace function public.set_active_company(target_company uuid)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_company public.companies%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_member(target_company) then raise exception 'Company access denied' using errcode = '42501'; end if;
  insert into public.user_preferences(user_id, active_company_id, updated_at)
  values (auth.uid(), target_company, now())
  on conflict (user_id) do update
  set active_company_id = excluded.active_company_id,
      updated_at = now();
  select * into selected_company from public.companies where id = target_company;
  return selected_company;
end;
$$;

create or replace function public.create_company_atomic(p_company jsonb)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  user_email text;
  saved public.companies%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform public.assert_company_creation_allowed(caller);
  select email into user_email from auth.users where id = caller;

  insert into public.companies(
    user_id, owner_email, name, address, pan_vat, phone, vat_enabled,
    inventory_valuation_method, sales_prefix, purchase_prefix, receipt_prefix,
    payment_prefix, sales_return_prefix, purchase_return_prefix,
    journal_numbering_mode, reset_numbering_fiscal_year, print_format,
    invoice_terms, payment_qr_text, fiscal_year_start, fiscal_year_configured
  ) values (
    caller,
    user_email,
    coalesce(nullif(btrim(coalesce(p_company->>'name', '')), ''), 'My Company'),
    nullif(btrim(coalesce(p_company->>'address', '')), ''),
    nullif(btrim(coalesce(p_company->>'pan_vat', '')), ''),
    nullif(btrim(coalesce(p_company->>'phone', '')), ''),
    coalesce((p_company->>'vat_enabled')::boolean, true),
    coalesce(nullif(p_company->>'inventory_valuation_method', ''), 'weighted_average'),
    coalesce(nullif(btrim(p_company->>'sales_prefix'), ''), 'INV-'),
    coalesce(nullif(btrim(p_company->>'purchase_prefix'), ''), 'PB-'),
    coalesce(nullif(btrim(p_company->>'receipt_prefix'), ''), 'RCPT-'),
    coalesce(nullif(btrim(p_company->>'payment_prefix'), ''), 'PAY-'),
    coalesce(nullif(btrim(p_company->>'sales_return_prefix'), ''), 'SR-'),
    coalesce(nullif(btrim(p_company->>'purchase_return_prefix'), ''), 'PR-'),
    coalesce(nullif(p_company->>'journal_numbering_mode', ''), 'auto'),
    true,
    coalesce(nullif(p_company->>'print_format', ''), 'A5'),
    nullif(btrim(coalesce(p_company->>'invoice_terms', '')), ''),
    nullif(btrim(coalesce(p_company->>'payment_qr_text', '')), ''),
    coalesce(nullif(p_company->>'fiscal_year_start', '')::date, '2026-07-17'::date),
    coalesce((p_company->>'fiscal_year_configured')::boolean, true)
  ) returning * into saved;

  insert into public.company_members(company_id, user_id, role, status, created_by)
  values (saved.id, caller, 'Admin', 'active', caller)
  on conflict (company_id, user_id) do update
  set role = 'Admin', status = 'active', updated_at = now();

  perform public.ensure_default_company_accounts(saved.id);
  perform public.set_active_company(saved.id);
  return saved;
end;
$$;

create or replace function public.get_my_companies()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with memberships as (
    select
      member.company_id,
      member.role,
      member.status,
      member.created_at as member_since,
      to_jsonb(company.*) as company
    from public.company_members member
    join public.companies company on company.id = member.company_id
    where member.user_id = auth.uid()
      and member.status = 'active'
    order by company.created_at
  ),
  preferred as (
    select coalesce(
      (
        select preference.active_company_id
        from public.user_preferences preference
        join public.company_members member
          on member.company_id = preference.active_company_id
         and member.user_id = preference.user_id
         and member.status = 'active'
        where preference.user_id = auth.uid()
        limit 1
      ),
      (select company_id from memberships limit 1)
    ) as active_company_id
  )
  select jsonb_build_object(
    'active_company_id', preferred.active_company_id,
    'memberships', coalesce((select jsonb_agg(to_jsonb(memberships)) from memberships), '[]'::jsonb),
    'license', public.company_creation_license(auth.uid())
  )
  from preferred
$$;

create or replace function public.add_existing_company_admin(target_company uuid, target_email text)
returns public.company_members
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
  saved public.company_members%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_company_admin(target_company) then raise exception 'Company admin access required' using errcode = '42501'; end if;
  select id into target_user
  from auth.users
  where lower(email) = lower(btrim(target_email))
  limit 1;
  if target_user is null then raise exception 'No existing user found for this email address'; end if;

  insert into public.company_members(company_id, user_id, role, status, created_by)
  values (target_company, target_user, 'Admin', 'active', auth.uid())
  on conflict (company_id, user_id) do update
  set role = 'Admin', status = 'active', updated_at = now()
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.developer_user_company_licenses()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_developer_admin() then coalesce(jsonb_agg(row_data order by lower(coalesce(row_data->>'email', ''))), '[]'::jsonb) else '[]'::jsonb end
  from (
    select jsonb_build_object(
      'user_id', user_record.id,
      'email', user_record.email,
      'license', public.company_creation_license(user_record.id),
      'companies', coalesce((
        select jsonb_agg(jsonb_build_object('id', company.id, 'name', company.name, 'created_at', company.created_at) order by company.created_at)
        from public.companies company
        where company.user_id = user_record.id
      ), '[]'::jsonb)
    ) as row_data
    from auth.users user_record
    where exists (select 1 from public.companies company where company.user_id = user_record.id)
       or exists (select 1 from public.user_company_limits limit_row where limit_row.user_id = user_record.id)
  ) rows;
$$;

create or replace function public.update_user_company_limit(
  target_user uuid,
  p_max_companies integer,
  p_unlimited_companies boolean,
  p_company_creation_enabled boolean,
  p_license_status text,
  p_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode = '42501'; end if;
  insert into public.user_company_limits(user_id, max_companies, unlimited_companies, company_creation_enabled, license_status, expires_at, updated_by, updated_at)
  values (
    target_user,
    greatest(coalesce(p_max_companies, 1), 0),
    coalesce(p_unlimited_companies, false),
    coalesce(p_company_creation_enabled, true),
    coalesce(nullif(p_license_status, ''), 'active'),
    p_expires_at,
    auth.uid(),
    now()
  )
  on conflict (user_id) do update
  set max_companies = excluded.max_companies,
      unlimited_companies = excluded.unlimited_companies,
      company_creation_enabled = excluded.company_creation_enabled,
      license_status = excluded.license_status,
      expires_at = excluded.expires_at,
      updated_by = auth.uid(),
      updated_at = now();
  return public.company_creation_license(target_user);
end;
$$;

create or replace function public.prevent_company_id_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'Company cannot be changed for %.%', tg_table_schema, tg_table_name;
  end if;
  return new;
end;
$$;

create or replace function public.validate_company_reference_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_company uuid;
  source_company uuid;
begin
  if tg_table_name = 'accounts' then
    if new.category_id is not null and not exists(select 1 from public.account_categories c where c.id = new.category_id and c.company_id = new.company_id) then
      raise exception 'Ledger category must belong to the same company';
    end if;
  elsif tg_table_name = 'account_categories' then
    if new.parent_category_id is not null and not exists(select 1 from public.account_categories c where c.id = new.parent_category_id and c.company_id = new.company_id and c.account_type = new.account_type) then
      raise exception 'Parent account group must belong to the same company and type';
    end if;
  elsif tg_table_name = 'parties' then
    if not exists(select 1 from public.accounts a where a.id = new.account_id and a.company_id = new.company_id) then
      raise exception 'Party ledger must belong to the same company';
    end if;
  elsif tg_table_name = 'items' then
    if new.category_id is not null and not exists(select 1 from public.item_categories c where c.id = new.category_id and c.company_id = new.company_id) then
      raise exception 'Item category must belong to the same company';
    end if;
  elsif tg_table_name = 'item_categories' then
    if new.parent_category_id is not null and not exists(select 1 from public.item_categories c where c.id = new.parent_category_id and c.company_id = new.company_id) then
      raise exception 'Parent item category must belong to the same company';
    end if;
  elsif tg_table_name = 'vouchers' then
    if new.party_account_id is not null and not exists(select 1 from public.accounts a where a.id = new.party_account_id and a.company_id = new.company_id) then
      raise exception 'Voucher party ledger must belong to the same company';
    end if;
    if new.settlement_account_id is not null and not exists(select 1 from public.accounts a where a.id = new.settlement_account_id and a.company_id = new.company_id) then
      raise exception 'Voucher settlement ledger must belong to the same company';
    end if;
    if new.original_voucher_id is not null and not exists(select 1 from public.vouchers v where v.id = new.original_voucher_id and v.company_id = new.company_id) then
      raise exception 'Original voucher must belong to the same company';
    end if;
  elsif tg_table_name = 'voucher_settlements' then
    if not exists(select 1 from public.vouchers v where v.id = new.settlement_voucher_id and v.company_id = new.company_id) then
      raise exception 'Settlement voucher must belong to the same company';
    end if;
    if not exists(select 1 from public.vouchers v where v.id = new.invoice_voucher_id and v.company_id = new.company_id) then
      raise exception 'Invoice voucher must belong to the same company';
    end if;
    if not exists(select 1 from public.accounts a where a.id = new.party_account_id and a.company_id = new.company_id) then
      raise exception 'Settlement ledger must belong to the same company';
    end if;
  end if;

  if tg_table_name = 'voucher_lines' then
    select company_id into parent_company from public.vouchers where id = new.voucher_id;
    if parent_company is null then raise exception 'Voucher line parent voucher is missing'; end if;
    if not exists(select 1 from public.accounts a where a.id = new.account_id and a.company_id = parent_company) then
      raise exception 'Voucher line ledger must belong to the voucher company';
    end if;
  elsif tg_table_name = 'stock_lines' then
    select company_id into parent_company from public.vouchers where id = new.voucher_id;
    if parent_company is null then raise exception 'Stock line parent voucher is missing'; end if;
    if not exists(select 1 from public.items i where i.id = new.item_id and i.company_id = parent_company) then
      raise exception 'Stock line item must belong to the voucher company';
    end if;
  elsif tg_table_name = 'invoice_items' then
    select company_id into parent_company from public.vouchers where id = new.voucher_id;
    if parent_company is null then raise exception 'Invoice item parent voucher is missing'; end if;
    if not exists(select 1 from public.items i where i.id = new.item_id and i.company_id = parent_company) then
      raise exception 'Invoice item must belong to the voucher company';
    end if;
    if new.source_invoice_item_id is not null then
      select source_voucher.company_id into source_company
      from public.invoice_items source_item
      join public.vouchers source_voucher on source_voucher.id = source_item.voucher_id
      where source_item.id = new.source_invoice_item_id;
      if source_company is distinct from parent_company then raise exception 'Source invoice item must belong to the same company'; end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_active_company_preference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active_company_id is not null and not exists (
    select 1 from public.company_members member
    where member.company_id = new.active_company_id
      and member.user_id = new.user_id
      and member.status = 'active'
  ) then
    raise exception 'Active company must belong to the user';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_preferences_company_guard on public.user_preferences;
create trigger user_preferences_company_guard
before insert or update on public.user_preferences
for each row execute function public.validate_active_company_preference();

do $triggers$
declare
  table_name text;
begin
  foreach table_name in array array['accounts','account_categories','parties','items','item_categories','vouchers','voucher_settlements'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_company_static_guard', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_company_id_change()', table_name || '_company_static_guard', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_company_reference_guard', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_company_reference_integrity()', table_name || '_company_reference_guard', table_name);
  end loop;

  foreach table_name in array array['voucher_lines','stock_lines','invoice_items'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_company_reference_guard', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_company_reference_integrity()', table_name || '_company_reference_guard', table_name);
  end loop;
end;
$triggers$;

alter table public.company_members enable row level security;
alter table public.user_company_limits enable row level security;
alter table public.user_preferences enable row level security;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companies','accounts','account_categories','parties','items','item_categories',
    'master_change_logs','vouchers','voucher_settlements','app_events',
    'company_modules','company_user_permissions','cheque_banks','cheques','cheque_events'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
    end if;
  end loop;

  drop policy if exists "companies_own" on public.companies;
  drop policy if exists "companies_owner_select" on public.companies;
  drop policy if exists "companies_developer_select" on public.companies;
  drop policy if exists "companies_developer_update" on public.companies;
  drop policy if exists "companies_developer_delete" on public.companies;
  drop policy if exists "companies_member_select" on public.companies;
  drop policy if exists "companies_admin_update" on public.companies;
  drop policy if exists "companies_developer_all" on public.companies;
  create policy "companies_member_select" on public.companies for select using (public.is_company_member(id));
  create policy "companies_admin_update" on public.companies for update using (public.is_company_admin(id)) with check (public.is_company_admin(id));
  create policy "companies_developer_all" on public.companies for all using (public.is_developer_admin()) with check (public.is_developer_admin());

  foreach table_name in array array['accounts','account_categories','parties','items','item_categories','master_change_logs','vouchers','voucher_settlements'] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_developer_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_member_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_write', table_name);
    execute format('create policy %I on public.%I for select using (public.is_company_member(company_id))', table_name || '_member_select', table_name);
    execute format('create policy %I on public.%I for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id))', table_name || '_admin_write', table_name);
  end loop;

  foreach table_name in array array['voucher_lines','stock_lines','invoice_items'] loop
    execute format('drop policy if exists %I on public.%I', case when table_name = 'voucher_lines' then 'vlines_own' when table_name = 'stock_lines' then 'slines_own' else 'iitems_own' end, table_name);
    execute format('drop policy if exists %I on public.%I', case when table_name = 'voucher_lines' then 'vlines_developer_select' when table_name = 'stock_lines' then 'slines_developer_select' else 'iitems_developer_select' end, table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_member_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_write', table_name);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_member(voucher.company_id)))', table_name || '_member_select', table_name);
    execute format('create policy %I on public.%I for all using (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_admin(voucher.company_id))) with check (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_admin(voucher.company_id)))', table_name || '_admin_write', table_name);
  end loop;
end;
$policies$;

drop policy if exists company_members_own_select on public.company_members;
drop policy if exists company_members_admin_write on public.company_members;
drop policy if exists company_members_developer_all on public.company_members;
create policy company_members_own_select on public.company_members
  for select using (user_id = auth.uid() or public.is_company_admin(company_id));
create policy company_members_admin_write on public.company_members
  for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy company_members_developer_all on public.company_members
  for all using (public.is_developer_admin()) with check (public.is_developer_admin());

drop policy if exists user_preferences_own on public.user_preferences;
drop policy if exists user_preferences_developer_select on public.user_preferences;
create policy user_preferences_own on public.user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_preferences_developer_select on public.user_preferences
  for select using (public.is_developer_admin());

drop policy if exists user_company_limits_own_select on public.user_company_limits;
drop policy if exists user_company_limits_developer_all on public.user_company_limits;
create policy user_company_limits_own_select on public.user_company_limits
  for select using (user_id = auth.uid());
create policy user_company_limits_developer_all on public.user_company_limits
  for all using (public.is_developer_admin()) with check (public.is_developer_admin());

drop policy if exists app_events_own_insert on public.app_events;
drop policy if exists app_events_developer_select on public.app_events;
drop policy if exists app_events_member_select on public.app_events;
create policy app_events_own_insert on public.app_events
  for insert with check (public.is_company_member(company_id) and user_id = auth.uid());
create policy app_events_member_select on public.app_events
  for select using (public.is_company_admin(company_id));
create policy app_events_developer_select on public.app_events
  for select using (public.is_developer_admin());

do $optional_policies$
begin
  if to_regclass('public.company_modules') is not null then
    drop policy if exists company_modules_owner_select on public.company_modules;
    drop policy if exists company_modules_developer_all on public.company_modules;
    create policy company_modules_owner_select on public.company_modules for select using (public.is_company_member(company_id));
    create policy company_modules_developer_all on public.company_modules for all using (public.is_developer_admin()) with check (public.is_developer_admin());
  end if;
  if to_regclass('public.company_user_permissions') is not null then
    drop policy if exists company_permissions_own_select on public.company_user_permissions;
    drop policy if exists company_permissions_developer_all on public.company_user_permissions;
    create policy company_permissions_own_select on public.company_user_permissions for select using (public.is_company_member(company_id) and (user_id = auth.uid() or public.is_company_admin(company_id)));
    create policy company_permissions_developer_all on public.company_user_permissions for all using (public.is_developer_admin()) with check (public.is_developer_admin());
  end if;
end;
$optional_policies$;

revoke all on function public.is_company_member(uuid) from public, anon;
revoke all on function public.is_company_admin(uuid) from public, anon;
revoke all on function public.company_creation_license(uuid) from public, anon;
revoke all on function public.assert_company_creation_allowed(uuid) from public, anon;
revoke all on function public.ensure_default_company_accounts(uuid) from public, anon, authenticated;
revoke all on function public.create_company_atomic(jsonb) from public, anon;
revoke all on function public.set_active_company(uuid) from public, anon;
revoke all on function public.get_my_companies() from public, anon;
revoke all on function public.add_existing_company_admin(uuid,text) from public, anon;
revoke all on function public.developer_user_company_licenses() from public, anon;
revoke all on function public.update_user_company_limit(uuid,integer,boolean,boolean,text,date) from public, anon;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.is_company_admin(uuid) to authenticated;
grant execute on function public.company_creation_license(uuid) to authenticated;
grant execute on function public.create_company_atomic(jsonb) to authenticated;
grant execute on function public.set_active_company(uuid) to authenticated;
grant execute on function public.get_my_companies() to authenticated;
grant execute on function public.add_existing_company_admin(uuid,text) to authenticated;
grant execute on function public.developer_user_company_licenses() to authenticated;
grant execute on function public.update_user_company_limit(uuid,integer,boolean,boolean,text,date) to authenticated;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-multi-company-migration.sql

-- BEGIN SYNCED DB FILE: supabase-allow-negative-item-values-migration.sql
-- Allow negative item values for portable company restores and imported data.
-- Some legacy accounting systems export negative opening quantities/rates or
-- reorder levels. KhataERP calculations already support negative stock values;
-- keep tenant/reference validation but remove the non-negative item check.

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
-- END SYNCED DB FILE: supabase-allow-negative-item-values-migration.sql

-- BEGIN SYNCED DB FILE: supabase-allow-zero-invoice-quantities-migration.sql
-- Allow zero-quantity invoice lines for portable restores and legacy imports.
-- Keep negative quantities, negative rates, and invalid conversion factors blocked.
-- Apply after supabase-critical-security-hardening-migration.sql and
-- supabase-zero-value-invoices-migration.sql. Safe to rerun.
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
    'item.qty <= 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0',
    'item.qty < 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require positive quantities and non-negative rates',
    'Invoice items require non-negative quantities and non-negative rates'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
      'item.qty < 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0'
      in current_definition
    ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-allow-zero-invoice-quantities-migration.sql

-- BEGIN SYNCED DB FILE: supabase-allow-negative-invoice-rates-migration.sql
-- Allow negative invoice item rates for portable restores and legacy imports.
-- Keep negative quantities and invalid conversion factors blocked.
-- Apply after supabase-allow-zero-invoice-quantities-migration.sql. Safe to rerun.
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
    'item.qty < 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0',
    'item.qty < 0 or coalesce(item.conversion_factor, 1) <= 0'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require non-negative quantities and non-negative rates',
    'Invoice items require non-negative quantities and valid conversion factors'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
      'item.qty < 0 or coalesce(item.conversion_factor, 1) <= 0'
      in current_definition
    ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-allow-negative-invoice-rates-migration.sql

-- BEGIN SYNCED DB FILE: supabase-allow-negative-invoice-quantities-migration.sql
-- Allow legacy invoice item quantities during portable restores and old-system imports.
-- Keep invalid conversion factors blocked. Frontend forms still validate normal voucher entry.
-- Apply after supabase-allow-negative-invoice-rates-migration.sql. Safe to rerun.
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
    'item.qty < 0 or coalesce(item.conversion_factor, 1) <= 0',
    'coalesce(item.conversion_factor, 1) <= 0'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require non-negative quantities and valid conversion factors',
    'Invoice items require valid conversion factors'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position(
      'coalesce(item.conversion_factor, 1) <= 0'
      in current_definition
    ) = 0 then
    raise exception 'The deployed integrity function has an unsupported definition; reapply the updated critical security hardening migration';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-allow-negative-invoice-quantities-migration.sql

-- BEGIN SYNCED DB FILE: supabase-relax-invoice-base-qty-validation-migration.sql
-- Relax legacy invoice base quantity validation for portable restores.
-- Keep conversion_factor validation, but do not reject old base_qty snapshots.
-- Apply after supabase-allow-negative-invoice-quantities-migration.sql. Safe to rerun.
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
    'coalesce(item.conversion_factor, 1) <= 0
          or (item.base_qty is not null and abs(item.base_qty - item.qty / nullif(coalesce(item.conversion_factor, 1), 0)) > 0.0001)',
    'coalesce(item.conversion_factor, 1) <= 0'
  );

  updated_definition := replace(
    updated_definition,
    'coalesce(item.conversion_factor, 1) <= 0
          or (item.base_qty is not null and abs(item.base_qty - item.qty / nullif(coalesce(item.conversion_factor, 1), 0)) > 0.0001)',
    'coalesce(item.conversion_factor, 1) <= 0'
  );

  if updated_definition is distinct from current_definition then
    execute updated_definition;
  elsif position('item.base_qty is not null and abs(item.base_qty' in current_definition) > 0 then
    raise exception 'Could not patch validate_voucher_financial_integrity(); expected base_qty validation block not found';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-relax-invoice-base-qty-validation-migration.sql

-- BEGIN SYNCED DB FILE: supabase-final-restore-invoice-integrity-fix.sql
-- Final invoice integrity compatibility fix for portable restores.
-- Allows legacy negative/zero invoice quantities and rates, and ignores old base_qty snapshots.
-- Still blocks invalid conversion factors. Safe to rerun.
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

  updated_definition := current_definition;

  updated_definition := regexp_replace(
    updated_definition,
    '\s*or\s*\(\s*item\.base_qty\s+is\s+not\s+null\s+and\s+abs\s*\(\s*item\.base_qty\s*-\s*item\.qty\s*/\s*nullif\s*\(\s*coalesce\s*\(\s*item\.conversion_factor\s*,\s*1\s*\)\s*,\s*0\s*\)\s*\)\s*>\s*0\.0001\s*\)',
    '',
    'gi'
  );

  updated_definition := regexp_replace(
    updated_definition,
    'item\.qty\s*<\s*0\s+or\s+item\.rate\s*<\s*0\s+or\s+coalesce\s*\(\s*item\.conversion_factor\s*,\s*1\s*\)\s*<=\s*0',
    'coalesce(item.conversion_factor, 1) <= 0',
    'gi'
  );

  updated_definition := regexp_replace(
    updated_definition,
    'item\.qty\s*<\s*0\s+or\s+coalesce\s*\(\s*item\.conversion_factor\s*,\s*1\s*\)\s*<=\s*0',
    'coalesce(item.conversion_factor, 1) <= 0',
    'gi'
  );

  updated_definition := regexp_replace(
    updated_definition,
    'item\.rate\s*<\s*0\s+or\s+coalesce\s*\(\s*item\.conversion_factor\s*,\s*1\s*\)\s*<=\s*0',
    'coalesce(item.conversion_factor, 1) <= 0',
    'gi'
  );

  updated_definition := replace(
    updated_definition,
    'Invoice items require non-negative quantities and non-negative rates',
    'Invoice items require valid conversion factors'
  );
  updated_definition := replace(
    updated_definition,
    'Invoice items require non-negative quantities and valid conversion factors',
    'Invoice items require valid conversion factors'
  );

  execute updated_definition;

  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into current_definition;

  if position('item.base_qty is not null and abs(item.base_qty' in current_definition) > 0
    or position('item.qty < 0' in current_definition) > 0
    or position('item.rate < 0' in current_definition) > 0 then
    raise exception 'Invoice restore compatibility patch did not fully apply';
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-final-restore-invoice-integrity-fix.sql

-- BEGIN SYNCED DB FILE: supabase-allow-fiscal-year-start-correction-migration.sql
-- Allow safe correction of company Financial Year Start Date after import.
-- The date may move earlier after transactions exist only when every existing
-- voucher remains on or after the new books start. Moving it later is still blocked.
begin;

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
    if new.fiscal_year_start > old.fiscal_year_start then
      raise exception 'Financial Year Start Date is locked after the first transaction';
    end if;

    if exists (
      select 1 from public.vouchers voucher
      where voucher.company_id = old.id
        and coalesce(voucher.date_ad, voucher.date) < new.fiscal_year_start
      limit 1
    ) then
      raise exception 'Financial Year Start Date cannot be after existing transactions';
    end if;
  end if;

  return new;
end;
$$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-allow-fiscal-year-start-correction-migration.sql

-- BEGIN SYNCED DB FILE: supabase-ledger-unique-name-guard-migration.sql
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
-- END SYNCED DB FILE: supabase-ledger-unique-name-guard-migration.sql

-- BEGIN SYNCED DB FILE: supabase-master-duplicate-name-guards-migration.sql
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
-- END SYNCED DB FILE: supabase-master-duplicate-name-guards-migration.sql

-- BEGIN SYNCED DB FILE: supabase-company-creation-category-seed-fix.sql
-- Apply after supabase-master-duplicate-name-guards-migration.sql.
-- Makes system account-group repair idempotent even when the case-insensitive
-- duplicate-name trigger is installed. PostgreSQL BEFORE INSERT triggers run
-- before ON CONFLICT resolution, so inserts must exclude existing names.
begin;

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
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = root.account_type
      and lower(btrim(existing.name)) = lower(btrim(root.name))
  )
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
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = child.account_type
      and lower(btrim(existing.name)) = lower(btrim(child.name))
  )
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
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = child.account_type
      and lower(btrim(existing.name)) = lower(btrim(child.name))
  )
  on conflict (company_id, name, account_type) do update
  set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;

  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, 'Employees / Staffs', 'Asset', parent.id, true, false
  from public.account_categories parent
  where parent.company_id = target_company_id
    and parent.name = 'Loans & Advances (Asset)'
    and parent.account_type = 'Asset'
    and not exists (
      select 1 from public.account_categories existing
      where existing.company_id = target_company_id
        and existing.account_type = 'Asset'
        and lower(btrim(existing.name)) = lower('Employees / Staffs')
    )
  on conflict (company_id, name, account_type) do update
  set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;
end;
$$;

create or replace function public.ensure_default_company_accounts(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.ensure_system_account_groups(uuid)') is not null then
    perform public.ensure_system_account_groups(target_company_id);
  end if;
  if to_regprocedure('public.ensure_retained_earnings_ledger(uuid)') is not null then
    perform public.ensure_retained_earnings_ledger(target_company_id);
  end if;

  insert into public.accounts(id, company_id, name, type, "group", category_id, is_system, is_party, opening_balance)
  select target_company_id::text || ':' || seed.account_key, target_company_id, seed.account_name, seed.account_type, seed.group_name, category.id, seed.is_system, false, 0
  from (values
    ('cash','Cash','Asset','Cash-in-Hand',true),
    ('bank','Bank Account','Asset','Bank Accounts',true),
    ('inventory','Stock-in-Hand','Asset','Current Assets',true),
    ('vat_payable','VAT Payable (Output)','Liability','Duties & Taxes',true),
    ('vat_receivable','VAT Receivable (Input)','Liability','Duties & Taxes',true),
    ('sales','Sales Account','Income','Sales Accounts',true),
    ('purchase','Purchase Account','Expense','Purchase Accounts',true),
    ('sales_return','Sales Return Account','Income','Sales Accounts',true),
    ('purchase_return','Purchase Return Account','Expense','Purchase Accounts',true),
    ('capital','Owner''s Capital','Equity','Capital Account',true),
    ('retained_earnings','Retained Earnings','Equity','Reserves & Surplus',true),
    ('discount_allowed','Discount Allowed','Expense','Indirect Expenses',false),
    ('rent','Rent Expense','Expense','Indirect Expenses',false),
    ('salary','Salary Expense','Expense','Indirect Expenses',false),
    ('electricity','Electricity Expense','Expense','Indirect Expenses',false)
  ) seed(account_key, account_name, account_type, group_name, is_system)
  left join public.account_categories category
    on category.company_id = target_company_id
   and category.name = seed.group_name
   and category.account_type = seed.account_type
  where not exists (
    select 1 from public.accounts existing
    where existing.company_id = target_company_id
      and (
        existing.id = target_company_id::text || ':' || seed.account_key
        or lower(btrim(existing.name)) = lower(btrim(seed.account_name))
      )
  )
  on conflict (id) do nothing;

  insert into public.item_categories(company_id, name, is_archived)
  select target_company_id, 'General', false
  where not exists (
    select 1 from public.item_categories existing
    where existing.company_id = target_company_id
      and lower(btrim(existing.name)) = lower('General')
  )
  on conflict (company_id, name) do nothing;
end;
$$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-company-creation-category-seed-fix.sql

-- BEGIN SYNCED DB FILE: supabase-voucher-chronology-validation-migration.sql
-- Enforce voucher date chronology only for Sales invoices when enabled in
-- company settings. Draft vouchers do not reserve numbers and are ignored.
begin;

alter table public.companies
  add column if not exists allow_admin_chronological_bypass boolean not null default false;
alter table public.companies
  add column if not exists enforce_sales_invoice_chronology boolean not null default false;

create or replace function public.voucher_number_value(value text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select nullif(substring(coalesce(value, '') from '([0-9]+)$'), '')::bigint;
$$;

create or replace function public.validate_voucher_chronology()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  company_record public.companies%rowtype;
  current_number bigint;
  previous_voucher public.vouchers%rowtype;
  next_voucher public.vouchers%rowtype;
  bypass_allowed boolean := false;
begin
  if coalesce(new.status, 'Completed') = 'Draft' then
    return new;
  end if;

  if new.type <> 'Sales' then
    return new;
  end if;

  select * into company_record from public.companies where id = new.company_id;
  if not found then
    return new;
  end if;

  if not coalesce(company_record.enforce_sales_invoice_chronology, false) then
    return new;
  end if;

  current_number := public.voucher_number_value(new.invoice_no);
  if current_number is null then
    return new;
  end if;

  select voucher.* into previous_voucher
  from public.vouchers voucher
  where voucher.company_id = new.company_id
    and voucher.type = new.type
    and coalesce(voucher.status, 'Completed') <> 'Draft'
    and coalesce(voucher.numbering_period, 'all') = coalesce(new.numbering_period, 'all')
    and voucher.id is distinct from new.id
    and public.voucher_number_value(voucher.invoice_no) < current_number
  order by public.voucher_number_value(voucher.invoice_no) desc, voucher.seq desc
  limit 1;

  select voucher.* into next_voucher
  from public.vouchers voucher
  where voucher.company_id = new.company_id
    and voucher.type = new.type
    and coalesce(voucher.status, 'Completed') <> 'Draft'
    and coalesce(voucher.numbering_period, 'all') = coalesce(new.numbering_period, 'all')
    and voucher.id is distinct from new.id
    and public.voucher_number_value(voucher.invoice_no) > current_number
  order by public.voucher_number_value(voucher.invoice_no) asc, voucher.seq asc
  limit 1;

  if (previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key)
    or (next_voucher.id is not null and new.date_bs_key > next_voucher.date_bs_key) then
    bypass_allowed := company_record.allow_admin_chronological_bypass
      and public.is_company_admin(new.company_id);

    if not bypass_allowed then
      if tg_op = 'INSERT' and previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key then
        raise exception 'The voucher date cannot be earlier than the previous voucher (%). Please select the same or a later date.', previous_voucher.invoice_no;
      elsif previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key then
        raise exception 'The voucher date cannot be earlier than Voucher %.', previous_voucher.invoice_no;
      else
        raise exception 'The voucher date cannot be later than Voucher %.', next_voucher.invoice_no;
      end if;
    end if;

    insert into public.app_events (company_id, user_id, event_type, metadata)
    values (
      new.company_id,
      auth.uid(),
      'voucher_chronology_bypass',
      jsonb_build_object(
        'voucher_type', new.type,
        'voucher_number', new.invoice_no,
        'previous_voucher', previous_voucher.invoice_no,
        'previous_date', previous_voucher.date_bs,
        'next_voucher', next_voucher.invoice_no,
        'next_date', next_voucher.date_bs,
        'new_date', new.date_bs,
        'source', 'database'
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists vouchers_chronology_guard on public.vouchers;
create trigger vouchers_chronology_guard
before insert or update of date_bs, date_bs_key, invoice_no, numbering_period, type, status on public.vouchers
for each row execute function public.validate_voucher_chronology();

revoke all on function public.voucher_number_value(text) from public, anon, authenticated;
revoke all on function public.validate_voucher_chronology() from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-voucher-chronology-validation-migration.sql

-- BEGIN SYNCED DB FILE: supabase-sales-invoice-chronology-setting-migration.sql
-- Add an opt-in Sales-only chronological invoice date setting.
-- When disabled, all voucher types only require dates inside the active fiscal year.
begin;

alter table public.companies
  add column if not exists enforce_sales_invoice_chronology boolean not null default false;

create or replace function public.voucher_number_value(value text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select nullif(substring(coalesce(value, '') from '([0-9]+)$'), '')::bigint;
$$;

create or replace function public.validate_voucher_chronology()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  company_record public.companies%rowtype;
  current_number bigint;
  previous_voucher public.vouchers%rowtype;
  next_voucher public.vouchers%rowtype;
  bypass_allowed boolean := false;
begin
  if coalesce(new.status, 'Completed') = 'Draft' then
    return new;
  end if;

  if new.type <> 'Sales' then
    return new;
  end if;

  select * into company_record from public.companies where id = new.company_id;
  if not found then
    return new;
  end if;

  if not coalesce(company_record.enforce_sales_invoice_chronology, false) then
    return new;
  end if;

  current_number := public.voucher_number_value(new.invoice_no);
  if current_number is null then
    return new;
  end if;

  select voucher.* into previous_voucher
  from public.vouchers voucher
  where voucher.company_id = new.company_id
    and voucher.type = new.type
    and coalesce(voucher.status, 'Completed') <> 'Draft'
    and coalesce(voucher.numbering_period, 'all') = coalesce(new.numbering_period, 'all')
    and voucher.id is distinct from new.id
    and public.voucher_number_value(voucher.invoice_no) < current_number
  order by public.voucher_number_value(voucher.invoice_no) desc, voucher.seq desc
  limit 1;

  select voucher.* into next_voucher
  from public.vouchers voucher
  where voucher.company_id = new.company_id
    and voucher.type = new.type
    and coalesce(voucher.status, 'Completed') <> 'Draft'
    and coalesce(voucher.numbering_period, 'all') = coalesce(new.numbering_period, 'all')
    and voucher.id is distinct from new.id
    and public.voucher_number_value(voucher.invoice_no) > current_number
  order by public.voucher_number_value(voucher.invoice_no) asc, voucher.seq asc
  limit 1;

  if (previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key)
    or (next_voucher.id is not null and new.date_bs_key > next_voucher.date_bs_key) then
    bypass_allowed := coalesce(company_record.allow_admin_chronological_bypass, false)
      and public.is_company_admin(new.company_id);

    if not bypass_allowed then
      if tg_op = 'INSERT' and previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key then
        raise exception 'The voucher date cannot be earlier than the previous voucher (%). Please select the same or a later date.', previous_voucher.invoice_no;
      elsif previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key then
        raise exception 'The voucher date cannot be earlier than Voucher %.', previous_voucher.invoice_no;
      else
        raise exception 'The voucher date cannot be later than Voucher %.', next_voucher.invoice_no;
      end if;
    end if;

    insert into public.app_events (company_id, user_id, event_type, metadata)
    values (
      new.company_id,
      auth.uid(),
      'voucher_chronology_bypass',
      jsonb_build_object(
        'voucher_type', new.type,
        'voucher_number', new.invoice_no,
        'previous_voucher', previous_voucher.invoice_no,
        'previous_date', previous_voucher.date_bs,
        'next_voucher', next_voucher.invoice_no,
        'next_date', next_voucher.date_bs,
        'new_date', new.date_bs,
        'source', 'database'
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists vouchers_chronology_guard on public.vouchers;
create trigger vouchers_chronology_guard
before insert or update of date_bs, date_bs_key, invoice_no, numbering_period, type, status on public.vouchers
for each row execute function public.validate_voucher_chronology();

revoke all on function public.validate_voucher_chronology() from public, anon, authenticated;
revoke all on function public.voucher_number_value(text) from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-sales-invoice-chronology-setting-migration.sql

-- BEGIN SYNCED DB FILE: supabase-simple-income-expense-migration.sql
-- Beginner-friendly Income/Expense entries remain Journal vouchers while this
-- marker preserves their dedicated editor and list identity.
alter table public.vouchers add column if not exists simple_entry_type text;
alter table public.vouchers drop constraint if exists vouchers_simple_entry_type_check;
alter table public.vouchers add constraint vouchers_simple_entry_type_check
  check (simple_entry_type is null or (type = 'Journal' and simple_entry_type in ('Income', 'Expense')));

create or replace function public.sync_simple_entry_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type = 'Journal' and new.draft_payload ? 'simpleEntryType' then
    new.simple_entry_type := nullif(new.draft_payload->>'simpleEntryType', '');
  end if;
  return new;
end;
$$;

drop trigger if exists vouchers_sync_simple_entry_type on public.vouchers;
create trigger vouchers_sync_simple_entry_type
before insert or update of draft_payload, simple_entry_type on public.vouchers
for each row execute function public.sync_simple_entry_type();

create or replace function public.validate_simple_entry_voucher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  voucher_row public.vouchers%rowtype;
  expected_type text;
  counter_debit numeric;
  counter_credit numeric;
  detail_total numeric;
  detail_count integer;
begin
  if tg_table_name = 'voucher_lines' then
    target_id := case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  else
    target_id := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  select * into voucher_row from public.vouchers where id = target_id;
  if not found or voucher_row.simple_entry_type is null or voucher_row.status <> 'Completed' then return null; end if;
  expected_type := voucher_row.simple_entry_type;

  if voucher_row.type <> 'Journal' or voucher_row.settlement_account_id is null then
    raise exception 'Simple entry requires a Journal voucher and counter ledger';
  end if;
  if not exists (select 1 from public.accounts where id = voucher_row.settlement_account_id and company_id = voucher_row.company_id and not is_archived) then
    raise exception 'Simple entry counter ledger is unavailable';
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into counter_debit, counter_credit
  from public.voucher_lines where voucher_id = target_id and account_id = voucher_row.settlement_account_id;

  select count(*), coalesce(sum(case when expected_type = 'Income' then line.credit else line.debit end), 0)
    into detail_count, detail_total
  from public.voucher_lines line
  join public.accounts account on account.id = line.account_id and account.company_id = voucher_row.company_id
  join public.account_categories category on category.id = account.category_id and category.company_id = voucher_row.company_id
  where line.voucher_id = target_id and line.account_id <> voucher_row.settlement_account_id
    and account.type = expected_type and category.account_type = expected_type and not account.is_archived and not category.is_archived
    and case when expected_type = 'Income' then line.credit > 0 and line.debit = 0 else line.debit > 0 and line.credit = 0 end;

  if detail_count < 1 or detail_total <= 0
     or detail_count <> (select count(*) from public.voucher_lines where voucher_id = target_id and account_id <> voucher_row.settlement_account_id)
     or (expected_type = 'Income' and (counter_debit <> detail_total or counter_credit <> 0))
     or (expected_type = 'Expense' and (counter_credit <> detail_total or counter_debit <> 0))
     or round(detail_total, 6) <> round(voucher_row.total, 6) then
    raise exception 'Simple entry ledger lines are invalid or unbalanced';
  end if;
  return null;
end;
$$;

drop trigger if exists vouchers_validate_simple_entry on public.vouchers;
create constraint trigger vouchers_validate_simple_entry
after insert or update of status, simple_entry_type, settlement_account_id, total on public.vouchers
deferrable initially deferred for each row execute function public.validate_simple_entry_voucher();

drop trigger if exists voucher_lines_validate_simple_entry on public.voucher_lines;
create constraint trigger voucher_lines_validate_simple_entry
after insert or update or delete on public.voucher_lines
deferrable initially deferred for each row execute function public.validate_simple_entry_voucher();

revoke all on function public.sync_simple_entry_type() from public;
revoke all on function public.validate_simple_entry_voucher() from public;
-- END SYNCED DB FILE: supabase-simple-income-expense-migration.sql

-- BEGIN SYNCED DB FILE: supabase-contra-voucher-migration.sql
-- Journal-backed Contra vouchers and their protected Bank Charges ledger.
alter table public.vouchers add column if not exists contra_entry boolean not null default false;
alter table public.vouchers add column if not exists contra_destination_account_id text references public.accounts(id);
alter table public.vouchers add column if not exists contra_charge_amount numeric(18,6) not null default 0;
alter table public.vouchers drop constraint if exists vouchers_contra_metadata_check;
alter table public.vouchers add constraint vouchers_contra_metadata_check check (
  contra_charge_amount >= 0 and (not contra_entry or (type = 'Journal' and (status = 'Draft' or (settlement_account_id is not null and contra_destination_account_id is not null))))
);

insert into public.account_categories(company_id, name, account_type, is_system)
select id, 'Indirect Expenses', 'Expense', true from public.companies
where not exists (
  select 1 from public.account_categories category
  where category.company_id = companies.id
    and lower(btrim(category.name)) = lower('Indirect Expenses')
    and category.account_type = 'Expense'
);

update public.account_categories
set is_system = true
where lower(btrim(name)) = lower('Indirect Expenses')
  and account_type = 'Expense';

insert into public.accounts(id, company_id, name, type, "group", category_id, is_system, is_party, opening_balance)
select company.id::text || ':bank_charges', company.id, 'Bank Charges', 'Expense', 'Indirect Expenses', category.id, true, false, 0
from public.companies company
join public.account_categories category on category.company_id = company.id and category.name = 'Indirect Expenses' and category.account_type = 'Expense'
where not exists (
  select 1 from public.accounts existing
  where existing.company_id = company.id
    and lower(btrim(existing.name)) = lower('Bank Charges')
    and existing.type = 'Expense'
)
on conflict (id) do update set name = 'Bank Charges', type = 'Expense', "group" = 'Indirect Expenses', category_id = excluded.category_id, is_system = true, is_archived = false;

update public.accounts account
set is_system = true, is_archived = false, "group" = 'Indirect Expenses', category_id = category.id
from public.account_categories category
where account.company_id = category.company_id
  and lower(btrim(account.name)) = lower('Bank Charges')
  and account.type = 'Expense'
  and category.name = 'Indirect Expenses'
  and category.account_type = 'Expense';

create or replace function public.sync_contra_metadata()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.type = 'Journal' and new.draft_payload->>'journalEntryType' = 'Contra' then
    new.contra_entry := true;
    new.settlement_account_id := coalesce(nullif(new.draft_payload->>'sourceAccountId', ''), new.settlement_account_id);
    new.contra_destination_account_id := coalesce(nullif(new.draft_payload->>'destinationAccountId', ''), new.contra_destination_account_id);
    new.contra_charge_amount := coalesce(nullif(new.draft_payload->>'chargeAmount', '')::numeric, new.contra_charge_amount, 0);
  end if;
  return new;
end;
$$;
drop trigger if exists vouchers_sync_contra_metadata on public.vouchers;
create trigger vouchers_sync_contra_metadata before insert or update of draft_payload, contra_entry, contra_destination_account_id, contra_charge_amount on public.vouchers for each row execute function public.sync_contra_metadata();

create or replace function public.validate_contra_voucher()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_id uuid;
  v public.vouchers%rowtype;
  destination_debit numeric;
  source_credit numeric;
  charge_debit numeric;
  line_count integer;
  expected_line_count integer;
begin
  if tg_table_name = 'voucher_lines' then
    if tg_op = 'DELETE' then
      target_id := old.voucher_id;
    else
      target_id := new.voucher_id;
    end if;
  else
    if tg_op = 'DELETE' then
      target_id := old.id;
    else
      target_id := new.id;
    end if;
  end if;
  select * into v from public.vouchers where id = target_id;
  if not found or not v.contra_entry or v.status <> 'Completed' then return null; end if;
  if v.type <> 'Journal' or v.settlement_account_id = v.contra_destination_account_id then raise exception 'Contra requires different source and destination ledgers'; end if;
  if exists (
    select 1 from (values (v.settlement_account_id), (v.contra_destination_account_id)) endpoint(id)
    left join public.accounts account on account.id = endpoint.id and account.company_id = v.company_id and not account.is_archived
    left join public.account_categories category on category.id = account.category_id and category.company_id = v.company_id and not category.is_archived
    where account.id is null or not (category.name in ('Cash-in-Hand','Bank Accounts','Bank','Bank OD A/c') and category.account_type in ('Asset','Liability'))
  ) then raise exception 'Contra source and destination must be active Cash or Bank ledgers'; end if;

  select coalesce(sum(case when account_id = v.contra_destination_account_id then debit else 0 end),0),
         coalesce(sum(case when account_id = v.settlement_account_id then credit else 0 end),0), count(*)
    into destination_debit, source_credit, line_count from public.voucher_lines where voucher_id = target_id;
  select coalesce(sum(line.debit),0) into charge_debit from public.voucher_lines line join public.accounts account on account.id = line.account_id
    where line.voucher_id = target_id and account.company_id = v.company_id and lower(btrim(account.name)) = lower('Bank Charges') and account.is_system and account.type = 'Expense';
  expected_line_count := case when v.contra_charge_amount > 0 then 3 else 2 end;
  if destination_debit <= 0 or round(charge_debit,6) <> round(v.contra_charge_amount,6) or round(source_credit,6) <> round(destination_debit + charge_debit,6)
     or line_count <> expected_line_count
     or exists (select 1 from public.voucher_lines where voucher_id = target_id and debit > 0 and credit > 0)
  then raise exception 'Contra voucher lines are invalid or unbalanced'; end if;
  return null;
end;
$$;
drop trigger if exists vouchers_validate_contra on public.vouchers;
create constraint trigger vouchers_validate_contra after insert or update of status, contra_entry, settlement_account_id, contra_destination_account_id, contra_charge_amount on public.vouchers deferrable initially deferred for each row execute function public.validate_contra_voucher();
drop trigger if exists voucher_lines_validate_contra on public.voucher_lines;
create constraint trigger voucher_lines_validate_contra after insert or update or delete on public.voucher_lines deferrable initially deferred for each row execute function public.validate_contra_voucher();
revoke all on function public.sync_contra_metadata() from public;
revoke all on function public.validate_contra_voucher() from public;
-- END SYNCED DB FILE: supabase-contra-voucher-migration.sql

-- BEGIN SYNCED DB FILE: supabase-incoming-outgoing-cheques-migration.sql
-- Direction-aware received and issued cheque management.
begin;

alter table public.cheques add column if not exists direction text not null default 'received';
alter table public.cheques add column if not exists source_account_id text references public.accounts(id);
alter table public.cheques add column if not exists cleared_date_bs text;
alter table public.cheques add column if not exists cleared_date_bs_key integer;
alter table public.cheques alter column bank_id drop not null;
update public.cheques set direction='received' where direction is null;

-- Received cheques retain the external bank account validation. Issued cheques
-- identify the source by its company ledger, so an account number is optional.
alter table public.cheques drop constraint if exists cheques_identity_account_check;
alter table public.cheques add constraint cheques_identity_account_check check (
  (direction='issued' and btrim(account_number)='')
  or (char_length(btrim(account_number)) between 1 and 34 and btrim(account_number) ~ '^[[:alnum:] -]+$')
) not valid;

alter table public.cheques drop constraint if exists cheques_direction_check;
alter table public.cheques add constraint cheques_direction_check check(direction in ('received','issued'));
alter table public.cheques drop constraint if exists cheques_direction_metadata_check;
alter table public.cheques add constraint cheques_direction_metadata_check check(
  (direction='received' and bank_id is not null and source_account_id is null)
  or (direction='issued' and source_account_id is not null)
);
create unique index if not exists cheques_linked_voucher_unique on public.cheques(linked_voucher_id) where linked_voucher_id is not null;
create unique index if not exists issued_cheque_number_unique on public.cheques(company_id,source_account_id,lower(cheque_number)) where direction='issued';

create or replace function public.validate_directional_cheque()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.accounts account where account.id=new.party_ledger_id and account.company_id=new.company_id and account.is_party and not coalesce(account.is_archived,false)) then
    raise exception 'Cheque party must be an active party ledger in the same company';
  end if;
  if new.direction='issued' and not exists(
    select 1 from public.accounts account join public.account_categories category on category.id=account.category_id
    where account.id=new.source_account_id and account.company_id=new.company_id and not coalesce(account.is_archived,false)
      and ((category.name in ('Bank Accounts','Bank') and category.account_type='Asset') or (category.name='Bank OD A/c' and category.account_type='Liability'))
  ) then raise exception 'Issued cheque source must be an active company Bank or Bank OD ledger'; end if;
  if new.status<>'cleared' and (new.linked_voucher_id is not null or new.cleared_to_account_id is not null or new.cleared_date_bs is not null or new.cleared_date_bs_key is not null) then
    raise exception 'Only cleared cheques may contain settlement metadata';
  end if;
  if new.status='cleared' and (new.linked_voucher_id is null or new.cleared_date_bs is null or new.cleared_date_bs_key is null) then
    raise exception 'Cleared cheque requires a linked voucher and clearing date';
  end if;
  return new;
end $$;
drop trigger if exists cheque_direction_guard on public.cheques;
create trigger cheque_direction_guard before insert or update on public.cheques for each row execute function public.validate_directional_cheque();

-- Superseded by validate_cheque_voucher_link below. The legacy trigger only
-- accepted Receipt vouchers and therefore rejected every issued-cheque Payment.
drop trigger if exists cleared_cheque_receipt_guard on public.cheques;

-- Keep the original external-bank validator for received cheques only.
drop trigger if exists cheque_touch_guard on public.cheques;
create trigger cheque_touch_guard before insert or update on public.cheques for each row when (new.direction='received') execute function public.cheque_touch_and_audit();
create or replace function public.issued_cheque_touch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at=now(); new.updated_by=auth.uid();
  if tg_op='UPDATE' and old.status<>'pending' and row(new.cheque_number,new.source_account_id,new.party_ledger_id,new.amount,new.issue_date,new.due_date,new.notes) is distinct from row(old.cheque_number,old.source_account_id,old.party_ledger_id,old.amount,old.issue_date,old.due_date,old.notes) then raise exception 'Completed cheques cannot be edited'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status then
    if old.status<>'pending' then raise exception 'Only pending cheques may change status'; end if;
    if new.status='cleared' and not public.has_company_permission(new.company_id,'cheque.mark_cleared') then raise exception 'Missing cheque.mark_cleared permission'; end if;
    if new.status='bounced' and not public.has_company_permission(new.company_id,'cheque.mark_bounced') then raise exception 'Missing cheque.mark_bounced permission'; end if;
    if new.status='cancelled' and not public.has_company_permission(new.company_id,'cheque.cancel') then raise exception 'Missing cheque.cancel permission'; end if;
    if new.status='cleared' then new.cleared_at=now(); elsif new.status='bounced' then new.bounced_at=now(); elsif new.status='cancelled' then new.cancelled_at=now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists issued_cheque_touch_guard on public.cheques;
create trigger issued_cheque_touch_guard before insert or update on public.cheques for each row when (new.direction='issued') execute function public.issued_cheque_touch();

create or replace function public.validate_cleared_cheque_voucher()
returns trigger language plpgsql security definer set search_path=public as $$
declare target public.cheques%rowtype; linked public.vouchers%rowtype; party_debit numeric; party_credit numeric; bank_debit numeric; bank_credit numeric;
begin
  if tg_table_name='cheques' then target:=new; else select * into target from public.cheques where linked_voucher_id=new.id; end if;
  if target.id is null or target.status<>'cleared' then return null; end if;
  select * into linked from public.vouchers where id=target.linked_voucher_id;
  if not found or linked.company_id<>target.company_id or linked.cancelled or linked.status<>'Completed' then raise exception 'Cleared cheque voucher is missing or inactive'; end if;
  select coalesce(sum(debit),0),coalesce(sum(credit),0) into party_debit,party_credit from public.voucher_lines where voucher_id=linked.id and account_id=target.party_ledger_id;
  if target.direction='issued' then
    select coalesce(sum(debit),0),coalesce(sum(credit),0) into bank_debit,bank_credit from public.voucher_lines where voucher_id=linked.id and account_id=target.source_account_id;
    if linked.type<>'Payment' or party_debit<>target.amount or party_credit<>0 or bank_credit<>target.amount or bank_debit<>0 then raise exception 'Issued cheque must link to a matching Payment voucher'; end if;
  else
    select coalesce(sum(debit),0),coalesce(sum(credit),0) into bank_debit,bank_credit from public.voucher_lines where voucher_id=linked.id and account_id=target.cleared_to_account_id;
    if linked.type<>'Receipt' or target.cleared_to_account_id is null or party_credit<>target.amount or party_debit<>0 or bank_debit<>target.amount or bank_credit<>0 then raise exception 'Received cheque must link to a matching Receipt voucher'; end if;
  end if;
  return null;
end $$;
drop trigger if exists validate_cheque_voucher_link on public.cheques;
create constraint trigger validate_cheque_voucher_link after insert or update of status,linked_voucher_id,cleared_date_bs on public.cheques deferrable initially deferred for each row execute function public.validate_cleared_cheque_voucher();

create or replace function public.clear_cheque_atomic(
  p_cheque_id uuid,p_date_ad date,p_date_bs text,p_date_bs_key integer,p_numbering_period text,p_invoice_prefix text,
  p_reset_numbering boolean,p_period_start_key integer,p_next_period_start_key integer,p_settlement_account_id text default null,p_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.cheques%rowtype; voucher_result jsonb; settlement_id text; voucher_type text; voucher_lines jsonb; voucher_header jsonb; cash_ledger text;
begin
  select * into target from public.cheques where id=p_cheque_id for update;
  if not found or target.company_id<>public.my_company_id() then raise exception 'Cheque not found'; end if;
  if target.status<>'pending' then
    if target.status='cleared' and target.linked_voucher_id is not null then return jsonb_build_object('cheque',to_jsonb(target),'voucher',public.voucher_atomic_response(target.linked_voucher_id)); end if;
    raise exception 'Only pending cheques can be cleared';
  end if;
  if not public.company_module_access(target.company_id,'cheque_management',true) or not public.has_company_permission(target.company_id,'cheque.mark_cleared') then raise exception 'Missing cheque clearing permission'; end if;
  if p_date_bs is null or p_date_bs_key is null then raise exception 'Clearing date is required'; end if;
  if target.direction='issued' then settlement_id:=target.source_account_id;voucher_type:='Payment';
    voucher_lines:=jsonb_build_array(jsonb_build_object('account_id',target.party_ledger_id,'debit',target.amount,'credit',0),jsonb_build_object('account_id',settlement_id,'debit',0,'credit',target.amount));
  else settlement_id:=p_settlement_account_id;voucher_type:='Receipt';
    if settlement_id is null then raise exception 'Select the Cash or Bank ledger receiving this cheque'; end if;
    voucher_lines:=jsonb_build_array(jsonb_build_object('account_id',settlement_id,'debit',target.amount,'credit',0),jsonb_build_object('account_id',target.party_ledger_id,'debit',0,'credit',target.amount));
  end if;
  if not exists(select 1 from public.accounts where id=settlement_id and company_id=target.company_id and not coalesce(is_archived,false)) then raise exception 'Cheque settlement ledger is unavailable'; end if;
  cash_ledger:=target.company_id::text||':cash';
  -- Voucher idempotency keys are UUIDs. The cheque UUID is stable and unique,
  -- making repeated or concurrent clearing requests return the same voucher.
  voucher_header:=jsonb_build_object('company_id',target.company_id,'type',voucher_type,'date',p_date_ad,'date_ad',p_date_ad,'date_bs',p_date_bs,'date_bs_key',p_date_bs_key,'numbering_period',p_numbering_period,'narration',(case when target.direction='issued' then 'Issued' else 'Received' end)||' cheque '||target.cheque_number||' cleared','party_account_id',target.party_ledger_id,'settlement_account_id',settlement_id,'is_cash',settlement_id in (cash_ledger,'cash'),'total',target.amount,'cancelled',false,'status','Completed','idempotency_key',target.id);
  voucher_result:=public.save_voucher_atomic(voucher_header,voucher_lines,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,null,p_invoice_prefix,p_reset_numbering,p_period_start_key,p_next_period_start_key,'cheque_cleared',jsonb_build_object('cheque_id',target.id,'direction',target.direction));
  update public.cheques set status='cleared',linked_voucher_id=(voucher_result->>'id')::uuid,cleared_date_bs=p_date_bs,cleared_date_bs_key=p_date_bs_key,cleared_to_account_id=case when target.direction='received' then settlement_id else null end,status_reason=nullif(btrim(coalesce(p_reason,'')),'') where id=target.id returning * into target;
  insert into public.cheque_events(company_id,cheque_id,action,new_values,actor_id) values(target.company_id,target.id,'cheque_cleared',jsonb_build_object('direction',target.direction,'linked_voucher_id',target.linked_voucher_id,'cleared_date_bs',p_date_bs),auth.uid());
  return jsonb_build_object('cheque',to_jsonb(target),'voucher',voucher_result);
end $$;

revoke all on function public.validate_directional_cheque() from public,anon,authenticated;
revoke all on function public.validate_cleared_cheque_voucher() from public,anon,authenticated;
revoke all on function public.issued_cheque_touch() from public,anon,authenticated;
revoke all on function public.clear_cheque_atomic(uuid,date,text,integer,text,text,boolean,integer,integer,text,text) from public,anon;
grant execute on function public.clear_cheque_atomic(uuid,date,text,integer,text,text,boolean,integer,integer,text,text) to authenticated;
commit;
notify pgrst,'reload schema';
-- END SYNCED DB FILE: supabase-incoming-outgoing-cheques-migration.sql

-- BEGIN SYNCED DB FILE: supabase-invoice-rate-precision-migration.sql
-- Preserve rates calculated from an explicitly entered invoice-line amount.
-- Six decimal places allow amount / quantity calculations to round back to
-- the user's two-decimal line amount during server integrity validation.
begin;

alter table public.invoice_items
  alter column rate type numeric(18,6) using rate::numeric(18,6);

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-invoice-rate-precision-migration.sql

-- BEGIN SYNCED DB FILE: supabase-identity-validation-migration.sql
-- Shared backend enforcement for company, party, ledger, bank, and cheque identity fields.
-- Invalid optional legacy phone/PAN values are intentionally cleared before constraints are installed.

update public.companies set phone = null where phone is not null and btrim(phone) !~ '^[0-9]{10}$';
update public.companies set pan_vat = null where pan_vat is not null and btrim(pan_vat) !~ '^[0-9]{9}$';
update public.accounts set contact_no = null where contact_no is not null and btrim(contact_no) !~ '^[0-9]{10}$';
update public.accounts set pan_no = null where pan_no is not null and btrim(pan_no) !~ '^[0-9]{9}$';
update public.parties set phone = null where phone is not null and btrim(phone) !~ '^[0-9]{10}$';
update public.parties set pan_vat = null where pan_vat is not null and btrim(pan_vat) !~ '^[0-9]{9}$';
update public.companies set phone = btrim(phone), pan_vat = btrim(pan_vat);
update public.accounts set contact_no = btrim(contact_no), pan_no = btrim(pan_no);
update public.parties set phone = btrim(phone), pan_vat = btrim(pan_vat);

alter table public.companies drop constraint if exists companies_identity_phone_check;
alter table public.companies add constraint companies_identity_phone_check check (phone is null or phone ~ '^[0-9]{10}$');
alter table public.companies drop constraint if exists companies_identity_pan_check;
alter table public.companies add constraint companies_identity_pan_check check (pan_vat is null or pan_vat ~ '^[0-9]{9}$');
alter table public.companies drop constraint if exists companies_identity_name_check;
alter table public.companies add constraint companies_identity_name_check check (char_length(btrim(name)) between 1 and 150 and name !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') not valid;
alter table public.companies drop constraint if exists companies_identity_address_check;
alter table public.companies add constraint companies_identity_address_check check (address is null or (char_length(btrim(address)) <= 500 and address !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')) not valid;

alter table public.accounts drop constraint if exists accounts_identity_phone_check;
alter table public.accounts add constraint accounts_identity_phone_check check (contact_no is null or contact_no ~ '^[0-9]{10}$');
alter table public.accounts drop constraint if exists accounts_identity_pan_check;
alter table public.accounts add constraint accounts_identity_pan_check check (pan_no is null or pan_no ~ '^[0-9]{9}$');
alter table public.accounts drop constraint if exists accounts_identity_name_check;
alter table public.accounts add constraint accounts_identity_name_check check (char_length(btrim(name)) between 1 and 150 and name !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') not valid;
alter table public.accounts drop constraint if exists accounts_identity_address_check;
alter table public.accounts add constraint accounts_identity_address_check check (address is null or (char_length(btrim(address)) <= 500 and address !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')) not valid;
alter table public.accounts drop constraint if exists accounts_identity_bank_account_check;
alter table public.accounts add constraint accounts_identity_bank_account_check check (bank_account_no is null or (char_length(btrim(bank_account_no)) between 1 and 34 and btrim(bank_account_no) ~ '^[[:alnum:] -]+$')) not valid;
alter table public.accounts drop constraint if exists accounts_identity_branch_check;
alter table public.accounts add constraint accounts_identity_branch_check check (bank_branch is null or (char_length(btrim(bank_branch)) <= 100 and bank_branch !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')) not valid;

alter table public.parties drop constraint if exists parties_identity_phone_check;
alter table public.parties add constraint parties_identity_phone_check check (phone is null or phone ~ '^[0-9]{10}$');
alter table public.parties drop constraint if exists parties_identity_pan_check;
alter table public.parties add constraint parties_identity_pan_check check (pan_vat is null or pan_vat ~ '^[0-9]{9}$');
alter table public.parties drop constraint if exists parties_identity_name_check;
alter table public.parties add constraint parties_identity_name_check check (char_length(btrim(name)) between 1 and 150 and name !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') not valid;
alter table public.parties drop constraint if exists parties_identity_address_check;
alter table public.parties add constraint parties_identity_address_check check (address is null or (char_length(btrim(address)) <= 500 and address !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')) not valid;

do $identity_optional_tables$
begin
  if to_regclass('public.cheque_banks') is not null then
    alter table public.cheque_banks disable trigger cheque_bank_guard;
    update public.cheque_banks set contact_number = null where contact_number is not null and btrim(contact_number) !~ '^[0-9]{10}$';
    update public.cheque_banks set contact_number = btrim(contact_number);
    alter table public.cheque_banks enable trigger cheque_bank_guard;
    alter table public.cheque_banks drop constraint if exists cheque_banks_identity_phone_check;
    alter table public.cheque_banks add constraint cheque_banks_identity_phone_check check (contact_number is null or contact_number ~ '^[0-9]{10}$');
    alter table public.cheque_banks drop constraint if exists cheque_banks_identity_name_check;
    alter table public.cheque_banks add constraint cheque_banks_identity_name_check check (char_length(btrim(bank_name)) between 1 and 150) not valid;
    alter table public.cheque_banks drop constraint if exists cheque_banks_identity_branch_check;
    alter table public.cheque_banks add constraint cheque_banks_identity_branch_check check (branch_name is null or char_length(btrim(branch_name)) <= 100) not valid;
    alter table public.cheque_banks drop constraint if exists cheque_banks_identity_account_check;
    alter table public.cheque_banks add constraint cheque_banks_identity_account_check check (account_number is null or btrim(account_number) = '' or (char_length(btrim(account_number)) <= 34 and btrim(account_number) ~ '^[[:alnum:] -]+$')) not valid;
  end if;
  if to_regclass('public.cheques') is not null then
    alter table public.cheques drop constraint if exists cheques_identity_number_check;
    alter table public.cheques add constraint cheques_identity_number_check check (char_length(btrim(cheque_number)) between 1 and 50 and btrim(cheque_number) ~ '^[[:alnum:]/-]+$') not valid;
    alter table public.cheques drop constraint if exists cheques_identity_account_check;
    alter table public.cheques add constraint cheques_identity_account_check check (char_length(btrim(account_number)) between 1 and 34 and btrim(account_number) ~ '^[[:alnum:] -]+$') not valid;
  end if;
end;
$identity_optional_tables$;
-- END SYNCED DB FILE: supabase-identity-validation-migration.sql

-- BEGIN SYNCED DB FILE: supabase-developer-full-backup-migration.sql
begin;

create table if not exists public.developer_backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  initiated_by uuid not null references auth.users(id),
  total_companies integer not null check (total_companies >= 0),
  successful_companies integer not null default 0 check (successful_companies >= 0),
  failed_companies integer not null default 0 check (failed_companies >= 0),
  status text not null default 'running' check (status in ('running','successful','partial','failed'))
);

create table if not exists public.developer_company_backup_status (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_exported_at timestamptz,
  last_attempted_at timestamptz not null default now(),
  last_export_status text not null check (last_export_status in ('successful','failed')),
  last_exported_by uuid references auth.users(id),
  last_error text
);

alter table public.developer_backup_runs enable row level security;
alter table public.developer_company_backup_status enable row level security;

drop policy if exists developer_backup_runs_select on public.developer_backup_runs;
create policy developer_backup_runs_select on public.developer_backup_runs for select using ((select public.is_developer_admin()));
drop policy if exists developer_company_backup_status_select on public.developer_company_backup_status;
create policy developer_company_backup_status_select on public.developer_company_backup_status for select using ((select public.is_developer_admin()));

create or replace function public.developer_user_company_licenses()
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when public.is_developer_admin() then coalesce(jsonb_agg(row_data order by lower(coalesce(row_data->>'display_name', row_data->>'email', ''))), '[]'::jsonb) else '[]'::jsonb end
  from (
    select jsonb_build_object(
      'user_id', user_record.id,
      'email', user_record.email,
      'display_name', coalesce(nullif(btrim(user_record.raw_user_meta_data->>'full_name'), ''), nullif(btrim(user_record.raw_user_meta_data->>'name'), '')),
      'license', public.company_creation_license(user_record.id),
      'companies', coalesce((select jsonb_agg(jsonb_build_object('id', company.id, 'name', company.name, 'created_at', company.created_at) order by company.created_at) from public.companies company where company.user_id = user_record.id), '[]'::jsonb)
    ) row_data
    from auth.users user_record
    where exists (select 1 from public.companies company where company.user_id = user_record.id)
       or exists (select 1 from public.user_company_limits limit_row where limit_row.user_id = user_record.id)
  ) rows;
$$;

create or replace function public.developer_export_company_backup(target_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies where id = target_company) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'company', to_jsonb(c) - array['developer_notes','owner_email','user_id'],
    'accountCategories', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.account_categories x where x.company_id=target_company),'[]'::jsonb),
    'itemCategories', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.item_categories x where x.company_id=target_company),'[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.accounts x where x.company_id=target_company),'[]'::jsonb),
    'parties', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.parties x where x.company_id=target_company),'[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from public.items x where x.company_id=target_company),'[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(
      (to_jsonb(v)-array['created_by','updated_by','completed_by']) || jsonb_build_object(
        'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.voucher_lines l where l.voucher_id=v.id),'[]'::jsonb),
        'stock_lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.stock_lines l where l.voucher_id=v.id),'[]'::jsonb),
        'invoice_items',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.invoice_items l where l.voucher_id=v.id),'[]'::jsonb),
        'settlements',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.voucher_settlements l where l.settlement_voucher_id=v.id),'[]'::jsonb)
      ) order by v.date_bs_key,v.seq,v.id) from public.vouchers v where v.company_id=target_company),'[]'::jsonb),
    'chequeBanks',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.created_at,x.id) from public.cheque_banks x where x.company_id=target_company),'[]'::jsonb),
    'cheques',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.created_at,x.id) from public.cheques x where x.company_id=target_company),'[]'::jsonb),
    'chequeEvents',coalesce((select jsonb_agg(to_jsonb(x)-array['actor_id'] order by x.created_at,x.id) from public.cheque_events x where x.company_id=target_company),'[]'::jsonb),
    'companyModules',coalesce((select jsonb_agg((to_jsonb(x)-array['enabled_by','internal_notes']) || jsonb_build_object('module_key',m.key) order by x.created_at,x.id) from public.company_modules x join public.modules m on m.id=x.module_id where x.company_id=target_company),'[]'::jsonb),
    'masterChangeLogs',coalesce((select jsonb_agg(to_jsonb(x)-array['user_id'] order by x.created_at,x.id) from public.master_change_logs x where x.company_id=target_company),'[]'::jsonb),
    'appEvents',coalesce((select jsonb_agg(to_jsonb(x)-array['user_id'] order by x.created_at,x.id) from public.app_events x where x.company_id=target_company),'[]'::jsonb)
  ) into result from public.companies c where c.id=target_company;
  return result;
end;
$$;

create or replace function public.start_developer_backup_run(p_total_companies integer)
returns public.developer_backup_runs language plpgsql security definer set search_path=public
as $$ declare saved public.developer_backup_runs; begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  insert into public.developer_backup_runs(initiated_by,total_companies) values(auth.uid(),greatest(coalesce(p_total_companies,0),0)) returning * into saved; return saved;
end $$;

create or replace function public.record_developer_company_backup_result(p_run_id uuid,p_company_id uuid,p_successful boolean,p_error text default null)
returns public.developer_company_backup_status language plpgsql security definer set search_path=public
as $$ declare saved public.developer_company_backup_status; begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  if not exists(select 1 from public.developer_backup_runs where id=p_run_id and status='running') then raise exception 'Backup run is not active'; end if;
  insert into public.developer_company_backup_status(company_id,last_exported_at,last_attempted_at,last_export_status,last_exported_by,last_error)
  values(p_company_id,case when p_successful then now() end,now(),case when p_successful then 'successful' else 'failed' end,case when p_successful then auth.uid() end,case when p_successful then null else left(coalesce(p_error,'Export failed'),1000) end)
  on conflict(company_id) do update set last_attempted_at=excluded.last_attempted_at,last_export_status=excluded.last_export_status,last_exported_at=case when p_successful then excluded.last_exported_at else developer_company_backup_status.last_exported_at end,last_exported_by=case when p_successful then excluded.last_exported_by else developer_company_backup_status.last_exported_by end,last_error=excluded.last_error returning * into saved;
  update public.developer_backup_runs set successful_companies=successful_companies+case when p_successful then 1 else 0 end,failed_companies=failed_companies+case when p_successful then 0 else 1 end where id=p_run_id;
  return saved;
end $$;

create or replace function public.complete_developer_backup_run(p_run_id uuid)
returns public.developer_backup_runs language plpgsql security definer set search_path=public
as $$ declare saved public.developer_backup_runs; begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  update public.developer_backup_runs set completed_at=now(),status=case when failed_companies=0 then 'successful' when successful_companies=0 then 'failed' else 'partial' end where id=p_run_id and status='running' returning * into saved;
  if saved.id is null then raise exception 'Backup run is not active'; end if; return saved;
end $$;

revoke all on table public.developer_backup_runs,public.developer_company_backup_status from public,anon,authenticated;
grant select on table public.developer_backup_runs,public.developer_company_backup_status to authenticated;
revoke all on function public.developer_export_company_backup(uuid),public.start_developer_backup_run(integer),public.record_developer_company_backup_result(uuid,uuid,boolean,text),public.complete_developer_backup_run(uuid) from public,anon;
grant execute on function public.developer_export_company_backup(uuid),public.start_developer_backup_run(integer),public.record_developer_company_backup_result(uuid,uuid,boolean,text),public.complete_developer_backup_run(uuid) to authenticated;

commit;
-- END SYNCED DB FILE: supabase-developer-full-backup-migration.sql

-- BEGIN SYNCED DB FILE: supabase-automated-backup-agent-migration.sql
begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

alter table public.developer_backup_runs alter column initiated_by drop not null;
alter table public.developer_backup_runs add column if not exists initiator_type text not null default 'manual'
  check (initiator_type in ('manual','automated','agent_retry'));

create table if not exists public.developer_backup_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  token_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
alter table public.developer_backup_agents enable row level security;
drop policy if exists developer_backup_agents_select on public.developer_backup_agents;
create policy developer_backup_agents_select on public.developer_backup_agents for select using ((select public.is_developer_admin()));

create or replace function public.create_developer_backup_agent(p_name text default 'Windows Backup Agent')
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$ declare saved public.developer_backup_agents; secret text; begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  secret:=encode(gen_random_bytes(32),'hex');
  insert into public.developer_backup_agents(name,token_hash,created_by) values(left(btrim(coalesce(nullif(p_name,''),'Windows Backup Agent')),100),encode(digest(secret,'sha256'),'hex'),auth.uid()) returning * into saved;
  return jsonb_build_object('id',saved.id,'name',saved.name,'token',saved.id::text||'.'||secret,'created_at',saved.created_at);
end $$;

create or replace function public.revoke_developer_backup_agent(p_agent_id uuid)
returns void language plpgsql security definer set search_path=public
as $$ begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  update public.developer_backup_agents set revoked_at=now() where id=p_agent_id;
end $$;

create or replace function public.list_developer_backup_agents()
returns table(id uuid,name text,created_at timestamptz,last_seen_at timestamptz,revoked_at timestamptz)
language plpgsql stable security definer set search_path=public
as $$ begin
  if not public.is_developer_admin() then raise exception 'Developer admin access required' using errcode='42501'; end if;
  return query select a.id,a.name,a.created_at,a.last_seen_at,a.revoked_at from public.developer_backup_agents a order by a.created_at desc;
end $$;

create or replace function public.system_export_company_backup(target_company uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$ declare result jsonb; begin
  if current_user <> 'service_role' and current_setting('request.jwt.claim.role',true) <> 'service_role' then raise exception 'Server backup access required' using errcode='42501'; end if;
  if not exists(select 1 from public.companies where id=target_company) then raise exception 'Company not found' using errcode='P0002'; end if;
  select jsonb_build_object(
    'company',to_jsonb(c)-array['developer_notes','owner_email','user_id'],
    'accountCategories',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.account_categories x where x.company_id=target_company),'[]'::jsonb),
    'itemCategories',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.item_categories x where x.company_id=target_company),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.accounts x where x.company_id=target_company),'[]'::jsonb),
    'parties',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.parties x where x.company_id=target_company),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.items x where x.company_id=target_company),'[]'::jsonb),
    'vouchers',coalesce((select jsonb_agg((to_jsonb(v)-array['created_by','updated_by','completed_by'])||jsonb_build_object(
      'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.voucher_lines l where l.voucher_id=v.id),'[]'::jsonb),
      'stock_lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.stock_lines l where l.voucher_id=v.id),'[]'::jsonb),
      'invoice_items',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.invoice_items l where l.voucher_id=v.id),'[]'::jsonb),
      'settlements',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.voucher_settlements l where l.settlement_voucher_id=v.id),'[]'::jsonb)
    ) order by v.date_bs_key,v.seq,v.id) from public.vouchers v where v.company_id=target_company),'[]'::jsonb),
    'chequeBanks',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.created_at,x.id) from public.cheque_banks x where x.company_id=target_company),'[]'::jsonb),
    'cheques',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.created_at,x.id) from public.cheques x where x.company_id=target_company),'[]'::jsonb),
    'chequeEvents',coalesce((select jsonb_agg(to_jsonb(x)-array['actor_id'] order by x.created_at,x.id) from public.cheque_events x where x.company_id=target_company),'[]'::jsonb),
    'companyModules',coalesce((select jsonb_agg((to_jsonb(x)-array['enabled_by','internal_notes'])||jsonb_build_object('module_key',m.key) order by x.created_at,x.id) from public.company_modules x join public.modules m on m.id=x.module_id where x.company_id=target_company),'[]'::jsonb),
    'masterChangeLogs',coalesce((select jsonb_agg(to_jsonb(x)-array['user_id'] order by x.created_at,x.id) from public.master_change_logs x where x.company_id=target_company),'[]'::jsonb),
    'appEvents',coalesce((select jsonb_agg(to_jsonb(x)-array['user_id'] order by x.created_at,x.id) from public.app_events x where x.company_id=target_company),'[]'::jsonb)
  ) into result from public.companies c where c.id=target_company;
  return result;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('developer-company-backups','developer-company-backups',false,52428800,array['application/json'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

do $$ begin
  if exists(select 1 from cron.job where jobname='khataerp-automated-company-backup') then perform cron.unschedule('khataerp-automated-company-backup'); end if;
  perform cron.schedule('khataerp-automated-company-backup','0 */2 * * *',$job$
    select net.http_post(
      url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/developer-backup',
      headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',(select decrypted_secret from vault.decrypted_secrets where name='backup_automation_secret')),
      body:='{"action":"run"}'::jsonb,
      timeout_milliseconds:=600000
    );
  $job$);
end $$;

revoke all on table public.developer_backup_agents from public,anon,authenticated;
revoke all on function public.system_export_company_backup(uuid) from public,anon,authenticated;
grant execute on function public.system_export_company_backup(uuid) to service_role;
revoke all on function public.create_developer_backup_agent(text),public.revoke_developer_backup_agent(uuid),public.list_developer_backup_agents() from public,anon;
grant execute on function public.create_developer_backup_agent(text),public.revoke_developer_backup_agent(uuid),public.list_developer_backup_agents() to authenticated;

commit;
-- END SYNCED DB FILE: supabase-automated-backup-agent-migration.sql

-- BEGIN SYNCED DB FILE: supabase-company-billing-trial-migration.sql
-- One trial per user, company paid terms, and authoritative read-only enforcement.
begin;

alter table public.companies add column if not exists plan_expires_at timestamptz;

-- Preserve the effective access of legacy rows. The old date was inclusive in
-- Nepal time, so its equivalent timestamp is midnight immediately afterward.
update public.companies
set plan_expires_at = case
  when trial_ends_at is not null then ((trial_ends_at + 1)::timestamp at time zone 'Asia/Kathmandu')
  else created_at + interval '14 days'
end
where plan_status = 'trial' and plan_expires_at is null;

update public.companies
set plan_expires_at = ((trial_ends_at + 1)::timestamp at time zone 'Asia/Kathmandu')
where plan_status = 'paid' and plan_expires_at is null and trial_ends_at is not null;

create or replace function public.company_billing_status(target_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  company_row public.companies%rowtype;
  effective_status text;
  remaining_days integer;
  elapsed_days integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.is_developer_admin() and not public.is_company_admin(target_company) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  select * into company_row from public.companies where id = target_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;

  effective_status := case
    when company_row.suspended then 'suspended'
    when company_row.plan_status = 'expired' then 'expired'
    when company_row.plan_status in ('trial','paid')
      and company_row.plan_expires_at is not null
      and company_row.plan_expires_at <= clock_timestamp() then 'expired'
    else company_row.plan_status
  end;
  if company_row.plan_expires_at is not null then
    remaining_days := greatest(ceil(extract(epoch from (company_row.plan_expires_at - clock_timestamp())) / 86400.0)::integer, 0);
    elapsed_days := greatest(ceil(extract(epoch from (clock_timestamp() - company_row.plan_expires_at)) / 86400.0)::integer, 0);
  end if;
  return jsonb_build_object(
    'configured_status', company_row.plan_status,
    'effective_status', effective_status,
    'expires_at', company_row.plan_expires_at,
    'remaining_days', remaining_days,
    'days_since_expiry', elapsed_days,
    'can_write', effective_status not in ('expired','suspended')
  );
end;
$$;

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
    raise exception 'Company logo must use an HTTPS URL' using errcode = '22023';
  end if;
  if new.owner_email is distinct from old.owner_email
    and new.owner_email is distinct from nullif(auth.jwt()->>'email', '') then
    raise exception 'Company owner email must match the authenticated user' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
    or new.plan_status is distinct from old.plan_status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.plan_expires_at is distinct from old.plan_expires_at
    or new.support_status is distinct from old.support_status
    or new.developer_notes is distinct from old.developer_notes
    or new.suspended is distinct from old.suspended then
    raise exception 'Developer-controlled company fields cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_tenant_write_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  company_row public.companies%rowtype;
  signup_at timestamptz;
  initializing_company text;
begin
  if auth.uid() is null or public.is_developer_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_argv[0] = 'company' then
    target_company := case when tg_op = 'DELETE' then old.id else new.id end;
    if tg_op = 'INSERT' then
      if new.user_id is distinct from auth.uid() or new.plan_status is distinct from 'trial'
        or new.trial_ends_at is not null or new.plan_expires_at is not null
        or new.support_status is distinct from 'normal' or new.developer_notes is not null
        or coalesce(new.suspended, false) then
        raise exception 'New company security fields are invalid' using errcode = '42501';
      end if;
      select created_at into signup_at from auth.users where id = auth.uid();
      new.plan_expires_at := signup_at + interval '14 days';
      new.trial_ends_at := (new.plan_expires_at at time zone 'Asia/Kathmandu')::date;
      return new;
    end if;
  elsif tg_argv[0] = 'voucher_child' then
    select voucher.company_id into target_company from public.vouchers voucher
    where voucher.id = case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  else
    target_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  end if;

  if target_company is null and tg_op = 'DELETE' then return old; end if;
  select * into company_row from public.companies where id = target_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;
  initializing_company := current_setting('khataerp.initializing_company', true);
  if initializing_company = target_company::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not public.is_company_admin(target_company) then
    raise exception 'Company write access denied' using errcode = '42501';
  end if;

  if (company_row.suspended or company_row.plan_status = 'expired'
      or (company_row.plan_status in ('trial','paid') and company_row.plan_expires_at is not null
          and company_row.plan_expires_at <= clock_timestamp()))
    and not (tg_argv[0] = 'company' and tg_op = 'DELETE') then
    raise exception 'Company plan expired. This company is read-only until renewed.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists company_control_fields_guard on public.companies;
create trigger company_control_fields_guard before update on public.companies
for each row execute function public.protect_company_control_fields();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'accounts','account_categories','parties','items','item_categories','master_change_logs',
    'vouchers','voucher_settlements','app_events','cheque_banks','cheques','cheque_events','company_modules',
    'company_members','company_user_permissions'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists tenant_write_access_guard on public.%I', table_name);
      execute format('create trigger tenant_write_access_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write_access(%L)', table_name, 'direct');
    end if;
  end loop;
  foreach table_name in array array['voucher_lines','stock_lines','invoice_items'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists tenant_write_access_guard on public.%I', table_name);
      execute format('create trigger tenant_write_access_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write_access(%L)', table_name, 'voucher_child');
    end if;
  end loop;
end $$;

drop trigger if exists tenant_write_access_guard on public.companies;
create trigger tenant_write_access_guard before insert or update or delete on public.companies
for each row execute function public.enforce_tenant_write_access('company');

-- Keep atomic initialization working even when a user first confirms their
-- email after the shared trial deadline. The resulting company is read-only.
create or replace function public.create_company_atomic(p_company jsonb)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare caller uuid := auth.uid(); generated_company_id uuid := gen_random_uuid(); user_email text; saved public.companies%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform public.assert_company_creation_allowed(caller);
  select email into user_email from auth.users where id = caller;
  perform set_config('khataerp.initializing_company', generated_company_id::text, true);
  insert into public.companies(id,user_id,owner_email,name,address,pan_vat,phone,vat_enabled,inventory_valuation_method,sales_prefix,purchase_prefix,receipt_prefix,payment_prefix,sales_return_prefix,purchase_return_prefix,journal_numbering_mode,reset_numbering_fiscal_year,print_format,invoice_terms,payment_qr_text,fiscal_year_start,fiscal_year_configured)
  values(generated_company_id,caller,user_email,coalesce(nullif(btrim(coalesce(p_company->>'name','')),''),'My Company'),nullif(btrim(coalesce(p_company->>'address','')),''),nullif(btrim(coalesce(p_company->>'pan_vat','')),''),nullif(btrim(coalesce(p_company->>'phone','')),''),coalesce((p_company->>'vat_enabled')::boolean,true),coalesce(nullif(p_company->>'inventory_valuation_method',''),'weighted_average'),coalesce(nullif(btrim(p_company->>'sales_prefix'),''),'INV-'),coalesce(nullif(btrim(p_company->>'purchase_prefix'),''),'PB-'),coalesce(nullif(btrim(p_company->>'receipt_prefix'),''),'RCPT-'),coalesce(nullif(btrim(p_company->>'payment_prefix'),''),'PAY-'),coalesce(nullif(btrim(p_company->>'sales_return_prefix'),''),'SR-'),coalesce(nullif(btrim(p_company->>'purchase_return_prefix'),''),'PR-'),coalesce(nullif(p_company->>'journal_numbering_mode',''),'auto'),true,coalesce(nullif(p_company->>'print_format',''),'A5'),nullif(btrim(coalesce(p_company->>'invoice_terms','')),''),nullif(btrim(coalesce(p_company->>'payment_qr_text','')),''),coalesce(nullif(p_company->>'fiscal_year_start','')::date,'2026-07-17'::date),coalesce((p_company->>'fiscal_year_configured')::boolean,true)) returning * into saved;
  insert into public.company_members(company_id,user_id,role,status,created_by) values(saved.id,caller,'Admin','active',caller)
  on conflict(company_id,user_id) do update set role='Admin',status='active',updated_at=now();
  perform public.ensure_default_company_accounts(saved.id);
  perform public.set_active_company(saved.id);
  perform set_config('khataerp.initializing_company', '', true);
  return saved;
end;
$$;

revoke all on function public.company_billing_status(uuid) from public, anon;
grant execute on function public.company_billing_status(uuid) to authenticated;
revoke all on function public.enforce_tenant_write_access(), public.protect_company_control_fields() from public, anon, authenticated;

commit;
-- END SYNCED DB FILE: supabase-company-billing-trial-migration.sql

-- BEGIN SYNCED DB FILE: supabase-delete-backup-agent-migration.sql
begin;

create or replace function public.delete_developer_backup_agent(p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_developer_admin() then
    raise exception 'Developer admin access required' using errcode = '42501';
  end if;
  delete from public.developer_backup_agents where id = p_agent_id;
  if not found then raise exception 'Windows backup agent not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.delete_developer_backup_agent(uuid) from public, anon;
grant execute on function public.delete_developer_backup_agent(uuid) to authenticated;

commit;
-- END SYNCED DB FILE: supabase-delete-backup-agent-migration.sql

-- BEGIN SYNCED DB FILE: supabase-six-decimal-accounting-precision-migration.sql
-- Preserve six-decimal accounting and inventory precision end-to-end.
-- Apply after all existing KhataERP migrations. Safe to run repeatedly.
begin;

drop table if exists pg_temp.six_decimal_trigger_restore;
create temporary table six_decimal_trigger_restore (
  trigger_name text primary key,
  definition text not null
);

insert into six_decimal_trigger_restore(trigger_name, definition)
select trigger.tgname, pg_get_triggerdef(trigger.oid, true)
from pg_trigger trigger
where trigger.tgrelid = 'public.vouchers'::regclass
  and not trigger.tgisinternal
  and trigger.tgname in (
    'vouchers_sync_contra_metadata',
    'vouchers_validate_contra',
    'vouchers_validate_simple_entry'
  );

drop trigger if exists vouchers_sync_contra_metadata on public.vouchers;
drop trigger if exists vouchers_validate_contra on public.vouchers;
drop trigger if exists vouchers_validate_simple_entry on public.vouchers;

do $precision$
declare
  target record;
begin
  for target in
    select * from (values
      ('accounts','opening_balance'),
      ('items','alternate_conversion'), ('items','sell_rate'),
      ('items','opening_qty'), ('items','opening_rate'), ('items','reorder_level'),
      ('vouchers','contra_charge_amount'), ('vouchers','subtotal'),
      ('vouchers','discount'), ('vouchers','vat_amount'), ('vouchers','total'),
      ('voucher_lines','debit'), ('voucher_lines','credit'),
      ('stock_lines','qty'), ('stock_lines','rate'),
      ('invoice_items','qty'), ('invoice_items','rate'),
      ('invoice_items','discount_amount'), ('invoice_items','taxable_amount'),
      ('invoice_items','vat_amount'), ('invoice_items','cost_rate'),
      ('invoice_items','conversion_factor'), ('invoice_items','base_qty'),
      ('voucher_settlements','amount'),
      ('cheques','amount'),
      ('cheque_subscription_plans','default_price'),
      ('company_cheque_subscriptions','price')
    ) as columns_to_widen(table_name, column_name)
  loop
    if exists (
      select 1 from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = target.table_name
        and column_info.column_name = target.column_name
    ) then
      execute format(
        'alter table public.%I alter column %I type numeric(18,6) using %I::numeric(18,6)',
        target.table_name, target.column_name, target.column_name
      );
    end if;
  end loop;
end;
$precision$;

do $restore_precision_triggers$
declare saved_trigger record;
begin
  for saved_trigger in select definition from six_decimal_trigger_restore order by trigger_name loop
    execute saved_trigger.definition;
  end loop;
end;
$restore_precision_triggers$;
drop table pg_temp.six_decimal_trigger_restore;

alter table public.invoice_items add column if not exists amount numeric(18,6);
alter table public.invoice_items disable trigger user;
update public.invoice_items
set amount = round(qty * rate, 6)
where amount is null;
alter table public.invoice_items alter column amount set not null;
alter table public.invoice_items enable trigger user;
alter table public.invoice_items drop constraint if exists invoice_items_amount_nonnegative;

create or replace function public.numeric_json_scale_valid(payload jsonb, numeric_keys text[])
returns boolean language sql immutable set search_path = public as $$
  select not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(payload) = 'array' then payload else jsonb_build_array(payload) end) object_value
    cross join unnest(numeric_keys) key_name
    where object_value ? key_name and nullif(object_value->>key_name, '') is not null
      and (object_value->>key_name)::numeric <> round((object_value->>key_name)::numeric, 6)
  );
$$;

-- Update the existing integrity function without discarding its security,
-- company ownership, return, stock, and cheque invariants.
do $rewrite_integrity$
declare
  function_sql text;
begin
  if to_regprocedure('public.validate_voucher_financial_integrity()') is null then
    raise exception 'validate_voucher_financial_integrity() must exist before applying precision migration';
  end if;

  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into function_sql;
  function_sql := replace(function_sql,
    'coalesce(sum(round(item.qty * item.rate, 2)), 0)',
    'coalesce(sum(item.amount), 0)');
  function_sql := replace(function_sql,
    'coalesce(sum(coalesce(item.taxable_amount, round(item.qty * item.rate, 2))), 0)',
    'coalesce(sum(coalesce(item.taxable_amount, item.amount)), 0)');
  function_sql := replace(function_sql, ', 2)', ', 6)');
  function_sql := replace(function_sql, '> 0.01', '> 0.000001');
  function_sql := replace(function_sql, '> greatest(0.02, item_count * 0.01)', '> greatest(0.000002, item_count * 0.000001)');
  function_sql := replace(function_sql, '> 0.0001', '> 0.000001');
  function_sql := replace(function_sql, '+ 0.0001', '+ 0.000001');
  execute function_sql;
end;
$rewrite_integrity$;

do $rewrite_related_validators$
declare
  function_name text;
  function_sql text;
begin
  foreach function_name in array array[
    'validate_simple_entry_voucher',
    'validate_contra_voucher',
    'validate_cleared_cheque_receipt'
  ] loop
    if to_regprocedure('public.' || function_name || '()') is not null then
      select pg_get_functiondef(to_regprocedure('public.' || function_name || '()')) into function_sql;
      function_sql := replace(function_sql, ', 2)', ', 6)');
      function_sql := replace(function_sql, ',2)', ',6)');
      function_sql := replace(function_sql, '> 0.01', '> 0.000001');
      execute function_sql;
    end if;
  end loop;
end;
$rewrite_related_validators$;

-- Teach the atomic writer and its normalized response about the authoritative
-- invoice amount while retaining the deployed function signature.
do $rewrite_atomic$
declare
  function_sql text;
begin
  if to_regprocedure('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)') is null then
    raise exception 'save_voucher_atomic() must exist before applying precision migration';
  end if;

  select pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure)
    into function_sql;
  function_sql := replace(function_sql, 'numeric(14,2)', 'numeric(18,6)');
  function_sql := replace(function_sql,
    'voucher_id, item_id, qty, rate, source_invoice_item_id, item_name, unit,',
    'voucher_id, item_id, qty, rate, amount, source_invoice_item_id, item_name, unit,');
  function_sql := replace(function_sql,
    'select saved.id, item.item_id, item.qty, item.rate, item.source_invoice_item_id,',
    'select saved.id, item.item_id, item.qty, item.rate, coalesce(item.amount, round(item.qty * item.rate, 6)), item.source_invoice_item_id,');
  function_sql := replace(function_sql,
    'item_id uuid, qty numeric, rate numeric, source_invoice_item_id uuid,',
    'item_id uuid, qty numeric, rate numeric, amount numeric, source_invoice_item_id uuid,');
  function_sql := replace(function_sql,
    $$  select coalesce(sum(coalesce(line.debit, 0)), 0),$$,
    $$  if not public.numeric_json_scale_valid(p_voucher, array['subtotal','discount','vat_amount','total','contra_charge_amount'])
    or not public.numeric_json_scale_valid(coalesce(p_lines,'[]'::jsonb), array['debit','credit'])
    or not public.numeric_json_scale_valid(coalesce(p_stock_lines,'[]'::jsonb), array['qty','rate'])
    or not public.numeric_json_scale_valid(coalesce(p_invoice_items,'[]'::jsonb), array['qty','rate','amount','discount_amount','taxable_amount','vat_amount','cost_rate','conversion_factor','base_qty'])
    or not public.numeric_json_scale_valid(coalesce(p_settlements,'[]'::jsonb), array['amount']) then
    raise exception 'Accounting values support at most six decimal places';
  end if;

  select coalesce(sum(coalesce(line.debit, 0)), 0),$$);
  execute function_sql;

  select pg_get_functiondef('public.voucher_atomic_response(uuid)'::regprocedure)
    into function_sql;
  function_sql := replace(function_sql,
    $$'id', item.id, 'item_id', item.item_id, 'qty', item.qty, 'rate', item.rate,$$,
    $$'id', item.id, 'item_id', item.item_id, 'qty', item.qty, 'rate', item.rate, 'amount', item.amount,$$);
  execute function_sql;
end;
$rewrite_atomic$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-six-decimal-accounting-precision-migration.sql

-- BEGIN SYNCED DB FILE: supabase-sales-invoice-company-details-print-setting-migration.sql
-- Optional company identity block on printed Sales invoices. Safe to rerun.
begin;

alter table public.companies
  add column if not exists show_company_details_on_sales_invoice boolean not null default true;

comment on column public.companies.show_company_details_on_sales_invoice is
  'When false, printed Sales invoices omit the company logo and identity details.';

commit;
-- END SYNCED DB FILE: supabase-sales-invoice-company-details-print-setting-migration.sql

-- BEGIN SYNCED DB FILE: supabase-remove-self-service-account-deletion-migration.sql
-- Remove self-service account/company deletion. Company deletion remains available
-- only through the existing developer-admin RPC.
begin;

drop function if exists public.delete_my_account();

commit;
notify pgrst, 'reload schema';
-- END SYNCED DB FILE: supabase-remove-self-service-account-deletion-migration.sql

-- BEGIN SYNCED DB FILE: supabase-security-audit.sql
-- Read-only pre-deployment RLS audit. Run in the Supabase SQL Editor after all
-- migrations. Expected result: zero rows from both queries.

-- Public tables without Row Level Security.
select namespace.nspname as schema_name, class.relname as table_name
from pg_class class
join pg_namespace namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'public'
  and class.relkind in ('r', 'p')
  and not class.relrowsecurity
order by class.relname;

-- RLS-enabled public tables without any policy. An empty-policy table is
-- deny-by-default, but this identifies incomplete application configuration.
select class.relname as table_name
from pg_class class
join pg_namespace namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'public'
  and class.relkind in ('r', 'p')
  and class.relrowsecurity
  and not exists (
    select 1 from pg_policy policy where policy.polrelid = class.oid
  )
order by class.relname;
-- END SYNCED DB FILE: supabase-security-audit.sql

-- BEGIN SYNCED DB FILE: supabase-write-performance-diagnostics.sql
-- Read-only write-performance diagnostics. Run after a representative test
-- workload. This file does not change schema, data, RLS, or configuration.

-- Database-only statement execution (requires pg_stat_statements, normally
-- available in Supabase). Values exclude browser processing and most client
-- network latency.
select
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 240) as normalized_query
from pg_stat_statements
where query ~* '(insert|update|delete).*(vouchers|voucher_lines|stock_lines|invoice_items|voucher_settlements|accounts|parties|items|account_categories|item_categories|master_change_logs|app_events)'
order by total_exec_time desc
limit 50;

-- Trigger/function time is populated when PostgreSQL track_functions is
-- enabled by the project. Zero rows means the project is not collecting it;
-- do not infer that triggers are free.
select
  schemaname,
  funcname,
  calls,
  round(total_time::numeric, 2) as total_ms,
  round(self_time::numeric, 2) as self_ms,
  case when calls > 0 then round((total_time / calls)::numeric, 3) else 0 end as mean_ms
from pg_stat_user_functions
where funcname in (
  'validate_voucher_balance',
  'validate_voucher_settlement',
  'save_voucher_atomic',
  'validate_account_category_hierarchy',
  'validate_item_category_hierarchy'
)
order by total_time desc;

-- Verify the indexes used by current write validation and foreign-key paths.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('vouchers','voucher_lines','stock_lines','invoice_items','voucher_settlements','accounts','parties','items')
order by tablename, indexname;

-- Phase 5 representative plans. These are read-only SELECT equivalents of
-- lookups executed during atomic posting and category writes. PostgreSQL may
-- correctly choose a sequential scan for very small test tables; compare the
-- estimated/actual rows and buffers rather than treating every Seq Scan as a
-- defect.
explain (analyze, buffers, verbose)
with sample_company as (
  select company_id
  from public.vouchers
  group by company_id
  order by count(*) desc
  limit 1
)
select max(voucher.seq)
from public.vouchers voucher
join sample_company sample on sample.company_id = voucher.company_id;

explain (analyze, buffers, verbose)
with sample_scope as (
  select company_id, type, numbering_period
  from public.vouchers
  where invoice_no is not null
  group by company_id, type, numbering_period
  order by count(*) desc
  limit 1
)
select max((substring(voucher.invoice_no from '([0-9]+)$'))::bigint)
from public.vouchers voucher
join sample_scope sample
  on sample.company_id = voucher.company_id
 and sample.type = voucher.type
 and sample.numbering_period = voucher.numbering_period
where voucher.invoice_no is not null;

explain (analyze, buffers, verbose)
select account.id
from public.accounts account
where account.category_id = (
  select category_id from public.accounts
  where category_id is not null
  limit 1
);

explain (analyze, buffers, verbose)
select line.id
from public.voucher_lines line
where line.voucher_id = (select voucher_id from public.voucher_lines limit 1);

explain (analyze, buffers, verbose)
select line.id
from public.stock_lines line
where line.voucher_id = (select voucher_id from public.stock_lines limit 1);

explain (analyze, buffers, verbose)
select item.id
from public.invoice_items item
where item.voucher_id = (select voucher_id from public.invoice_items limit 1);

-- Index use and size after a representative Phase 4 workload. Low idx_scan on
-- a newly created or tiny table is not enough reason to remove an index.
select
  stats.relname as table_name,
  stats.indexrelname as index_name,
  stats.idx_scan,
  stats.idx_tup_read,
  stats.idx_tup_fetch,
  pg_size_pretty(pg_relation_size(stats.indexrelid)) as index_size
from pg_stat_user_indexes stats
where stats.schemaname = 'public'
  and stats.relname in (
    'companies','accounts','parties','items','vouchers','voucher_lines',
    'stock_lines','invoice_items','voucher_settlements','app_events'
  )
order by stats.relname, stats.indexrelname;

-- Foreign keys without a supporting index whose leading columns exactly match
-- the FK. This is an audit list, not an instruction to index every result:
-- indexes are mainly justified when referenced rows are actually updated or
-- deleted often enough to make the FK check measurable.
select
  constraint_record.conrelid::regclass as child_table,
  constraint_record.conname as foreign_key,
  pg_get_constraintdef(constraint_record.oid) as definition
from pg_constraint constraint_record
where constraint_record.contype = 'f'
  and constraint_record.connamespace = 'public'::regnamespace
  and not exists (
    select 1
    from pg_index index_record
    where index_record.indrelid = constraint_record.conrelid
      and index_record.indisvalid
      and cardinality(index_record.indkey::smallint[]) >= cardinality(constraint_record.conkey)
      and not exists (
        select 1
        from generate_subscripts(constraint_record.conkey, 1) position
        where constraint_record.conkey[position]
          <> (index_record.indkey::smallint[])[position - 1]
      )
  )
order by constraint_record.conrelid::regclass::text, constraint_record.conname;

-- Phase 6 trigger inventory: frequency is per ROW or STATEMENT as shown.
-- Internal constraint triggers are excluded; enabled='O' means normal.
select
  trigger_record.tgrelid::regclass as table_name,
  trigger_record.tgname as trigger_name,
  case when trigger_record.tgtype & 1 = 1 then 'ROW' else 'STATEMENT' end as frequency,
  case
    when trigger_record.tgtype & 2 = 2 then 'BEFORE'
    when trigger_record.tgtype & 64 = 64 then 'INSTEAD OF'
    else 'AFTER'
  end as timing,
  concat_ws(', ',
    case when trigger_record.tgtype & 4 = 4 then 'INSERT' end,
    case when trigger_record.tgtype & 8 = 8 then 'DELETE' end,
    case when trigger_record.tgtype & 16 = 16 then 'UPDATE' end,
    case when trigger_record.tgtype & 32 = 32 then 'TRUNCATE' end
  ) as events,
  trigger_record.tgdeferrable,
  trigger_record.tginitdeferred,
  function_record.proname as function_name,
  pg_get_triggerdef(trigger_record.oid) as definition
from pg_trigger trigger_record
join pg_proc function_record on function_record.oid = trigger_record.tgfoid
where not trigger_record.tgisinternal
  and trigger_record.tgrelid::regclass::text in (
    'companies','account_categories','item_categories','vouchers','voucher_lines',
    'stock_lines','invoice_items','voucher_settlements','cheque_banks','cheques',
    'cheque_events','accounts','parties','items','app_events'
  )
order by trigger_record.tgrelid::regclass::text, trigger_record.tgname;

-- Legacy issuing-bank names that prevent a unique case-insensitive index.
-- Phase 6 leaves these records untouched and uses a non-unique lookup index.
select
  company_id,
  lower(bank_name) as normalized_bank_name,
  count(*) as records,
  array_agg(id order by created_at, id) as bank_ids
from public.cheque_banks
group by company_id, lower(bank_name)
having count(*) > 1
order by company_id, normalized_bank_name;

-- Trigger/function totals after a representative workload. Requires
-- track_functions; zero rows means timing collection is disabled.
select
  functions.schemaname,
  functions.funcname,
  functions.calls,
  round(functions.total_time::numeric, 3) as total_ms,
  round(functions.self_time::numeric, 3) as self_ms,
  case when functions.calls > 0
    then round((functions.total_time / functions.calls)::numeric, 4)
    else 0 end as mean_ms
from pg_stat_user_functions functions
where functions.funcname in (
  'validate_voucher_balance','validate_voucher_settlement',
  'validate_account_category_hierarchy','validate_item_category_hierarchy',
  'protect_system_account_category','seed_system_account_groups_for_company',
  'seed_cheque_banks_on_entitlement','validate_cheque_bank',
  'cheque_touch_and_audit'
)
order by functions.total_time desc;

-- Phase 7 effective policy definitions. Review qual/with_check to verify that
-- tenant, entitlement, and permission predicates remain present.
select
  schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'companies','accounts','account_categories','parties','items',
    'item_categories','master_change_logs','vouchers','voucher_lines',
    'stock_lines','invoice_items','voucher_settlements','app_events','modules',
    'company_modules','company_user_permissions','cheque_banks','cheques',
    'cheque_events'
  )
order by tablename, policyname;

-- Current non-idle locks on write-related tables. Run while reproducing a slow
-- write to distinguish index/query cost from lock waiting.
select
  activity.pid,
  activity.state,
  activity.wait_event_type,
  activity.wait_event,
  lock_record.relation::regclass as relation,
  lock_record.mode,
  lock_record.granted,
  left(activity.query, 180) as query
from pg_locks lock_record
join pg_stat_activity activity on activity.pid = lock_record.pid
where lock_record.relation::regclass::text in (
  'companies','accounts','account_categories','parties','items','vouchers',
  'voucher_lines','stock_lines','invoice_items','voucher_settlements',
  'cheque_banks','cheques','cheque_events','app_events'
)
  and activity.state <> 'idle'
order by lock_record.granted, activity.query_start;

-- Phases 12-16 verification: idempotency support and atomic-posting timing.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'vouchers'
  and indexname = 'vouchers_company_idempotency_unique';

select
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 240) as normalized_query
from pg_stat_statements
where query ilike '%save_voucher_atomic%'
order by total_exec_time desc;

-- One voucher audit event is expected per successful unique request. Reusing
-- an idempotency key must return the existing voucher without another event.
select
  metadata->>'voucher_id' as voucher_id,
  count(*) as audit_events,
  min(created_at) as first_event,
  max(created_at) as last_event
from public.app_events
where event_type in ('voucher_created','voucher_updated','return_created','stock_adjustment')
  and metadata ? 'voucher_id'
group by metadata->>'voucher_id'
having count(*) > 1
order by audit_events desc, voucher_id;

-- Same-company voucher posts may briefly wait on one advisory transaction
-- lock. Long waits here indicate an unexpectedly long posting transaction.
select
  activity.pid,
  activity.state,
  activity.xact_start,
  now() - activity.xact_start as transaction_age,
  activity.wait_event_type,
  activity.wait_event,
  lock_record.classid,
  lock_record.objid,
  lock_record.granted,
  left(activity.query, 180) as query
from pg_locks lock_record
join pg_stat_activity activity on activity.pid = lock_record.pid
where lock_record.locktype = 'advisory'
order by lock_record.granted, activity.xact_start;
-- END SYNCED DB FILE: supabase-write-performance-diagnostics.sql

-- =============================================================================
-- FINAL BOOTSTRAP VERIFICATION
-- =============================================================================
do $bootstrap_verification$
declare
  required_table text;
  table_oid regclass;
  rls_enabled boolean;
  integrity_definition text;
begin
  foreach required_table in array array[
    'developer_admins', 'companies', 'accounts', 'parties', 'items',
    'account_categories', 'item_categories', 'master_change_logs',
    'vouchers', 'voucher_lines', 'stock_lines', 'invoice_items',
    'voucher_settlements', 'app_events', 'company_members',
    'user_preferences', 'user_company_limits', 'modules', 'company_modules',
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
  if to_regprocedure('public.create_company_atomic(jsonb)') is null
    or to_regprocedure('public.get_my_companies()') is null
    or to_regprocedure('public.set_active_company(uuid)') is null then
    raise exception 'Bootstrap verification failed: multi-company RPCs are missing';
  end if;
  if to_regprocedure('public.prevent_duplicate_ledger_name()') is null
    or not exists (
      select 1
      from pg_trigger trigger
      join pg_class class on class.oid = trigger.tgrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relname = 'accounts'
        and trigger.tgname = 'accounts_duplicate_name_guard'
        and not trigger.tgisinternal
  ) then
    raise exception 'Bootstrap verification failed: duplicate ledger name guard is missing';
  end if;
  if to_regprocedure('public.prevent_duplicate_item_name()') is null
    or to_regprocedure('public.prevent_duplicate_item_category_name()') is null
    or to_regprocedure('public.prevent_duplicate_account_category_name()') is null
    or not exists (
      select 1
      from pg_trigger trigger
      join pg_class class on class.oid = trigger.tgrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relname = 'items'
        and trigger.tgname = 'items_duplicate_name_guard'
        and not trigger.tgisinternal
    )
    or not exists (
      select 1
      from pg_trigger trigger
      join pg_class class on class.oid = trigger.tgrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relname = 'item_categories'
        and trigger.tgname = 'item_categories_duplicate_name_guard'
        and not trigger.tgisinternal
    )
    or not exists (
      select 1
      from pg_trigger trigger
      join pg_class class on class.oid = trigger.tgrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relname = 'account_categories'
        and trigger.tgname = 'account_categories_duplicate_name_guard'
        and not trigger.tgisinternal
    ) then
    raise exception 'Bootstrap verification failed: duplicate master name guards are missing';
  end if;
  if to_regprocedure('public.validate_voucher_chronology()') is null
    or to_regprocedure('public.voucher_number_value(text)') is null
    or not exists (
      select 1
      from pg_trigger trigger
      join pg_class class on class.oid = trigger.tgrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relname = 'vouchers'
        and trigger.tgname = 'vouchers_chronology_guard'
        and not trigger.tgisinternal
    ) then
    raise exception 'Bootstrap verification failed: voucher chronology guard is missing';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'journal_numbering_mode')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'fiscal_year_configured')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'allow_admin_chronological_bypass')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'enforce_sales_invoice_chronology')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'supplier_invoice_no')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'status')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'draft_no')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'draft_payload')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'created_by')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'updated_by')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'completed_by')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vouchers' and column_name = 'completed_at')
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_items' and column_name = 'amount' and numeric_scale = 6)
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'voucher_lines' and column_name = 'debit' and numeric_scale = 6)
    or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'is_service') then
    raise exception 'Bootstrap verification failed: current release columns are missing';
  end if;

  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into integrity_definition;
  if position('coalesce(voucher_record.status, ''Completed'') = ''Draft''' in integrity_definition) = 0 then
    raise exception 'Bootstrap verification failed: draft voucher integrity bypass is missing';
  end if;
  if position('item.qty / nullif(coalesce(item.conversion_factor, 1), 0)' in integrity_definition) = 0 then
    raise exception 'Bootstrap verification failed: alternate-unit base quantity integrity is missing';
  end if;
  if position('item.rate < 0' in integrity_definition) > 0 then
    raise exception 'Bootstrap verification failed: negative invoice rate restore support is missing';
  end if;
  if position('item.qty < 0' in integrity_definition) > 0 then
    raise exception 'Bootstrap verification failed: legacy invoice quantity restore support is missing';
  end if;
  if position('item.base_qty is not null and abs(item.base_qty' in integrity_definition) > 0 then
    raise exception 'Bootstrap verification failed: legacy invoice base quantity restore support is missing';
  end if;
end;
$bootstrap_verification$;

-- BEGIN SYNCED DB FILE: supabase-performance-optimization-migration.sql
-- BEGIN SYNCED MIGRATION: 202608170001_performance_observability.sql
begin;

create table if not exists public.performance_samples (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null,
  operation text not null check (operation ~ '^[a-z0-9_]{1,80}$'),
  record_type text not null check (length(record_type) between 1 and 80),
  duration_ms numeric(12,2) not null check (duration_ms >= 0),
  success boolean not null,
  line_items integer not null default 0 check (line_items between 0 and 10000),
  query_count integer not null default 0 check (query_count between 0 and 1000),
  network_class text check (network_class is null or length(network_class) <= 30),
  company_size_band text not null check (company_size_band in ('under_1k','1k_10k','10k_50k','50k_100k','over_100k')),
  app_version text check (app_version is null or length(app_version) <= 80),
  error_code text check (error_code is null or length(error_code) <= 80),
  stages jsonb not null default '[]'::jsonb check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) <= 30),
  created_at timestamptz not null default now()
);

-- A pre-release copy briefly stored company_id. Telemetry deliberately keeps
-- no company or business-record identifier.
alter table public.performance_samples drop column if exists company_id;

create index if not exists idx_performance_samples_created on public.performance_samples(created_at desc);
create index if not exists idx_performance_samples_operation_created on public.performance_samples(operation, created_at desc);
alter table public.performance_samples enable row level security;

drop policy if exists performance_samples_developer_select on public.performance_samples;
create policy performance_samples_developer_select on public.performance_samples
for select using (public.is_developer_admin());

create or replace function public.record_performance_sample(p_company_id uuid, p_sample jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_stages jsonb;
begin
  if auth.uid() is null or p_company_id is null or not public.is_company_member(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'stage', left(coalesce(stage->>'stage','unknown'), 80),
    'category', case when stage->>'category' in ('frontend','network_database','cache','ui','total') then stage->>'category' else 'frontend' end,
    'duration_ms', greatest(0, least(600000, coalesce((stage->>'duration_ms')::numeric, 0))),
    'success', coalesce((stage->>'success')::boolean, false)
  )), '[]'::jsonb)
  into safe_stages
  from jsonb_array_elements(coalesce(p_sample->'stages','[]'::jsonb)) stage;

  insert into public.performance_samples(
    trace_id, operation, record_type, duration_ms, success,
    line_items, query_count, network_class, company_size_band, app_version,
    error_code, stages
  ) values (
    (p_sample->>'trace_id')::uuid,
    left(coalesce(p_sample->>'operation','unknown'), 80),
    left(coalesce(p_sample->>'record_type','Unknown'), 80),
    greatest(0, least(600000, coalesce((p_sample->>'duration_ms')::numeric, 0))),
    coalesce((p_sample->>'success')::boolean, false),
    greatest(0, least(10000, coalesce((p_sample->>'line_items')::integer, 0))),
    greatest(0, least(1000, coalesce((p_sample->>'query_count')::integer, 0))),
    left(nullif(p_sample->>'network_class',''), 30),
    case when p_sample->>'company_size_band' in ('under_1k','1k_10k','10k_50k','50k_100k','over_100k') then p_sample->>'company_size_band' else 'under_1k' end,
    left(nullif(p_sample->>'app_version',''), 80),
    left(nullif(p_sample->>'error_code',''), 80),
    safe_stages
  );

  if random() < 0.01 then
    delete from public.performance_samples where created_at < now() - interval '30 days';
  end if;
end;
$$;

create or replace function public.developer_performance_summary(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_developer_admin() then
    raise exception 'Developer access required' using errcode = '42501';
  end if;
  with filtered as (
    select * from public.performance_samples
    where created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days,7), 30)))
  ), operation_summary as (
    select operation, count(*)::integer samples,
      round(percentile_cont(0.5) within group (order by duration_ms)::numeric, 2) p50_ms,
      round(percentile_cont(0.95) within group (order by duration_ms)::numeric, 2) p95_ms,
      round(percentile_cont(0.99) within group (order by duration_ms)::numeric, 2) p99_ms,
      round(avg(duration_ms), 2) average_ms,
      round(100.0 * count(*) filter (where not success) / nullif(count(*),0), 2) error_rate,
      max(duration_ms) max_ms
    from filtered group by operation
  ), stage_summary as (
    select stage->>'stage' stage, stage->>'category' category, count(*)::integer samples,
      round(avg((stage->>'duration_ms')::numeric), 2) average_ms,
      round(percentile_cont(0.95) within group (order by (stage->>'duration_ms')::numeric)::numeric, 2) p95_ms
    from filtered cross join lateral jsonb_array_elements(stages) stage
    group by stage->>'stage', stage->>'category'
    order by p95_ms desc limit 20
  )
  select jsonb_build_object(
    'window_days', greatest(1, least(coalesce(p_days,7), 30)),
    'total_samples', (select count(*) from filtered),
    'operations', coalesce((select jsonb_agg(to_jsonb(row) order by row.p95_ms desc) from operation_summary row), '[]'::jsonb),
    'slowest_stages', coalesce((select jsonb_agg(to_jsonb(row) order by row.p95_ms desc) from stage_summary row), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.record_performance_sample(uuid, jsonb) from public, anon;
grant execute on function public.record_performance_sample(uuid, jsonb) to authenticated;
revoke all on function public.developer_performance_summary(integer) from public, anon, authenticated;
grant execute on function public.developer_performance_summary(integer) to authenticated;

commit;
notify pgrst, 'reload schema';
-- END SYNCED MIGRATION: 202608170001_performance_observability.sql

-- BEGIN SYNCED MIGRATION: 202608170002_voucher_validation_once.sql
-- Schedule expensive deferred voucher validators once per affected voucher and
-- transaction. The scheduled validator still runs at transaction end and sees
-- the complete final voucher, including direct PostgREST writes.
create or replace function public.schedule_validation_once(
  validation_key text,
  target_id uuid
)
returns boolean
language plpgsql
volatile
set search_path = public
as $$
declare
  setting_key text := 'khataerp.validation_' || regexp_replace(validation_key, '[^a-z0-9_]', '_', 'g');
  seen text := coalesce(current_setting(setting_key, true), '');
  marker text := ',' || target_id::text || ',';
begin
  if target_id is null or position(marker in ',' || seen || ',') > 0 then
    return false;
  end if;
  perform set_config(setting_key, concat_ws(',', nullif(seen, ''), target_id::text), true);
  return true;
end;
$$;

revoke all on function public.schedule_validation_once(text, uuid) from public;

drop trigger if exists voucher_financial_integrity_header on public.vouchers;
create constraint trigger voucher_financial_integrity_header
after insert or update on public.vouchers
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', new.id))
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_lines on public.voucher_lines;
drop trigger if exists voucher_financial_integrity_lines_write on public.voucher_lines;
drop trigger if exists voucher_financial_integrity_lines_delete on public.voucher_lines;
create constraint trigger voucher_financial_integrity_lines_write
after insert or update on public.voucher_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', new.voucher_id))
execute function public.validate_voucher_financial_integrity();
create constraint trigger voucher_financial_integrity_lines_delete
after delete on public.voucher_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', old.voucher_id))
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_items on public.invoice_items;
drop trigger if exists voucher_financial_integrity_items_write on public.invoice_items;
drop trigger if exists voucher_financial_integrity_items_delete on public.invoice_items;
create constraint trigger voucher_financial_integrity_items_write
after insert or update on public.invoice_items
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', new.voucher_id))
execute function public.validate_voucher_financial_integrity();
create constraint trigger voucher_financial_integrity_items_delete
after delete on public.invoice_items
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', old.voucher_id))
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_stock on public.stock_lines;
drop trigger if exists voucher_financial_integrity_stock_write on public.stock_lines;
drop trigger if exists voucher_financial_integrity_stock_delete on public.stock_lines;
create constraint trigger voucher_financial_integrity_stock_write
after insert or update on public.stock_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', new.voucher_id))
execute function public.validate_voucher_financial_integrity();
create constraint trigger voucher_financial_integrity_stock_delete
after delete on public.stock_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('financial', old.voucher_id))
execute function public.validate_voucher_financial_integrity();

create index if not exists vouchers_company_status_date_sequence_idx
  on public.vouchers (company_id, status, date_bs_key desc, seq desc, id desc);
create index if not exists vouchers_company_type_date_sequence_idx
  on public.vouchers (company_id, type, date_bs_key desc, seq desc, id desc);
create index if not exists voucher_lines_voucher_account_idx
  on public.voucher_lines (voucher_id, account_id);
create index if not exists invoice_items_voucher_item_idx
  on public.invoice_items (voucher_id, item_id);
create index if not exists invoice_items_source_voucher_idx
  on public.invoice_items (source_invoice_item_id, voucher_id)
  where source_invoice_item_id is not null;
create index if not exists stock_lines_voucher_item_direction_idx
  on public.stock_lines (voucher_id, item_id, direction);
create index if not exists settlements_company_vouchers_idx
  on public.voucher_settlements (company_id, invoice_voucher_id, settlement_voucher_id);
create index if not exists company_members_user_status_company_idx
  on public.company_members (user_id, status, company_id);
create index if not exists cheques_linked_voucher_idx
  on public.cheques (linked_voucher_id)
  where linked_voucher_id is not null;
-- END SYNCED MIGRATION: 202608170002_voucher_validation_once.sql

-- BEGIN SYNCED MIGRATION: 202608170003_atomic_party_creation.sql
-- Party and its ledger are one business record. Create both in one database
-- transaction so the browser no longer needs two sequential HTTP requests and
-- cannot leave an orphan when the second request fails.
create or replace function public.create_party_with_ledger_atomic(
  p_company_id uuid,
  p_account_id text,
  p_name text,
  p_party_type text,
  p_category_id uuid,
  p_opening_balance numeric default 0,
  p_phone text default null,
  p_pan_vat text default null,
  p_address text default null,
  p_credit_days integer default 0
)
returns public.parties
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_account_type text;
  category_record public.account_categories%rowtype;
  result public.parties%rowtype;
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_party_type not in ('customer', 'supplier') then
    raise exception 'Party type must be customer or supplier';
  end if;
  if p_account_id is null or btrim(p_account_id) = '' then
    raise exception 'Party ledger identifier is required';
  end if;
  expected_account_type := case when p_party_type = 'customer' then 'Asset' else 'Liability' end;
  select * into category_record from public.account_categories
  where id = p_category_id and company_id = p_company_id
    and account_type = expected_account_type and not is_archived;
  if not found then raise exception 'Select an active party ledger category'; end if;

  insert into public.accounts(
    id, company_id, name, type, "group", category_id, is_system,
    is_party, is_archived, opening_balance, address, contact_no, pan_no,
    credit_days, bank_account_no, bank_branch
  ) values (
    p_account_id, p_company_id, btrim(p_name), expected_account_type,
    category_record.name, category_record.id, false, true, false,
    coalesce(p_opening_balance, 0), nullif(btrim(p_address), ''),
    nullif(btrim(p_phone), ''), nullif(btrim(p_pan_vat), ''),
    coalesce(p_credit_days, 0), null, null
  );

  insert into public.parties(
    company_id, name, type, phone, pan_vat, address, default_credit_days,
    account_id, is_archived
  ) values (
    p_company_id, btrim(p_name), p_party_type, nullif(btrim(p_phone), ''),
    nullif(btrim(p_pan_vat), ''), nullif(btrim(p_address), ''),
    coalesce(p_credit_days, 0), p_account_id, false
  ) returning * into result;
  return result;
end;
$$;

revoke all on function public.create_party_with_ledger_atomic(uuid,text,text,text,uuid,numeric,text,text,text,integer) from public, anon;
grant execute on function public.create_party_with_ledger_atomic(uuid,text,text,text,uuid,numeric,text,text,text,integer) to authenticated;

notify pgrst, 'reload schema';
-- END SYNCED MIGRATION: 202608170003_atomic_party_creation.sql

-- BEGIN SYNCED MIGRATION: 202608170004_versioned_company_repair.sql
-- Normal company loading must be read-only. Repairs are versioned so a schema
-- repair runs once only when an administrator deliberately bumps the version.
alter table public.companies
  add column if not exists bootstrap_version integer not null default 1
  check (bootstrap_version between 0 and 1000000);

notify pgrst, 'reload schema';
-- END SYNCED MIGRATION: 202608170004_versioned_company_repair.sql

-- BEGIN SYNCED MIGRATION: 202608170005_voucher_write_latency_optimization.sql
-- Reduce ordinary voucher latency without weakening direct-write integrity.
-- Apply after 202608170002_voucher_validation_once.sql.
begin;

-- The legacy balance trigger ran once for every changed ledger row at commit.
-- Schedule the same validator once per voucher/transaction instead.
drop trigger if exists voucher_lines_balance_guard on public.voucher_lines;
drop trigger if exists voucher_lines_balance_guard_write on public.voucher_lines;
drop trigger if exists voucher_lines_balance_guard_delete on public.voucher_lines;
create constraint trigger voucher_lines_balance_guard_write
after insert or update on public.voucher_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('balance', new.voucher_id))
execute function public.validate_voucher_balance();
create constraint trigger voucher_lines_balance_guard_delete
after delete on public.voucher_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('balance', old.voucher_id))
execute function public.validate_voucher_balance();

-- seq is an internal stable ordering key. A global sequence removes the need
-- to calculate max(seq) while holding a company-wide transaction lock.
create sequence if not exists public.voucher_global_seq as bigint;
grant usage, select on sequence public.voucher_global_seq to authenticated;
select setval(
  'public.voucher_global_seq',
  greatest(coalesce((select max(seq)::bigint from public.vouchers), 0), 1),
  exists(select 1 from public.vouchers)
);

create table if not exists public.voucher_number_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  voucher_type text not null,
  numbering_period text not null,
  last_number bigint not null check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, voucher_type, numbering_period)
);
alter table public.voucher_number_counters enable row level security;
revoke all on public.voucher_number_counters from public, anon, authenticated;

create or replace function public.next_voucher_number(
  target_company_id uuid,
  target_voucher_type text,
  target_numbering_period text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare result bigint;
begin
  if auth.uid() is null or not public.is_company_member(target_company_id) then
    raise exception 'Voucher company access denied' using errcode = '42501';
  end if;
  insert into public.voucher_number_counters(company_id, voucher_type, numbering_period, last_number)
  values (
    target_company_id,
    target_voucher_type,
    target_numbering_period,
    coalesce((
      select max((substring(voucher.invoice_no from '([0-9]+)$'))::bigint)
      from public.vouchers voucher
      where voucher.company_id = target_company_id
        and voucher.type = target_voucher_type
        and (target_numbering_period = 'all' or voucher.numbering_period = target_numbering_period)
        and substring(voucher.invoice_no from '([0-9]+)$') is not null
    ), 0) + 1
  )
  on conflict (company_id, voucher_type, numbering_period)
  do update set last_number = public.voucher_number_counters.last_number + 1, updated_at = now()
  returning last_number into result;
  return result;
end;
$$;
revoke all on function public.next_voucher_number(uuid,text,text) from public, anon;
grant execute on function public.next_voucher_number(uuid,text,text) to authenticated;

create or replace function public.sync_voucher_number_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare parsed_number bigint;
begin
  if new.invoice_no is null then return new; end if;
  parsed_number := nullif(substring(new.invoice_no from '([0-9]+)$'), '')::bigint;
  if parsed_number is null then return new; end if;
  insert into public.voucher_number_counters(company_id, voucher_type, numbering_period, last_number)
  values (new.company_id, new.type, coalesce(new.numbering_period, 'all'), parsed_number)
  on conflict (company_id, voucher_type, numbering_period)
  do update set last_number = greatest(public.voucher_number_counters.last_number, excluded.last_number), updated_at = now();
  insert into public.voucher_number_counters(company_id, voucher_type, numbering_period, last_number)
  values (new.company_id, new.type, 'all', parsed_number)
  on conflict (company_id, voucher_type, numbering_period)
  do update set last_number = greatest(public.voucher_number_counters.last_number, excluded.last_number), updated_at = now();
  return new;
end;
$$;
revoke all on function public.sync_voucher_number_counter() from public, anon, authenticated;
drop trigger if exists vouchers_sync_number_counter on public.vouchers;
create trigger vouchers_sync_number_counter
after insert or update of invoice_no, type, numbering_period on public.vouchers
for each row execute function public.sync_voucher_number_counter();

-- Patch the deployed atomic writer in place so later domain additions to the
-- function are retained. Voucher numbering is serialized only within its
-- company/type/period; stock is serialized only for affected items.
do $migration$
declare
  function_sql text;
  patched_sql text;
  old_lock text := $old$
  posting_stage := 'company_write_lock';
  perform pg_advisory_xact_lock(hashtextextended(target_company::text, 0));
$old$;
  new_lock text := $new$
  posting_stage := 'scoped_write_locks';
  if p_voucher_id is null then
    perform pg_advisory_xact_lock(hashtextextended(
      'voucher-number:' || target_company::text || ':' || coalesce(target_type, '') || ':' ||
      case when p_reset_numbering then coalesce(nullif(p_voucher->>'numbering_period', ''), 'all') else 'all' end, 0
    ));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'voucher-stock:' || target_company::text || ':' || affected.item_id::text, 0
  ))
  from (
      select distinct line.item_id
      from jsonb_to_recordset(coalesce(p_stock_lines, '[]'::jsonb)) as line(item_id uuid)
      where line.item_id is not null
      union
      select distinct stock_line.item_id
      from public.stock_lines stock_line
      where p_voucher_id is not null and stock_line.voucher_id = p_voucher_id
  ) affected
  order by affected.item_id;
$new$;
  old_number_scan text := $old$
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
$old$;
  new_number_call text := $new$
    select public.next_voucher_number(
      target_company, target_type,
      case when p_reset_numbering then coalesce(nullif(p_voucher->>'numbering_period', ''), 'all') else 'all' end
    ) into highest_number;
$new$;
begin
  select pg_get_functiondef(
    'public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure
  ) into function_sql;
  if function_sql is null then
    raise exception 'save_voucher_atomic is missing';
  end if;

  patched_sql := function_sql;
  if position(old_lock in patched_sql) > 0 then
    patched_sql := replace(patched_sql, old_lock, new_lock);
  elsif position('voucher-number:' in patched_sql) = 0 then
    -- Deployed functions may have been reformatted by an earlier dynamic
    -- migration. Remove the known statements independently, then insert the
    -- scoped block at the unique create-voucher branch.
    patched_sql := replace(patched_sql, 'perform pg_advisory_xact_lock(hashtextextended(target_company::text, 0));', '');
    patched_sql := replace(patched_sql, 'posting_stage := ''company_write_lock'';', '');
    patched_sql := replace(
      patched_sql,
      '  if p_voucher_id is null then' || E'\n    if target_type is null or p_invoice_prefix is null then',
      new_lock || E'\n\n  if p_voucher_id is null then\n    if target_type is null or p_invoice_prefix is null then'
    );
    if position('voucher-number:' in patched_sql) = 0 then
      raise notice 'Scoped lock insertion was skipped because the deployed atomic writer has an unknown structure';
    end if;
  end if;
  patched_sql := replace(
    patched_sql,
    'select coalesce(max(voucher.seq), 0) + 1 into next_seq' || E'\n    from public.vouchers voucher where voucher.company_id = target_company;',
    'select nextval(''public.voucher_global_seq'')::integer into next_seq;'
  );
  if position('nextval(''public.voucher_global_seq'')' in patched_sql) = 0 then
    raise notice 'Global sequence replacement was skipped because the deployed atomic writer has an unknown structure';
  end if;
  if position(old_number_scan in patched_sql) > 0 then
    patched_sql := replace(patched_sql, old_number_scan, new_number_call);
  elsif position('public.next_voucher_number(' in patched_sql) = 0 then
    raise notice 'Voucher counter replacement was skipped because the deployed atomic writer has an unknown structure';
  end if;
  execute patched_sql;
end;
$migration$;

-- Cover the affected-item stock scan and common numbering lookup without
-- adding overlapping indexes for already-covered child lookups.
create index if not exists stock_lines_item_condition_voucher_cover_idx
  on public.stock_lines (item_id, stock_condition, voucher_id)
  include (direction, qty);
create index if not exists vouchers_numbering_lookup_idx
  on public.vouchers (company_id, type, numbering_period, invoice_no)
  where invoice_no is not null;

analyze public.vouchers;
analyze public.voucher_lines;
analyze public.stock_lines;

commit;
notify pgrst, 'reload schema';

-- END SYNCED MIGRATION: 202608170005_voucher_write_latency_optimization.sql

-- BEGIN SYNCED MIGRATION: 202608170006_voucher_server_timing.sql
-- Wrap the existing atomic writer to return privacy-safe PostgreSQL execution
-- time without rewriting its deployed function body.
begin;

create or replace function public.save_voucher_with_performance_timing_atomic(
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
  request_started_at timestamptz := clock_timestamp();
begin
  result := public.save_voucher_with_document_metadata_atomic(
    p_voucher, p_lines, p_stock_lines, p_invoice_items, p_settlements,
    p_voucher_id, p_invoice_prefix, p_reset_numbering,
    p_period_start_key, p_next_period_start_key,
    p_audit_event_type, p_audit_metadata,
    p_manual_invoice_no, p_supplier_invoice_no
  );
  return result || jsonb_build_object(
    '_performance', jsonb_build_object(
      'postgres_ms', round((extract(epoch from (clock_timestamp() - request_started_at)) * 1000)::numeric, 2)
    )
  );
end;
$$;

revoke all on function public.save_voucher_with_performance_timing_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text) from public, anon;
grant execute on function public.save_voucher_with_performance_timing_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text) to authenticated;

commit;
notify pgrst, 'reload schema';

-- END SYNCED MIGRATION: 202608170006_voucher_server_timing.sql

-- END SYNCED DB FILE: supabase-performance-optimization-migration.sql

-- BEGIN SYNCED MIGRATION: 202608180001_nepal_voucher_date_boundary.sql
-- Use Nepal's local calendar date for the voucher future-date safeguard.
begin;

create or replace function public.validate_voucher_financial_year()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  company_start date;
  company_configured boolean;
  nepal_today date := (clock_timestamp() at time zone 'Asia/Kathmandu')::date;
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
  if coalesce(new.date_ad, new.date) > nepal_today then
    raise exception 'Voucher date cannot be in a future financial period';
  end if;

  return new;
end;
$$;

commit;
notify pgrst, 'reload schema';
-- END SYNCED MIGRATION: 202608180001_nepal_voucher_date_boundary.sql

-- BEGIN SYNCED MIGRATION: 202608180002_sales_payment_qr.sql
-- Optional company payment QR images for printed Sales vouchers.
begin;

alter table public.companies
  add column if not exists payment_qr_url text;

alter table public.companies
  drop constraint if exists companies_payment_qr_url_valid;
alter table public.companies
  add constraint companies_payment_qr_url_valid
  check (
    payment_qr_url is null
    or btrim(payment_qr_url) = ''
    or (length(payment_qr_url) <= 2048 and payment_qr_url ~ '^https://')
  );

comment on column public.companies.payment_qr_url is
  'Optional HTTPS URL for the payment QR image printed on Sales vouchers.';

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-assets',
  'company-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_assets_public_read on storage.objects;
create policy company_assets_public_read
on storage.objects for select
using (bucket_id = 'company-assets');

drop policy if exists company_assets_admin_insert on storage.objects;
create policy company_assets_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-assets'
  and exists (
    select 1 from public.companies company
    where company.id::text = (storage.foldername(name))[1]
      and public.is_company_admin(company.id)
  )
);

drop policy if exists company_assets_admin_update on storage.objects;
create policy company_assets_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'company-assets'
  and exists (
    select 1 from public.companies company
    where company.id::text = (storage.foldername(name))[1]
      and public.is_company_admin(company.id)
  )
)
with check (
  bucket_id = 'company-assets'
  and exists (
    select 1 from public.companies company
    where company.id::text = (storage.foldername(name))[1]
      and public.is_company_admin(company.id)
  )
);

drop policy if exists company_assets_admin_delete on storage.objects;
create policy company_assets_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'company-assets'
  and exists (
    select 1 from public.companies company
    where company.id::text = (storage.foldername(name))[1]
      and public.is_company_admin(company.id)
  )
);

commit;
notify pgrst, 'reload schema';
-- END SYNCED MIGRATION: 202608180002_sales_payment_qr.sql

-- BEGIN SYNCED MIGRATION: 202608180003_fix_company_asset_authorization.sql
-- Make company asset authorization reliable for both owners and active admins.
begin;

create or replace function public.can_manage_company_asset(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      public.is_developer_admin()
      or exists (
        select 1
        from public.companies company
        where company.id::text = split_part(object_name, '/', 1)
          and (
            company.user_id = auth.uid()
            or exists (
              select 1
              from public.company_members member
              where member.company_id = company.id
                and member.user_id = auth.uid()
                and member.status = 'active'
                and member.role = 'Admin'
            )
          )
      )
    )
$$;

revoke all on function public.can_manage_company_asset(text) from public, anon;
grant execute on function public.can_manage_company_asset(text) to authenticated;

drop policy if exists company_assets_admin_insert on storage.objects;
create policy company_assets_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'company-assets' and public.can_manage_company_asset(name));

drop policy if exists company_assets_admin_update on storage.objects;
create policy company_assets_admin_update on storage.objects for update to authenticated
using (bucket_id = 'company-assets' and public.can_manage_company_asset(name))
with check (bucket_id = 'company-assets' and public.can_manage_company_asset(name));

drop policy if exists company_assets_admin_delete on storage.objects;
create policy company_assets_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'company-assets' and public.can_manage_company_asset(name));

commit;
notify pgrst, 'reload schema';
-- END SYNCED MIGRATION: 202608180003_fix_company_asset_authorization.sql



notify pgrst, 'reload schema';

select 'KhataERP complete staging bootstrap applied successfully' as result,
       current_timestamp as completed_at;


-- BEGIN SYNCED MIGRATION: 202608310001_slab_pricing.sql
begin;

create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  scope text not null check (scope in ('ITEM', 'CATEGORY')),
  item_id uuid references public.items(id) on delete restrict,
  category_id uuid references public.item_categories(id) on delete restrict,
  quantity_unit text not null,
  effective_from_bs text not null,
  effective_from_bs_key integer not null,
  effective_until_bs text,
  effective_until_bs_key integer,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_rules_target_check check (
    (scope = 'ITEM' and item_id is not null and category_id is null)
    or (scope = 'CATEGORY' and category_id is not null and item_id is null)
  ),
  constraint pricing_rules_dates_check check (
    effective_until_bs_key is null or effective_until_bs_key >= effective_from_bs_key
  ),
  constraint pricing_rules_name_check check (char_length(btrim(name)) between 1 and 150),
  constraint pricing_rules_unit_check check (char_length(btrim(quantity_unit)) between 1 and 20)
);

create table if not exists public.pricing_rule_slabs (
  id uuid primary key default gen_random_uuid(),
  pricing_rule_id uuid not null references public.pricing_rules(id) on delete cascade,
  min_quantity numeric(18,6) not null check (min_quantity > 0),
  rate numeric(18,6) not null check (rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pricing_rule_id, min_quantity)
);

create index if not exists pricing_rules_company_active_dates_idx
  on public.pricing_rules(company_id, is_active, effective_from_bs_key, effective_until_bs_key);
create index if not exists pricing_rules_item_idx
  on public.pricing_rules(company_id, item_id, is_active) where scope = 'ITEM';
create index if not exists pricing_rules_category_idx
  on public.pricing_rules(company_id, category_id, is_active) where scope = 'CATEGORY';
create index if not exists pricing_rule_slabs_threshold_idx
  on public.pricing_rule_slabs(pricing_rule_id, min_quantity desc);

alter table public.invoice_items add column if not exists pricing_rule_id uuid references public.pricing_rules(id) on delete restrict;
alter table public.invoice_items add column if not exists pricing_slab_id uuid references public.pricing_rule_slabs(id) on delete restrict;
alter table public.invoice_items add column if not exists calculated_rate numeric(18,6);
alter table public.invoice_items add column if not exists price_overridden boolean not null default false;
alter table public.invoice_items add column if not exists pricing_snapshot jsonb;

create or replace function public.validate_pricing_rule_record()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.quantity_unit := btrim(new.quantity_unit);
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.created_by is null then new.created_by := auth.uid(); end if;

  if new.effective_from_bs !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or new.effective_from_bs_key <> replace(new.effective_from_bs, '-', '')::integer
    or (new.effective_until_bs is null) <> (new.effective_until_bs_key is null)
    or (new.effective_until_bs is not null and (
      new.effective_until_bs !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or new.effective_until_bs_key <> replace(new.effective_until_bs, '-', '')::integer
    )) then
    raise exception 'Pricing rule effective dates are invalid';
  end if;

  if new.scope = 'ITEM' then
    if not exists (
      select 1 from public.items item
      where item.id = new.item_id and item.company_id = new.company_id and not coalesce(item.is_service, false)
    ) then raise exception 'Pricing rule item must be a stock item belonging to the company'; end if;
    if not exists (select 1 from public.items item where item.id = new.item_id and lower(btrim(new.quantity_unit)) in (lower(btrim(item.unit)), lower(btrim(coalesce(item.alternate_unit, ''))))) then
      raise exception 'Pricing calculation unit is not available on the selected item';
    end if;
  elsif not exists (
    select 1 from public.item_categories category
    where category.id = new.category_id and category.company_id = new.company_id
  ) then raise exception 'Pricing rule category must belong to the company';
  elsif not exists (
    with recursive descendants as (
      select category.id from public.item_categories category where category.id = new.category_id
      union all select child.id from public.item_categories child join descendants parent on child.parent_category_id = parent.id
    )
    select 1 from public.items item join descendants category on category.id = item.category_id
    where item.company_id = new.company_id and not coalesce(item.is_service, false)
      and lower(btrim(new.quantity_unit)) in (lower(btrim(item.unit)), lower(btrim(coalesce(item.alternate_unit, ''))))
  ) then raise exception 'No stock items in this category support the selected calculation unit';
  end if;

  if new.is_active and exists (
    select 1 from public.pricing_rules other
    where other.id <> new.id
      and other.company_id = new.company_id
      and other.scope = new.scope
      and other.item_id is not distinct from new.item_id
      and other.category_id is not distinct from new.category_id
      and other.priority = new.priority
      and other.is_active
      and other.effective_from_bs_key <= coalesce(new.effective_until_bs_key, 99999999)
      and new.effective_from_bs_key <= coalesce(other.effective_until_bs_key, 99999999)
  ) then raise exception 'An active pricing rule with the same target, priority, and overlapping period already exists'; end if;
  return new;
end;
$$;

drop trigger if exists pricing_rule_record_guard on public.pricing_rules;
create trigger pricing_rule_record_guard before insert or update on public.pricing_rules
for each row execute function public.validate_pricing_rule_record();

create or replace function public.validate_invoice_item_pricing_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  voucher_company uuid;
  voucher_type text;
  selected_rule public.pricing_rules%rowtype;
  selected_slab public.pricing_rule_slabs%rowtype;
begin
  select voucher.company_id, voucher.type into voucher_company, voucher_type
  from public.vouchers voucher where voucher.id = new.voucher_id;
  if new.pricing_rule_id is null then
    if new.pricing_slab_id is not null or new.calculated_rate is not null or new.pricing_snapshot is not null then
      raise exception 'Pricing metadata requires a pricing rule';
    end if;
  else
    if voucher_type <> 'Sales' then raise exception 'Slab pricing metadata is supported only on Sales invoices'; end if;
    select * into selected_rule from public.pricing_rules rule where rule.id = new.pricing_rule_id and rule.company_id = voucher_company;
    if not found then raise exception 'Pricing rule must belong to the voucher company'; end if;
    select * into selected_slab from public.pricing_rule_slabs slab where slab.id = new.pricing_slab_id and slab.pricing_rule_id = new.pricing_rule_id;
    if not found then raise exception 'Pricing slab does not belong to the selected pricing rule'; end if;
    if new.pricing_slab_id is null or new.calculated_rate is null or new.pricing_snapshot is null
      or new.pricing_snapshot->>'rule_id' is distinct from new.pricing_rule_id::text
      or new.pricing_snapshot->>'slab_id' is distinct from new.pricing_slab_id::text
      or coalesce((new.pricing_snapshot->>'price_overridden')::boolean, false) is distinct from new.price_overridden
      or new.pricing_snapshot->>'rule_name' is distinct from selected_rule.name
      or new.pricing_snapshot->>'scope' is distinct from selected_rule.scope
      or lower(btrim(new.pricing_snapshot->>'quantity_unit')) is distinct from lower(btrim(selected_rule.quantity_unit))
      or abs(coalesce((new.pricing_snapshot->>'min_quantity')::numeric, -1) - selected_slab.min_quantity) > 0.000001
      or abs(coalesce((new.pricing_snapshot->>'rule_rate')::numeric, -1) - selected_slab.rate) > 0.000001
      or abs(coalesce((new.pricing_snapshot->>'calculated_entry_rate')::numeric, -1) - new.calculated_rate) > 0.000001 then
      raise exception 'Sales pricing snapshot is incomplete or inconsistent';
    end if;
    if not new.price_overridden and abs(new.rate - new.calculated_rate) > 0.000001 then
      raise exception 'Sales rate does not match the selected pricing slab';
    end if;
  end if;
  if new.calculated_rate is not null and new.calculated_rate < 0 then
    raise exception 'Calculated selling rate cannot be negative';
  end if;
  if new.price_overridden and not public.has_company_permission(voucher_company, 'pricing.override') then
    raise exception 'Manual selling-rate override permission is required' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_item_pricing_snapshot_guard on public.invoice_items;
create trigger invoice_item_pricing_snapshot_guard before insert or update of pricing_rule_id, pricing_slab_id, calculated_rate, price_overridden, pricing_snapshot
on public.invoice_items for each row execute function public.validate_invoice_item_pricing_snapshot();

alter table public.pricing_rules enable row level security;
alter table public.pricing_rule_slabs enable row level security;

drop policy if exists pricing_rules_read on public.pricing_rules;
create policy pricing_rules_read on public.pricing_rules for select to authenticated
using (public.is_company_member(company_id) or public.is_developer_admin());
drop policy if exists pricing_rules_manage on public.pricing_rules;
create policy pricing_rules_manage on public.pricing_rules for all to authenticated
using (public.has_company_permission(company_id, 'pricing.manage'))
with check (public.has_company_permission(company_id, 'pricing.manage'));

drop policy if exists pricing_rule_slabs_read on public.pricing_rule_slabs;
create policy pricing_rule_slabs_read on public.pricing_rule_slabs for select to authenticated
using (exists (
  select 1 from public.pricing_rules rule
  where rule.id = pricing_rule_id
    and (public.is_company_member(rule.company_id) or public.is_developer_admin())
));
drop policy if exists pricing_rule_slabs_manage on public.pricing_rule_slabs;
create policy pricing_rule_slabs_manage on public.pricing_rule_slabs for all to authenticated
using (exists (
  select 1 from public.pricing_rules rule
  where rule.id = pricing_rule_id and public.has_company_permission(rule.company_id, 'pricing.manage')
))
with check (exists (
  select 1 from public.pricing_rules rule
  where rule.id = pricing_rule_id and public.has_company_permission(rule.company_id, 'pricing.manage')
));

drop trigger if exists tenant_write_access_guard on public.pricing_rules;
create trigger tenant_write_access_guard before insert or update or delete on public.pricing_rules
for each row execute function public.enforce_tenant_write_access('direct');
drop trigger if exists tenant_write_access_guard on public.pricing_rule_slabs;
create or replace function public.enforce_pricing_slab_write_access()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_rule uuid; target_company uuid; company_row public.companies%rowtype;
begin
  if auth.uid() is null or public.is_developer_admin() then return case when tg_op = 'DELETE' then old else new end; end if;
  target_rule := case when tg_op = 'DELETE' then old.pricing_rule_id else new.pricing_rule_id end;
  select rule.company_id into target_company from public.pricing_rules rule where rule.id = target_rule;
  if target_company is null then raise exception 'Pricing rule not found' using errcode = 'P0002'; end if;
  select * into company_row from public.companies where id = target_company;
  if not public.has_company_permission(target_company, 'pricing.manage') then
    raise exception 'Pricing management access denied' using errcode = '42501';
  end if;
  if company_row.suspended or company_row.plan_status = 'expired'
     or (company_row.plan_status in ('trial','paid') and company_row.plan_expires_at is not null and company_row.plan_expires_at <= clock_timestamp()) then
    raise exception 'Company plan expired. This company is read-only until renewed.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger tenant_write_access_guard before insert or update or delete on public.pricing_rule_slabs
for each row execute function public.enforce_pricing_slab_write_access();

create or replace function public.save_pricing_rule_atomic(p_rule jsonb, p_slabs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid := nullif(p_rule->>'id', '')::uuid;
  target_company uuid := (p_rule->>'company_id')::uuid;
  saved public.pricing_rules%rowtype;
  previous jsonb := '{}'::jsonb;
  slab jsonb;
begin
  if not public.has_company_permission(target_company, 'pricing.manage') then
    raise exception 'Pricing management permission is required' using errcode = '42501';
  end if;
  perform set_config('khataerp.initializing_company', target_company::text, true);
  if jsonb_typeof(p_slabs) <> 'array' or jsonb_array_length(p_slabs) = 0 then
    raise exception 'Add at least one pricing slab';
  end if;
  if target_id is not null then
    select rule.* into saved from public.pricing_rules rule
    where rule.id = target_id and rule.company_id = target_company for update;
    if not found then raise exception 'Pricing rule not found'; end if;
    previous := to_jsonb(saved);
  end if;

  insert into public.pricing_rules(
    id, company_id, name, scope, item_id, category_id, quantity_unit,
    effective_from_bs, effective_from_bs_key, effective_until_bs, effective_until_bs_key,
    priority, is_active, created_by, updated_by
  ) values (
    coalesce(target_id, gen_random_uuid()), target_company, p_rule->>'name', p_rule->>'scope',
    nullif(p_rule->>'item_id', '')::uuid, nullif(p_rule->>'category_id', '')::uuid,
    p_rule->>'quantity_unit', p_rule->>'effective_from_bs', (p_rule->>'effective_from_bs_key')::integer,
    nullif(p_rule->>'effective_until_bs', ''), nullif(p_rule->>'effective_until_bs_key', '')::integer,
    coalesce((p_rule->>'priority')::integer, 0), coalesce((p_rule->>'is_active')::boolean, true), auth.uid(), auth.uid()
  )
  on conflict (id) do update set
    name = excluded.name, scope = excluded.scope, item_id = excluded.item_id,
    category_id = excluded.category_id, quantity_unit = excluded.quantity_unit,
    effective_from_bs = excluded.effective_from_bs, effective_from_bs_key = excluded.effective_from_bs_key,
    effective_until_bs = excluded.effective_until_bs, effective_until_bs_key = excluded.effective_until_bs_key,
    priority = excluded.priority, is_active = excluded.is_active, updated_by = auth.uid()
  returning * into saved;

  delete from public.pricing_rule_slabs where pricing_rule_id = saved.id;
  for slab in select value from jsonb_array_elements(p_slabs) loop
    insert into public.pricing_rule_slabs(pricing_rule_id, min_quantity, rate)
    values (saved.id, (slab->>'min_quantity')::numeric, (slab->>'rate')::numeric);
  end loop;

  insert into public.master_change_logs(company_id, user_id, record_type, record_id, action, old_values, new_values)
  values (target_company, auth.uid(), 'pricing_rule', saved.id::text,
    case when target_id is null then 'create' else 'update' end, previous,
    to_jsonb(saved) || jsonb_build_object('slabs', p_slabs));

  return to_jsonb(saved) || jsonb_build_object('slabs', (
    select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity), '[]'::jsonb)
    from public.pricing_rule_slabs entry where entry.pricing_rule_id = saved.id
  ));
end;
$$;

create or replace function public.set_pricing_rule_active(p_rule_id uuid, p_is_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.pricing_rules%rowtype; previous jsonb;
begin
  select to_jsonb(rule) into previous from public.pricing_rules rule where rule.id = p_rule_id;
  if previous is null then raise exception 'Pricing rule not found'; end if;
  if not public.has_company_permission((previous->>'company_id')::uuid, 'pricing.manage') then
    raise exception 'Pricing management permission is required' using errcode = '42501';
  end if;
  perform set_config('khataerp.initializing_company', previous->>'company_id', true);
  update public.pricing_rules set is_active = p_is_active, updated_by = auth.uid(), updated_at = now()
  where id = p_rule_id returning * into saved;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(saved.company_id,auth.uid(),'pricing_rule',saved.id::text,case when p_is_active then 'activate' else 'deactivate' end,previous,to_jsonb(saved));
  return to_jsonb(saved) || jsonb_build_object('slabs', (select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

create or replace function public.duplicate_pricing_rule(p_rule_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare source public.pricing_rules%rowtype; saved public.pricing_rules%rowtype;
begin
  select * into source from public.pricing_rules where id = p_rule_id;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not public.has_company_permission(source.company_id, 'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company', source.company_id::text, true);
  insert into public.pricing_rules(company_id,name,scope,item_id,category_id,quantity_unit,effective_from_bs,effective_from_bs_key,effective_until_bs,effective_until_bs_key,priority,is_active,created_by,updated_by)
  values(source.company_id,left(source.name || ' Copy',150),source.scope,source.item_id,source.category_id,source.quantity_unit,source.effective_from_bs,source.effective_from_bs_key,source.effective_until_bs,source.effective_until_bs_key,source.priority,false,auth.uid(),auth.uid()) returning * into saved;
  insert into public.pricing_rule_slabs(pricing_rule_id,min_quantity,rate)
  select saved.id,min_quantity,rate from public.pricing_rule_slabs where pricing_rule_id=source.id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(saved.company_id,auth.uid(),'pricing_rule',saved.id::text,'duplicate',to_jsonb(source),to_jsonb(saved));
  return to_jsonb(saved) || jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

create or replace function public.delete_pricing_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare source public.pricing_rules%rowtype;
begin
  select * into source from public.pricing_rules where id=p_rule_id for update;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not public.has_company_permission(source.company_id,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company', source.company_id::text, true);
  if exists(select 1 from public.invoice_items where pricing_rule_id=p_rule_id) then raise exception 'This pricing rule is used by Sales invoices. Deactivate it instead.'; end if;
  delete from public.pricing_rules where id=p_rule_id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(source.company_id,auth.uid(),'pricing_rule',source.id::text,'delete',to_jsonb(source),'{}'::jsonb);
end; $$;

create or replace function public.validate_voucher_pricing_integrity()
returns trigger language plpgsql set search_path = public as $$
declare
  target_voucher uuid := coalesce(new.voucher_id, old.voucher_id);
  priced record;
  qualifying numeric;
  expected_slab uuid;
  expected_rate numeric;
  rule_factor numeric;
begin
  if not exists (select 1 from public.vouchers voucher where voucher.id = target_voucher and voucher.type = 'Sales') then
    return coalesce(new, old);
  end if;
  for priced in
    select line.*, rule.scope, rule.quantity_unit, slab.rate as slab_rate, item.unit as main_unit,
           item.alternate_unit, item.alternate_conversion
    from public.invoice_items line
    join public.pricing_rules rule on rule.id = line.pricing_rule_id
    join public.pricing_rule_slabs slab on slab.id = line.pricing_slab_id
    join public.items item on item.id = line.item_id
    where line.voucher_id = target_voucher and line.pricing_rule_id is not null
  loop
    qualifying := coalesce((priced.pricing_snapshot->>'qualifying_quantity')::numeric, -1);
    if qualifying < 0 or exists (
      select 1 from public.invoice_items candidate
      where candidate.voucher_id = target_voucher
        and candidate.pricing_rule_id = priced.pricing_rule_id
        and abs(coalesce((candidate.pricing_snapshot->>'qualifying_quantity')::numeric, -1) - qualifying) > 0.000001
    ) then raise exception 'Sales pricing qualification snapshot is inconsistent across invoice lines'; end if;

    select slab.id into expected_slab from public.pricing_rule_slabs slab
    where slab.pricing_rule_id = priced.pricing_rule_id and slab.min_quantity <= qualifying
    order by slab.min_quantity desc, slab.id limit 1;
    if expected_slab is distinct from priced.pricing_slab_id then
      raise exception 'Sales pricing slab does not match its saved qualifying quantity';
    end if;

    rule_factor := case
      when lower(btrim(priced.quantity_unit)) = lower(btrim(priced.main_unit)) then 1
      when lower(btrim(priced.quantity_unit)) = lower(btrim(coalesce(priced.alternate_unit, ''))) then priced.alternate_conversion
      else null end;
    expected_rate := round(priced.slab_rate * rule_factor / coalesce(nullif(priced.conversion_factor, 0), 1), 6);
    if expected_rate is null or abs(expected_rate - priced.calculated_rate) > 0.000001 then
      raise exception 'Sales calculated rate does not match the pricing slab unit conversion';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

revoke all on function public.validate_voucher_pricing_integrity() from public;

drop trigger if exists voucher_pricing_integrity_write on public.invoice_items;
drop trigger if exists voucher_pricing_integrity_delete on public.invoice_items;
create constraint trigger voucher_pricing_integrity_write after insert or update on public.invoice_items
deferrable initially deferred for each row
when (public.schedule_validation_once('pricing', new.voucher_id))
execute function public.validate_voucher_pricing_integrity();
create constraint trigger voucher_pricing_integrity_delete after delete on public.invoice_items
deferrable initially deferred for each row
when (public.schedule_validation_once('pricing', old.voucher_id))
execute function public.validate_voucher_pricing_integrity();


-- Extend the deployed atomic writer without replacing its evolving business
-- logic. The existing invoice_items insert and normalized response retain all
-- of their current fields and gain the immutable pricing snapshot fields.
do $extend_atomic_writer$
declare function_sql text;
begin
  select pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure) into function_sql;
  function_sql := replace(function_sql,
    'vat_amount, cost_rate' || E'\n  )',
    'vat_amount, cost_rate, pricing_rule_id, pricing_slab_id, calculated_rate, price_overridden, pricing_snapshot' || E'\n  )');
  function_sql := replace(function_sql,
    'item.base_qty, item.discount_amount, item.taxable_amount, item.vat_amount, item.cost_rate',
    'item.base_qty, item.discount_amount, item.taxable_amount, item.vat_amount, item.cost_rate, item.pricing_rule_id, item.pricing_slab_id, item.calculated_rate, coalesce(item.price_overridden, false), item.pricing_snapshot');
  function_sql := replace(function_sql,
    'vat_amount numeric, cost_rate numeric' || E'\n  );',
    'vat_amount numeric, cost_rate numeric, pricing_rule_id uuid, pricing_slab_id uuid, calculated_rate numeric, price_overridden boolean, pricing_snapshot jsonb' || E'\n  );');
  if position('item.pricing_rule_id' in function_sql) = 0 then raise exception 'Could not extend atomic voucher pricing fields'; end if;
  execute function_sql;

  select pg_get_functiondef('public.voucher_atomic_response(uuid)'::regprocedure) into function_sql;
  function_sql := replace(function_sql,
    $$'cost_rate', item.cost_rate$$,
    $$'cost_rate', item.cost_rate, 'pricing_rule_id', item.pricing_rule_id, 'pricing_slab_id', item.pricing_slab_id, 'calculated_rate', item.calculated_rate, 'price_overridden', item.price_overridden, 'pricing_snapshot', item.pricing_snapshot$$);
  if position('pricing_snapshot' in function_sql) = 0 then raise exception 'Could not extend voucher pricing response'; end if;
  execute function_sql;
end;
$extend_atomic_writer$;

do $extend_backup_exports$
declare function_sql text; signature regprocedure;
begin
  foreach signature in array array[
    'public.developer_export_company_backup(uuid)'::regprocedure,
    'public.system_export_company_backup(uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(signature) into function_sql;
    function_sql := replace(function_sql, $$'vouchers',$$, $$'pricingRules', coalesce((
      select jsonb_agg((to_jsonb(rule) - array['created_by','updated_by']) || jsonb_build_object(
        'slabs', coalesce((select jsonb_agg(to_jsonb(slab) order by slab.min_quantity) from public.pricing_rule_slabs slab where slab.pricing_rule_id = rule.id), '[]'::jsonb)
      ) order by rule.created_at, rule.id)
      from public.pricing_rules rule where rule.company_id = target_company
    ), '[]'::jsonb), 'vouchers',$$);
    if position('pricingRules' in function_sql) = 0 then raise exception 'Could not extend company backup export with pricing rules'; end if;
    execute function_sql;
  end loop;
end;
$extend_backup_exports$;

revoke all on function public.save_pricing_rule_atomic(jsonb,jsonb), public.set_pricing_rule_active(uuid,boolean), public.duplicate_pricing_rule(uuid), public.delete_pricing_rule(uuid) from public, anon;
grant execute on function public.save_pricing_rule_atomic(jsonb,jsonb), public.set_pricing_rule_active(uuid,boolean), public.duplicate_pricing_rule(uuid), public.delete_pricing_rule(uuid) to authenticated;
grant select on public.pricing_rules, public.pricing_rule_slabs to authenticated;

commit;
notify pgrst, 'reload schema';
-- END SYNCED MIGRATION: 202608310001_slab_pricing.sql
