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
declare caller uuid := auth.uid(); user_email text; saved public.companies%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform public.assert_company_creation_allowed(caller);
  select email into user_email from auth.users where id = caller;
  insert into public.companies(user_id,owner_email,name,address,pan_vat,phone,vat_enabled,inventory_valuation_method,sales_prefix,purchase_prefix,receipt_prefix,payment_prefix,sales_return_prefix,purchase_return_prefix,journal_numbering_mode,reset_numbering_fiscal_year,print_format,invoice_terms,payment_qr_text,fiscal_year_start,fiscal_year_configured)
  values(caller,user_email,coalesce(nullif(btrim(coalesce(p_company->>'name','')),''),'My Company'),nullif(btrim(coalesce(p_company->>'address','')),''),nullif(btrim(coalesce(p_company->>'pan_vat','')),''),nullif(btrim(coalesce(p_company->>'phone','')),''),coalesce((p_company->>'vat_enabled')::boolean,true),coalesce(nullif(p_company->>'inventory_valuation_method',''),'weighted_average'),coalesce(nullif(btrim(p_company->>'sales_prefix'),''),'INV-'),coalesce(nullif(btrim(p_company->>'purchase_prefix'),''),'PB-'),coalesce(nullif(btrim(p_company->>'receipt_prefix'),''),'RCPT-'),coalesce(nullif(btrim(p_company->>'payment_prefix'),''),'PAY-'),coalesce(nullif(btrim(p_company->>'sales_return_prefix'),''),'SR-'),coalesce(nullif(btrim(p_company->>'purchase_return_prefix'),''),'PR-'),coalesce(nullif(p_company->>'journal_numbering_mode',''),'auto'),true,coalesce(nullif(p_company->>'print_format',''),'A5'),nullif(btrim(coalesce(p_company->>'invoice_terms','')),''),nullif(btrim(coalesce(p_company->>'payment_qr_text','')),''),coalesce(nullif(p_company->>'fiscal_year_start','')::date,'2026-07-17'::date),coalesce((p_company->>'fiscal_year_configured')::boolean,true)) returning * into saved;
  perform set_config('khataerp.initializing_company', saved.id::text, true);
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
