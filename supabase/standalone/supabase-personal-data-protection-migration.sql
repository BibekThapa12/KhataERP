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

commit;
notify pgrst, 'reload schema';
