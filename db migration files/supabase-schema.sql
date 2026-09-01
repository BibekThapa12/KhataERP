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

-- Optional company payment QR images for printed Sales vouchers.
begin;
alter table public.companies add column if not exists payment_qr_url text;
alter table public.companies drop constraint if exists companies_payment_qr_url_valid;
alter table public.companies add constraint companies_payment_qr_url_valid check (
  payment_qr_url is null or btrim(payment_qr_url) = ''
  or (length(payment_qr_url) <= 2048 and payment_qr_url ~ '^https://')
);
comment on column public.companies.payment_qr_url is 'Optional HTTPS URL for the payment QR image printed on Sales vouchers.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('company-assets','company-assets',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists company_assets_public_read on storage.objects;
create policy company_assets_public_read on storage.objects for select using (bucket_id='company-assets');
drop policy if exists company_assets_admin_insert on storage.objects;
create policy company_assets_admin_insert on storage.objects for insert to authenticated with check (
  bucket_id='company-assets' and exists(select 1 from public.companies company where company.id::text=(storage.foldername(name))[1] and public.is_company_admin(company.id))
);
drop policy if exists company_assets_admin_update on storage.objects;
create policy company_assets_admin_update on storage.objects for update to authenticated using (
  bucket_id='company-assets' and exists(select 1 from public.companies company where company.id::text=(storage.foldername(name))[1] and public.is_company_admin(company.id))
) with check (
  bucket_id='company-assets' and exists(select 1 from public.companies company where company.id::text=(storage.foldername(name))[1] and public.is_company_admin(company.id))
);
drop policy if exists company_assets_admin_delete on storage.objects;
create policy company_assets_admin_delete on storage.objects for delete to authenticated using (
  bucket_id='company-assets' and exists(select 1 from public.companies company where company.id::text=(storage.foldername(name))[1] and public.is_company_admin(company.id))
);
commit;

-- Reliable company asset authorization for both owners and active admins.
begin;
create or replace function public.can_manage_company_asset(object_name text)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and (
    public.is_developer_admin()
    or exists (
      select 1 from public.companies company
      where company.id::text=split_part(object_name,'/',1)
        and (
          company.user_id=auth.uid()
          or exists (
            select 1 from public.company_members member
            where member.company_id=company.id and member.user_id=auth.uid()
              and member.status='active' and member.role='Admin'
          )
        )
    )
  )
$$;
revoke all on function public.can_manage_company_asset(text) from public,anon;
grant execute on function public.can_manage_company_asset(text) to authenticated;
drop policy if exists company_assets_admin_insert on storage.objects;
create policy company_assets_admin_insert on storage.objects for insert to authenticated with check(bucket_id='company-assets' and public.can_manage_company_asset(name));
drop policy if exists company_assets_admin_update on storage.objects;
create policy company_assets_admin_update on storage.objects for update to authenticated using(bucket_id='company-assets' and public.can_manage_company_asset(name)) with check(bucket_id='company-assets' and public.can_manage_company_asset(name));
drop policy if exists company_assets_admin_delete on storage.objects;
create policy company_assets_admin_delete on storage.objects for delete to authenticated using(bucket_id='company-assets' and public.can_manage_company_asset(name));
commit;

-- After running this schema, set your environment variables:
--   VITE_SUPABASE_URL      = https://your-project-id.supabase.co
--   VITE_SUPABASE_ANON_KEY = your-anon-public-key
-- Both are in: Supabase dashboard â†’ Settings â†’ API


-- Slab pricing integration (202608310001)
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

-- Repair the JSON record declaration when pg_get_functiondef() formatting
-- prevented the slab-pricing migration's original replacement from matching.
do $repair_atomic_pricing_record$
declare
  function_sql text;
  old_record_fields text := 'vat_amount numeric, cost_rate numeric';
  new_record_fields text := 'vat_amount numeric, cost_rate numeric, pricing_rule_id uuid, pricing_slab_id uuid, calculated_rate numeric, price_overridden boolean, pricing_snapshot jsonb';
begin
  select pg_get_functiondef(
    'public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure
  ) into function_sql;
  if position('item.pricing_rule_id' in function_sql) = 0 then
    raise exception 'The atomic voucher writer does not contain the pricing INSERT fields';
  end if;
  if position('pricing_rule_id uuid' in function_sql) = 0 then
    function_sql := replace(function_sql, old_record_fields, new_record_fields);
  end if;
  if position('pricing_rule_id uuid' in function_sql) = 0 then
    raise exception 'Could not extend the atomic voucher pricing record declaration';
  end if;
  execute function_sql;
end;
$repair_atomic_pricing_record$;

notify pgrst, 'reload schema';
-- BEGIN SYNCED MIGRATION: 202609010001_versioned_slab_pricing.sql
begin;

alter table public.pricing_rules add column if not exists rule_family_id uuid;
alter table public.pricing_rules add column if not exists version_number integer;
alter table public.pricing_rules add column if not exists is_current boolean;
alter table public.pricing_rules add column if not exists supersedes_rule_id uuid;

update public.pricing_rules
set rule_family_id = coalesce(rule_family_id, id),
    version_number = coalesce(version_number, 1),
    is_current = coalesce(is_current, true)
where rule_family_id is null or version_number is null or is_current is null;

alter table public.pricing_rules alter column rule_family_id set not null;
alter table public.pricing_rules alter column rule_family_id set default gen_random_uuid();
alter table public.pricing_rules alter column version_number set not null;
alter table public.pricing_rules alter column version_number set default 1;
alter table public.pricing_rules alter column is_current set not null;
alter table public.pricing_rules alter column is_current set default true;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pricing_rules'::regclass and conname = 'pricing_rules_supersedes_rule_fkey') then
    alter table public.pricing_rules add constraint pricing_rules_supersedes_rule_fkey
      foreign key (supersedes_rule_id) references public.pricing_rules(id) on delete restrict deferrable initially deferred;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pricing_rules'::regclass and conname = 'pricing_rules_version_positive') then
    alter table public.pricing_rules add constraint pricing_rules_version_positive check (version_number > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pricing_rules'::regclass and conname = 'pricing_rules_not_self_superseding') then
    alter table public.pricing_rules add constraint pricing_rules_not_self_superseding check (supersedes_rule_id is null or supersedes_rule_id <> id);
  end if;
end $$;

create unique index if not exists pricing_rules_family_version_unique on public.pricing_rules(company_id, rule_family_id, version_number);
create unique index if not exists pricing_rules_one_current_per_family on public.pricing_rules(company_id, rule_family_id) where is_current;
create index if not exists pricing_rules_family_history_idx on public.pricing_rules(company_id, rule_family_id, version_number desc);

create or replace function public.validate_pricing_rule_record()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name); new.quantity_unit := btrim(new.quantity_unit); new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by); if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.effective_from_bs !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or new.effective_from_bs_key <> replace(new.effective_from_bs, '-', '')::integer
    or (new.effective_until_bs is null) <> (new.effective_until_bs_key is null)
    or (new.effective_until_bs is not null and (new.effective_until_bs !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or new.effective_until_bs_key <> replace(new.effective_until_bs, '-', '')::integer))
  then raise exception 'Pricing rule effective dates are invalid'; end if;
  if new.scope = 'ITEM' then
    if not exists (select 1 from public.items item where item.id=new.item_id and item.company_id=new.company_id and not coalesce(item.is_service,false)) then raise exception 'Pricing rule item must be a stock item belonging to the company'; end if;
    if not exists (select 1 from public.items item where item.id=new.item_id and lower(btrim(new.quantity_unit)) in (lower(btrim(item.unit)),lower(btrim(coalesce(item.alternate_unit,''))))) then raise exception 'Pricing calculation unit is not available on the selected item'; end if;
  elsif not exists (select 1 from public.item_categories category where category.id=new.category_id and category.company_id=new.company_id) then
    raise exception 'Pricing rule category must belong to the company';
  elsif not exists (
    with recursive descendants as (select category.id from public.item_categories category where category.id=new.category_id union all select child.id from public.item_categories child join descendants parent on child.parent_category_id=parent.id)
    select 1 from public.items item join descendants category on category.id=item.category_id where item.company_id=new.company_id and not coalesce(item.is_service,false) and lower(btrim(new.quantity_unit)) in (lower(btrim(item.unit)),lower(btrim(coalesce(item.alternate_unit,''))))
  ) then raise exception 'No stock items in this category support the selected calculation unit'; end if;
  if new.is_current and new.is_active and exists (
    select 1 from public.pricing_rules other where other.id<>new.id and other.company_id=new.company_id
      and other.is_current and other.scope=new.scope and other.item_id is not distinct from new.item_id
      and other.category_id is not distinct from new.category_id and other.priority=new.priority and other.is_active
      and other.effective_from_bs_key <= coalesce(new.effective_until_bs_key,99999999)
      and new.effective_from_bs_key <= coalesce(other.effective_until_bs_key,99999999)
  ) then raise exception 'An active pricing rule with the same target, priority, and overlapping period already exists'; end if;
  return new;
end; $$;

create or replace function public.save_pricing_rule_atomic(p_rule jsonb, p_slabs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_id uuid := nullif(p_rule->>'id','')::uuid; target_company uuid := (p_rule->>'company_id')::uuid;
  source public.pricing_rules%rowtype; saved public.pricing_rules%rowtype; previous jsonb := '{}'::jsonb;
  slab jsonb; next_id uuid := gen_random_uuid(); next_family uuid; next_version integer := 1;
begin
  if not public.has_company_permission(target_company,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company',target_company::text,true);
  if jsonb_typeof(p_slabs)<>'array' or jsonb_array_length(p_slabs)=0 then raise exception 'Add at least one pricing slab'; end if;
  if target_id is not null then
    select * into source from public.pricing_rules where id=target_id and company_id=target_company for update;
    if not found then raise exception 'Pricing rule not found'; end if;
    if not source.is_current then raise exception 'Only the current pricing rule version can be edited'; end if;
    previous := to_jsonb(source) || jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=source.id));
    next_family := source.rule_family_id; next_version := source.version_number+1;
    update public.pricing_rules set is_current=false,is_active=false,updated_by=auth.uid(),updated_at=now() where id=source.id;
  else next_family := next_id; end if;

  insert into public.pricing_rules(id,company_id,rule_family_id,version_number,is_current,supersedes_rule_id,name,scope,item_id,category_id,quantity_unit,effective_from_bs,effective_from_bs_key,effective_until_bs,effective_until_bs_key,priority,is_active,created_by,updated_by)
  values(next_id,target_company,next_family,next_version,true,case when target_id is null then null else source.id end,p_rule->>'name',p_rule->>'scope',nullif(p_rule->>'item_id','')::uuid,nullif(p_rule->>'category_id','')::uuid,p_rule->>'quantity_unit',p_rule->>'effective_from_bs',(p_rule->>'effective_from_bs_key')::integer,nullif(p_rule->>'effective_until_bs',''),nullif(p_rule->>'effective_until_bs_key','')::integer,coalesce((p_rule->>'priority')::integer,0),coalesce((p_rule->>'is_active')::boolean,true),auth.uid(),auth.uid()) returning * into saved;
  for slab in select value from jsonb_array_elements(p_slabs) loop
    insert into public.pricing_rule_slabs(pricing_rule_id,min_quantity,rate) values(saved.id,(slab->>'min_quantity')::numeric,(slab->>'rate')::numeric);
  end loop;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(target_company,auth.uid(),'pricing_rule',saved.id::text,case when target_id is null then 'create' else 'version' end,previous,to_jsonb(saved)||jsonb_build_object('slabs',p_slabs));
  return to_jsonb(saved)||jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

create or replace function public.set_pricing_rule_active(p_rule_id uuid,p_is_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.pricing_rules%rowtype; previous jsonb;
begin
  select to_jsonb(rule) into previous from public.pricing_rules rule where rule.id=p_rule_id;
  if previous is null then raise exception 'Pricing rule not found'; end if;
  if coalesce((previous->>'is_current')::boolean,false)=false then raise exception 'A superseded pricing rule cannot be activated or deactivated'; end if;
  if not public.has_company_permission((previous->>'company_id')::uuid,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company',previous->>'company_id',true);
  update public.pricing_rules set is_active=p_is_active,updated_by=auth.uid(),updated_at=now() where id=p_rule_id returning * into saved;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values) values(saved.company_id,auth.uid(),'pricing_rule',saved.id::text,case when p_is_active then 'activate' else 'deactivate' end,previous,to_jsonb(saved));
  return to_jsonb(saved)||jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

create or replace function public.duplicate_pricing_rule(p_rule_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare source public.pricing_rules%rowtype; saved public.pricing_rules%rowtype; next_id uuid:=gen_random_uuid();
begin
  select * into source from public.pricing_rules where id=p_rule_id;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not public.has_company_permission(source.company_id,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company',source.company_id::text,true);
  insert into public.pricing_rules(id,company_id,rule_family_id,version_number,is_current,name,scope,item_id,category_id,quantity_unit,effective_from_bs,effective_from_bs_key,effective_until_bs,effective_until_bs_key,priority,is_active,created_by,updated_by)
  values(next_id,source.company_id,next_id,1,true,left(source.name||' Copy',150),source.scope,source.item_id,source.category_id,source.quantity_unit,source.effective_from_bs,source.effective_from_bs_key,source.effective_until_bs,source.effective_until_bs_key,source.priority,false,auth.uid(),auth.uid()) returning * into saved;
  insert into public.pricing_rule_slabs(pricing_rule_id,min_quantity,rate) select saved.id,min_quantity,rate from public.pricing_rule_slabs where pricing_rule_id=source.id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values) values(saved.company_id,auth.uid(),'pricing_rule',saved.id::text,'duplicate',to_jsonb(source),to_jsonb(saved));
  return to_jsonb(saved)||jsonb_build_object('slabs',(select coalesce(jsonb_agg(to_jsonb(entry) order by entry.min_quantity),'[]'::jsonb) from public.pricing_rule_slabs entry where entry.pricing_rule_id=saved.id));
end; $$;

notify pgrst,'reload schema';

create or replace function public.delete_pricing_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare source public.pricing_rules%rowtype;
begin
  select * into source from public.pricing_rules where id=p_rule_id for update;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not source.is_current then raise exception 'Superseded pricing rule versions cannot be deleted'; end if;
  if not public.has_company_permission(source.company_id,'pricing.manage') then raise exception 'Pricing management permission is required' using errcode='42501'; end if;
  perform set_config('khataerp.initializing_company',source.company_id::text,true);
  if exists(select 1 from public.invoice_items where pricing_rule_id=p_rule_id)
     or exists(
       select 1 from public.vouchers voucher
       cross join lateral jsonb_array_elements(coalesce(voucher.draft_payload->'lines','[]'::jsonb)) line
       where voucher.company_id=source.company_id and voucher.status='Draft' and not voucher.cancelled
         and line->>'pricing_rule_id'=p_rule_id::text
     ) then raise exception 'This pricing rule is used by Sales invoices or drafts. Deactivate it instead.'; end if;
  delete from public.pricing_rules where id=p_rule_id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(source.company_id,auth.uid(),'pricing_rule',source.id::text,'delete',to_jsonb(source),'{}'::jsonb);
end; $$;

+-- Frozen draft snapshots retain their saved slab while new draft lines use the current version.
create or replace function public.validate_voucher_pricing_integrity()
returns trigger language plpgsql set search_path=public as $$
declare
  target_voucher uuid:=coalesce(new.voucher_id,old.voucher_id); priced record; qualifying numeric;
  expected_slab uuid; expected_rate numeric; rule_factor numeric;
begin
  if not exists(select 1 from public.vouchers voucher where voucher.id=target_voucher and voucher.type='Sales') then return coalesce(new,old); end if;
  for priced in
    select line.*,rule.scope,rule.quantity_unit,slab.rate as slab_rate,item.unit as main_unit,item.alternate_unit,item.alternate_conversion
    from public.invoice_items line join public.pricing_rules rule on rule.id=line.pricing_rule_id
    join public.pricing_rule_slabs slab on slab.id=line.pricing_slab_id join public.items item on item.id=line.item_id
    where line.voucher_id=target_voucher and line.pricing_rule_id is not null
  loop
    if coalesce((priced.pricing_snapshot->>'locked_from_draft')::boolean,false) then continue; end if;
    qualifying:=coalesce((priced.pricing_snapshot->>'qualifying_quantity')::numeric,-1);
    if qualifying<0 or exists(
      select 1 from public.invoice_items candidate where candidate.voucher_id=target_voucher
        and candidate.pricing_rule_id=priced.pricing_rule_id
        and not coalesce((candidate.pricing_snapshot->>'locked_from_draft')::boolean,false)
        and abs(coalesce((candidate.pricing_snapshot->>'qualifying_quantity')::numeric,-1)-qualifying)>0.000001
    ) then raise exception 'Sales pricing qualification snapshot is inconsistent across invoice lines'; end if;
    select slab.id into expected_slab from public.pricing_rule_slabs slab where slab.pricing_rule_id=priced.pricing_rule_id and slab.min_quantity<=qualifying order by slab.min_quantity desc,slab.id limit 1;
    if expected_slab is distinct from priced.pricing_slab_id then raise exception 'Sales pricing slab does not match its saved qualifying quantity'; end if;
    rule_factor:=case when lower(btrim(priced.quantity_unit))=lower(btrim(priced.main_unit)) then 1 when lower(btrim(priced.quantity_unit))=lower(btrim(coalesce(priced.alternate_unit,''))) then priced.alternate_conversion else null end;
    expected_rate:=round(priced.slab_rate*rule_factor/coalesce(nullif(priced.conversion_factor,0),1),6);
    if expected_rate is null or abs(expected_rate-priced.calculated_rate)>0.000001 then raise exception 'Sales calculated rate does not match the pricing slab unit conversion'; end if;
  end loop;
  return coalesce(new,old);
end; $$;

notify pgrst,'reload schema';
commit;

-- END SYNCED MIGRATION: 202609010001_versioned_slab_pricing.sql
-- BEGIN SYNCED MIGRATION: 202609010002_fix_pricing_rule_deletion.sql
-- Delete unused slab rows while their parent rule is still available to the
-- slab authorization trigger. Referenced rules remain protected and should be
-- deactivated instead.
create or replace function public.delete_pricing_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare source public.pricing_rules%rowtype;
begin
  select * into source from public.pricing_rules where id=p_rule_id for update;
  if not found then raise exception 'Pricing rule not found'; end if;
  if not source.is_current then raise exception 'Superseded pricing rule versions cannot be deleted'; end if;
  if not public.has_company_permission(source.company_id,'pricing.manage') then
    raise exception 'Pricing management permission is required' using errcode='42501';
  end if;
  perform set_config('khataerp.initializing_company',source.company_id::text,true);
  if exists(select 1 from public.invoice_items where pricing_rule_id=p_rule_id)
     or exists(
       select 1 from public.vouchers voucher
       cross join lateral jsonb_array_elements(coalesce(voucher.draft_payload->'lines','[]'::jsonb)) line
       where voucher.company_id=source.company_id and voucher.status='Draft' and not voucher.cancelled
         and line->>'pricing_rule_id'=p_rule_id::text
     ) then raise exception 'This pricing rule is used by Sales invoices or drafts. Deactivate it instead.'; end if;

  delete from public.pricing_rule_slabs where pricing_rule_id=p_rule_id;
  delete from public.pricing_rules where id=p_rule_id;
  insert into public.master_change_logs(company_id,user_id,record_type,record_id,action,old_values,new_values)
  values(source.company_id,auth.uid(),'pricing_rule',source.id::text,'delete',to_jsonb(source),'{}'::jsonb);
end; $$;

notify pgrst,'reload schema';

-- END SYNCED MIGRATION: 202609010002_fix_pricing_rule_deletion.sql

-- Repair the target-column list when the original whitespace-sensitive patch
-- extended the SELECT expressions but not the invoice_items INSERT columns.
do $repair_atomic_pricing_columns$
declare
  function_sql text;
  old_target_fields text := 'vat_amount, cost_rate';
  new_target_fields text := 'vat_amount, cost_rate, pricing_rule_id, pricing_slab_id, calculated_rate, price_overridden, pricing_snapshot';
begin
  select pg_get_functiondef(
    'public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure
  ) into function_sql;
  if position('item.pricing_rule_id' in function_sql) = 0
     or position('pricing_rule_id uuid' in function_sql) = 0 then
    raise exception 'Apply the atomic voucher pricing record repair before this migration';
  end if;
  if position(new_target_fields in function_sql) = 0 then
    function_sql := replace(function_sql, old_target_fields, new_target_fields);
  end if;
  if position(new_target_fields in function_sql) = 0 then
    raise exception 'Could not extend the atomic voucher pricing target columns';
  end if;
  execute function_sql;
end;
$repair_atomic_pricing_columns$;

notify pgrst, 'reload schema';

commit;
notify pgrst, 'reload schema';
