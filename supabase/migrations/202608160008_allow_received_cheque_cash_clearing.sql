-- Received cheques may be cleared into Cash-in-Hand or a company Bank/Bank OD
-- ledger. Issued-cheque sources remain Bank/Bank OD only in the directional
-- cheque validator.
create or replace function public.cheque_touch_and_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bank_record record;
  allow_early boolean;
  allow_override boolean;
begin
  select bank.company_id, bank.account_number, bank.is_active
    into bank_record
  from public.cheque_banks bank
  where bank.id = new.bank_id;

  if not found or bank_record.company_id <> new.company_id then
    raise exception 'Issuing bank must belong to the cheque company';
  end if;
  if tg_op = 'INSERT' and not bank_record.is_active then
    raise exception 'Inactive banks cannot be used for new cheques';
  end if;
  if not exists (
    select 1 from public.accounts account
    where account.id = new.party_ledger_id
      and account.company_id = new.company_id
      and not coalesce(account.is_archived, false)
  ) then
    raise exception 'Party ledger must be active and belong to the cheque company';
  end if;

  select coalesce((company_module.settings->>'allow_due_date_before_issue_date')::boolean, false),
         coalesce((company_module.settings->>'allow_account_number_override')::boolean, false)
    into allow_early, allow_override
  from public.company_modules company_module
  join public.modules module on module.id = company_module.module_id
  where company_module.company_id = new.company_id
    and module.key = 'cheque_management';

  if new.due_date < new.issue_date and not coalesce(allow_early, false) then
    raise exception 'Due date cannot be before issue date';
  end if;
  if coalesce(bank_record.account_number, '') <> ''
    and new.account_number <> bank_record.account_number
    and not coalesce(allow_override, false) then
    raise exception 'Account number must match the selected bank';
  end if;

  if new.cleared_to_account_id is not null and not exists (
    select 1
    from public.accounts account
    left join public.account_categories category on category.id = account.category_id
    where account.id = new.cleared_to_account_id
      and account.company_id = new.company_id
      and not coalesce(account.is_archived, false)
      and (
        category.name in ('Cash-in-Hand', 'Bank Accounts', 'Bank', 'Bank OD A/c')
        or (account.is_system and account.id in (new.company_id::text || ':cash', 'cash'))
      )
  ) then
    raise exception 'Clearing account must be the active Cash-in-Hand or a company bank ledger';
  end if;

  new.updated_at = now();
  new.updated_by = auth.uid();
  if tg_op = 'UPDATE' and old.status <> 'pending' and row(
    new.cheque_number, new.bank_id, new.account_number, new.party_ledger_id,
    new.amount, new.issue_date, new.due_date, new.notes
  ) is distinct from row(
    old.cheque_number, old.bank_id, old.account_number, old.party_ledger_id,
    old.amount, old.issue_date, old.due_date, old.notes
  ) then
    raise exception 'Completed cheques cannot be edited';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status <> 'pending' then raise exception 'Only pending cheques may change status'; end if;
    if new.status = 'cleared' and not public.has_company_permission(new.company_id, 'cheque.mark_cleared') then raise exception 'Missing cheque.mark_cleared permission'; end if;
    if new.status = 'bounced' and not public.has_company_permission(new.company_id, 'cheque.mark_bounced') then raise exception 'Missing cheque.mark_bounced permission'; end if;
    if new.status = 'cancelled' and not public.has_company_permission(new.company_id, 'cheque.cancel') then raise exception 'Missing cheque.cancel permission'; end if;
    if new.status = 'cleared' then new.cleared_at = now();
    elsif new.status = 'bounced' then new.bounced_at = now();
    elsif new.status = 'cancelled' then new.cancelled_at = now();
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.cheque_touch_and_audit() from public, anon, authenticated;
