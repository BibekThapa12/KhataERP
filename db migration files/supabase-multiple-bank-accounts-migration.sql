-- Apply after supabase-category-hierarchy-migration.sql.
begin;

insert into public.account_categories (company_id, name, account_type, is_system, is_archived)
select c.id, 'Assets', 'Asset', false, false from public.companies c
on conflict (company_id, name, account_type) do update set is_archived = false;

insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
select c.id, 'Current Assets', 'Asset', root.id, false, false
from public.companies c join public.account_categories root on root.company_id = c.id and root.name = 'Assets' and root.account_type = 'Asset'
on conflict (company_id, name, account_type) do update set parent_category_id = excluded.parent_category_id, is_archived = false;

insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
select c.id, 'Bank', 'Asset', parent.id, true, false
from public.companies c join public.account_categories parent on parent.company_id = c.id and parent.name = 'Current Assets' and parent.account_type = 'Asset'
on conflict (company_id, name, account_type) do update set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;

update public.accounts a set category_id = bank.id, "group" = 'Bank'
from public.account_categories bank
where bank.company_id = a.company_id and bank.name = 'Bank' and bank.account_type = 'Asset'
  and (a.id = a.company_id::text || ':bank' or (a.id = 'bank' and a.name = 'Bank Account'));

alter table public.vouchers add column if not exists settlement_account_id text references public.accounts(id) on delete restrict;
create index if not exists idx_vouchers_settlement_account on public.vouchers(settlement_account_id);

update public.vouchers v set settlement_account_id = (
  select l.account_id from public.voucher_lines l
  where l.voucher_id = v.id and (
    (v.type = 'Receipt' and l.account_id is distinct from v.party_account_id and l.debit > 0) or
    (v.type = 'Payment' and l.account_id is distinct from v.party_account_id and l.credit > 0) or
    (v.type = 'Sales Return' and l.credit > 0) or
    (v.type = 'Purchase Return' and l.debit > 0)
  ) order by greatest(l.debit, l.credit) desc limit 1
)
where v.settlement_account_id is null and v.type in ('Receipt','Payment','Sales Return','Purchase Return');

commit;
notify pgrst, 'reload schema';
