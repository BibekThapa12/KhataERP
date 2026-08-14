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
