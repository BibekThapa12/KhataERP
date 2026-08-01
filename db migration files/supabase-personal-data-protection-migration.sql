-- Personal-data minimization and self-service account deletion.
-- Apply after the base, master, and cheque-management migrations. Safe to run repeatedly.
begin;

-- Remove full historical record snapshots from audit tables. The UI only uses
-- field names to show what changed, so values are replaced with markers.
create or replace function public.audit_field_markers(payload jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when jsonb_typeof(coalesce(payload, '{}'::jsonb)) <> 'object' then '{}'::jsonb
    else coalesce((
      select jsonb_object_agg(field_name, to_jsonb('[CHANGED]'::text))
      from jsonb_object_keys(payload) field_name
    ), '{}'::jsonb)
  end
$$;

update public.master_change_logs
set old_values = public.audit_field_markers(old_values),
    new_values = public.audit_field_markers(new_values)
where old_values <> public.audit_field_markers(old_values)
   or new_values <> public.audit_field_markers(new_values);

update public.cheque_events
set old_values = public.audit_field_markers(old_values),
    new_values = public.audit_field_markers(new_values)
where old_values <> public.audit_field_markers(old_values)
   or new_values <> public.audit_field_markers(new_values);

-- Remove record identifiers and possible personal text from older operational
-- events. Counts and non-identifying event attributes remain useful.
update public.app_events
set metadata = metadata - array[
  'email','owner_email','phone','address','pan_vat','password','token',
  'access_token','refresh_token','authorization','cookie','party_id','voucher_id'
]
where metadata ?| array[
  'email','owner_email','phone','address','pan_vat','password','token',
  'access_token','refresh_token','authorization','cookie','party_id','voucher_id'
];

update public.app_events
set metadata = jsonb_strip_nulls(jsonb_build_object(
  'source', metadata->'source',
  'path', metadata->'path'
))
where event_type = 'frontend_error';

-- The function executes as its owner because authenticated users cannot and
-- must not receive direct DELETE rights on auth.users. Deleting auth.users
-- cascades to the owned company and all company-scoped accounting/module data.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller_user_id uuid := auth.uid();
begin
  if caller_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Actor references are audit attribution, not ownership. Null them before
  -- deleting the identity so old actions in other companies do not block the
  -- user's deletion request.
  update public.company_modules set enabled_by = null where enabled_by = caller_user_id;
  update public.company_user_permissions set granted_by = null where granted_by = caller_user_id;
  update public.cheque_banks set created_by = null where created_by = caller_user_id;
  update public.cheque_banks set updated_by = null where updated_by = caller_user_id;
  update public.cheques set created_by = null where created_by = caller_user_id;
  update public.cheques set updated_by = null where updated_by = caller_user_id;
  update public.cheque_events set actor_id = null where actor_id = caller_user_id;

  delete from auth.users where id = caller_user_id;
  if not found then
    raise exception 'Authenticated user no longer exists';
  end if;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

commit;
notify pgrst, 'reload schema';
