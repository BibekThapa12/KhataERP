-- Optional company payment QR images for printed Sales vouchers.
begin;

alter table public.companies
  add column if not exists payment_qr_url text;

alter table public.companies
  drop constraint if exists companies_payment_qr_url_valid;
alter table public.companies
  add constraint companies_payment_qr_url_valid
  check (
    payment_qr_url is null
    or btrim(payment_qr_url) = ''
    or (length(payment_qr_url) <= 2048 and payment_qr_url ~ '^https://')
  );

comment on column public.companies.payment_qr_url is
  'Optional HTTPS URL for the payment QR image printed on Sales vouchers.';

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-assets',
  'company-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_assets_public_read on storage.objects;
create policy company_assets_public_read
on storage.objects for select
using (bucket_id = 'company-assets');

drop policy if exists company_assets_admin_insert on storage.objects;
create policy company_assets_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-assets'
  and exists (
    select 1 from public.companies company
    where company.id::text = (storage.foldername(name))[1]
      and public.is_company_admin(company.id)
  )
);

drop policy if exists company_assets_admin_update on storage.objects;
create policy company_assets_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'company-assets'
  and exists (
    select 1 from public.companies company
    where company.id::text = (storage.foldername(name))[1]
      and public.is_company_admin(company.id)
  )
)
with check (
  bucket_id = 'company-assets'
  and exists (
    select 1 from public.companies company
    where company.id::text = (storage.foldername(name))[1]
      and public.is_company_admin(company.id)
  )
);

drop policy if exists company_assets_admin_delete on storage.objects;
create policy company_assets_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'company-assets'
  and exists (
    select 1 from public.companies company
    where company.id::text = (storage.foldername(name))[1]
      and public.is_company_admin(company.id)
  )
);

commit;
notify pgrst, 'reload schema';

