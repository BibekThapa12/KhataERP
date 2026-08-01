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
  allow_admin_chronological_bypass boolean not null default false,
  enforce_sales_invoice_chronology boolean not null default false,
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
alter table companies add column if not exists allow_admin_chronological_bypass boolean not null default false;
alter table companies add column if not exists enforce_sales_invoice_chronology boolean not null default false;
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
alter table items add column if not exists alternate_conversion numeric(14,4);

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
  restock_items    boolean,
  party_account_id text references accounts(id),
  is_cash          boolean not null default false,
  subtotal         numeric(14,2),
  discount         numeric(14,2),
  vat_rate         numeric(5,2),
  vat_amount       numeric(14,2),
  total            numeric(14,2) not null default 0,
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
    ('rent','Rent Expense','Expense','Indirect Expenses',false),
    ('salary','Salary Expense','Expense','Indirect Expenses',false),
    ('electricity','Electricity Expense','Expense','Indirect Expenses',false)
  ) seed(account_key, account_name, account_type, group_name, is_system)
  left join public.account_categories category
    on category.company_id = target_company_id
   and category.name = seed.group_name
   and category.account_type = seed.account_type
  on conflict (id) do nothing;

  insert into public.item_categories(company_id, name, is_archived)
  values (target_company_id, 'General', false)
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

-- After running this schema, set your environment variables:
--   VITE_SUPABASE_URL      = https://your-project-id.supabase.co
--   VITE_SUPABASE_ANON_KEY = your-anon-public-key
-- Both are in: Supabase dashboard → Settings → API
