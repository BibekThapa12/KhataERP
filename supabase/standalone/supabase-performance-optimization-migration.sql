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
