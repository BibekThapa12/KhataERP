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
