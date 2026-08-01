-- Production error-log access hardening. Safe to run repeatedly.
begin;

-- Retailer sessions may insert their own operational events but cannot read
-- sanitized stack/file details back through PostgREST. Developer
-- administrators retain support access through app_events_developer_select.
drop policy if exists "app_events_own_select" on public.app_events;

commit;
notify pgrst, 'reload schema';
