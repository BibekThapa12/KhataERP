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
