-- Compatibility migration retained for historical deployment order.
-- KhataERP now supports multiple companies per user through company_members.
-- Never merge companies or recreate companies_user_id_unique.
begin;
drop index if exists public.companies_user_id_unique;
commit;
notify pgrst, 'reload schema';
