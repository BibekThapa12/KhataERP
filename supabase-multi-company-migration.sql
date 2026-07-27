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
