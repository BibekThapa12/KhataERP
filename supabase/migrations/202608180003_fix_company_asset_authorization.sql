-- Make company asset authorization reliable for both owners and active admins.
begin;

create or replace function public.can_manage_company_asset(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      public.is_developer_admin()
      or exists (
        select 1
        from public.companies company
        where company.id::text = split_part(object_name, '/', 1)
          and (
            company.user_id = auth.uid()
            or exists (
              select 1
              from public.company_members member
              where member.company_id = company.id
                and member.user_id = auth.uid()
                and member.status = 'active'
                and member.role = 'Admin'
            )
          )
      )
    )
$$;

revoke all on function public.can_manage_company_asset(text) from public, anon;
grant execute on function public.can_manage_company_asset(text) to authenticated;

drop policy if exists company_assets_admin_insert on storage.objects;
create policy company_assets_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-assets'
  and public.can_manage_company_asset(name)
);

drop policy if exists company_assets_admin_update on storage.objects;
create policy company_assets_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'company-assets'
  and public.can_manage_company_asset(name)
)
with check (
  bucket_id = 'company-assets'
  and public.can_manage_company_asset(name)
);

drop policy if exists company_assets_admin_delete on storage.objects;
create policy company_assets_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'company-assets'
  and public.can_manage_company_asset(name)
);

commit;
notify pgrst, 'reload schema';

