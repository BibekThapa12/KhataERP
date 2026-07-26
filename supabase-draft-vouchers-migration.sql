-- Draft voucher workflow columns.
-- Apply after the voucher schema and atomic posting migrations. Safe to rerun.
begin;

alter table public.vouchers add column if not exists status text not null default 'Completed';
alter table public.vouchers drop constraint if exists vouchers_status_check;
alter table public.vouchers add constraint vouchers_status_check check (status in ('Draft','Completed'));
alter table public.vouchers add column if not exists created_by uuid references auth.users(id);
alter table public.vouchers add column if not exists updated_by uuid references auth.users(id);
alter table public.vouchers add column if not exists updated_at timestamptz not null default now();
alter table public.vouchers add column if not exists completed_by uuid references auth.users(id);
alter table public.vouchers add column if not exists completed_at timestamptz;
alter table public.vouchers add column if not exists draft_payload jsonb;
alter table public.vouchers add column if not exists draft_no text;

update public.vouchers
set status = 'Completed',
    completed_at = coalesce(completed_at, created_at)
where status is null;

create index if not exists idx_vouchers_company_status on public.vouchers(company_id, status);
create unique index if not exists vouchers_company_draft_no_unique
  on public.vouchers(company_id, draft_no)
  where draft_no is not null;

commit;
notify pgrst, 'reload schema';
