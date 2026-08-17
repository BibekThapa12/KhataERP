-- Party and its ledger are one business record. Create both in one database
-- transaction so the browser no longer needs two sequential HTTP requests and
-- cannot leave an orphan when the second request fails.
create or replace function public.create_party_with_ledger_atomic(
  p_company_id uuid,
  p_account_id text,
  p_name text,
  p_party_type text,
  p_category_id uuid,
  p_opening_balance numeric default 0,
  p_phone text default null,
  p_pan_vat text default null,
  p_address text default null,
  p_credit_days integer default 0
)
returns public.parties
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_account_type text;
  category_record public.account_categories%rowtype;
  result public.parties%rowtype;
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_party_type not in ('customer', 'supplier') then
    raise exception 'Party type must be customer or supplier';
  end if;
  if p_account_id is null or btrim(p_account_id) = '' then
    raise exception 'Party ledger identifier is required';
  end if;
  expected_account_type := case when p_party_type = 'customer' then 'Asset' else 'Liability' end;
  select * into category_record from public.account_categories
  where id = p_category_id and company_id = p_company_id
    and account_type = expected_account_type and not is_archived;
  if not found then raise exception 'Select an active party ledger category'; end if;

  insert into public.accounts(
    id, company_id, name, type, "group", category_id, is_system,
    is_party, is_archived, opening_balance, address, contact_no, pan_no,
    credit_days, bank_account_no, bank_branch
  ) values (
    p_account_id, p_company_id, btrim(p_name), expected_account_type,
    category_record.name, category_record.id, false, true, false,
    coalesce(p_opening_balance, 0), nullif(btrim(p_address), ''),
    nullif(btrim(p_phone), ''), nullif(btrim(p_pan_vat), ''),
    coalesce(p_credit_days, 0), null, null
  );

  insert into public.parties(
    company_id, name, type, phone, pan_vat, address, default_credit_days,
    account_id, is_archived
  ) values (
    p_company_id, btrim(p_name), p_party_type, nullif(btrim(p_phone), ''),
    nullif(btrim(p_pan_vat), ''), nullif(btrim(p_address), ''),
    coalesce(p_credit_days, 0), p_account_id, false
  ) returning * into result;
  return result;
end;
$$;

revoke all on function public.create_party_with_ledger_atomic(uuid,text,text,text,uuid,numeric,text,text,text,integer) from public, anon;
grant execute on function public.create_party_with_ledger_atomic(uuid,text,text,text,uuid,numeric,text,text,text,integer) to authenticated;

notify pgrst, 'reload schema';
