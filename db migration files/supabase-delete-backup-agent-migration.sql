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
