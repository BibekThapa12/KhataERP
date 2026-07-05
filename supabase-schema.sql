-- ═══════════════════════════════════════════════════════════════════════════
--  Khata ERP — Supabase Schema
--  Run this entire file in your Supabase project's SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Companies ─────────────────────────────────────────────────────────────────
create table if not exists companies (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null default 'My Trading Co.',
  address          text,
  pan_vat          text,
  fiscal_year_start date not null default '2026-04-01',
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

-- ── Vouchers ──────────────────────────────────────────────────────────────────
create table if not exists vouchers (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  type             text not null check (type in ('Sales','Purchase','Receipt','Payment','Journal')),
  date             date not null,
  date_ad          date not null,
  date_bs          text not null,
  date_bs_key      integer not null,
  invoice_no       text,
  narration        text,
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

-- Existing databases created before Nepali-date support can run this file again.
-- Old rows may keep date_bs/date_bs_key null until re-saved/imported; the app
-- normalizes them from the legacy AD date while displaying.
alter table vouchers add column if not exists date_ad date;
alter table vouchers add column if not exists date_bs text;
alter table vouchers add column if not exists date_bs_key integer;
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

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_accounts_company   on accounts(company_id);
create index if not exists idx_parties_company    on parties(company_id);
create index if not exists idx_items_company      on items(company_id);
create index if not exists idx_vouchers_company   on vouchers(company_id, date desc, seq desc);
create index if not exists idx_vouchers_company_bs on vouchers(company_id, date_bs_key desc, seq desc);
create index if not exists idx_vlines_voucher     on voucher_lines(voucher_id);
create index if not exists idx_slines_voucher     on stock_lines(voucher_id);
create index if not exists idx_iitems_voucher     on invoice_items(voucher_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Users can only see/modify data belonging to their own company.

alter table companies      enable row level security;
alter table accounts       enable row level security;
alter table parties        enable row level security;
alter table items          enable row level security;
alter table vouchers       enable row level security;
alter table voucher_lines  enable row level security;
alter table stock_lines    enable row level security;
alter table invoice_items  enable row level security;

-- Companies: own row only
create policy "companies_own" on companies
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Helper function: returns the user's company_id
create or replace function my_company_id()
returns uuid language sql stable
as $$ select id from companies where user_id = auth.uid() limit 1 $$;

-- Accounts
create policy "accounts_own" on accounts
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

-- Parties
create policy "parties_own" on parties
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

-- Items
create policy "items_own" on items
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

-- Vouchers
create policy "vouchers_own" on vouchers
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

-- Voucher Lines (access via parent voucher's company)
create policy "vlines_own" on voucher_lines
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

-- Stock Lines
create policy "slines_own" on stock_lines
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

-- Invoice Items
create policy "iitems_own" on invoice_items
  for all using (
    exists (select 1 from vouchers v where v.id = voucher_id and v.company_id = my_company_id())
  );

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this schema, set your environment variables:
--   VITE_SUPABASE_URL      = https://your-project-id.supabase.co
--   VITE_SUPABASE_ANON_KEY = your-anon-public-key
-- Both are in: Supabase dashboard → Settings → API
