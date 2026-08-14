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
