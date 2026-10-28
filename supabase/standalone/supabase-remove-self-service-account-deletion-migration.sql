-- Remove self-service account/company deletion. Company deletion remains available
-- only through the existing developer-admin RPC.
begin;

drop function if exists public.delete_my_account();

commit;
notify pgrst, 'reload schema';
