-- Apply after supabase-master-duplicate-name-guards-migration.sql.
-- Makes system account-group repair idempotent even when the case-insensitive
-- duplicate-name trigger is installed. PostgreSQL BEFORE INSERT triggers run
-- before ON CONFLICT resolution, so inserts must exclude existing names.
begin;

create or replace function public.ensure_system_account_groups(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, root.name, root.account_type, null, true, false
  from (values
    ('Assets', 'Asset'),
    ('Liabilities', 'Liability'),
    ('Equity', 'Equity'),
    ('Incomes', 'Income'),
    ('Expenses', 'Expense')
  ) root(name, account_type)
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = root.account_type
      and lower(btrim(existing.name)) = lower(btrim(root.name))
  )
  on conflict (company_id, name, account_type) do update
  set parent_category_id = null, is_system = true, is_archived = false;

  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, child.name, child.account_type, parent.id, true, false
  from (values
    ('Capital Account', 'Equity', 'Equity'),
    ('Current Assets', 'Asset', 'Assets'),
    ('Fixed Assets', 'Asset', 'Assets'),
    ('Investments', 'Asset', 'Assets'),
    ('Current Liabilities', 'Liability', 'Liabilities'),
    ('Loans (Liability)', 'Liability', 'Liabilities'),
    ('Suspense A/c', 'Liability', 'Liabilities'),
    ('Direct Expenses', 'Expense', 'Expenses'),
    ('Indirect Expenses', 'Expense', 'Expenses'),
    ('Purchase Accounts', 'Expense', 'Expenses'),
    ('Direct Incomes', 'Income', 'Incomes'),
    ('Indirect Incomes', 'Income', 'Incomes'),
    ('Sales Accounts', 'Income', 'Incomes')
  ) child(name, account_type, parent_name)
  join public.account_categories parent
    on parent.company_id = target_company_id
   and parent.name = child.parent_name
   and parent.account_type = child.account_type
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = child.account_type
      and lower(btrim(existing.name)) = lower(btrim(child.name))
  )
  on conflict (company_id, name, account_type) do update
  set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;

  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, child.name, child.account_type, parent.id, true, false
  from (values
    ('Reserves & Surplus', 'Equity', 'Capital Account'),
    ('Bank Accounts', 'Asset', 'Current Assets'),
    ('Cash-in-Hand', 'Asset', 'Current Assets'),
    ('Deposits (Asset)', 'Asset', 'Current Assets'),
    ('Loans & Advances (Asset)', 'Asset', 'Current Assets'),
    ('Sundry Debtors', 'Asset', 'Current Assets'),
    ('Duties & Taxes', 'Liability', 'Current Liabilities'),
    ('Provisions', 'Liability', 'Current Liabilities'),
    ('Sundry Creditors', 'Liability', 'Current Liabilities'),
    ('Bank OD A/c', 'Liability', 'Loans (Liability)'),
    ('Secured Loans', 'Liability', 'Loans (Liability)'),
    ('Unsecured Loans', 'Liability', 'Loans (Liability)')
  ) child(name, account_type, parent_name)
  join public.account_categories parent
    on parent.company_id = target_company_id
   and parent.name = child.parent_name
   and parent.account_type = child.account_type
  where not exists (
    select 1 from public.account_categories existing
    where existing.company_id = target_company_id
      and existing.account_type = child.account_type
      and lower(btrim(existing.name)) = lower(btrim(child.name))
  )
  on conflict (company_id, name, account_type) do update
  set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;

  insert into public.account_categories (company_id, name, account_type, parent_category_id, is_system, is_archived)
  select target_company_id, 'Employees / Staffs', 'Asset', parent.id, true, false
  from public.account_categories parent
  where parent.company_id = target_company_id
    and parent.name = 'Loans & Advances (Asset)'
    and parent.account_type = 'Asset'
    and not exists (
      select 1 from public.account_categories existing
      where existing.company_id = target_company_id
        and existing.account_type = 'Asset'
        and lower(btrim(existing.name)) = lower('Employees / Staffs')
    )
  on conflict (company_id, name, account_type) do update
  set parent_category_id = excluded.parent_category_id, is_system = true, is_archived = false;
end;
$$;

create or replace function public.ensure_default_company_accounts(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.ensure_system_account_groups(uuid)') is not null then
    perform public.ensure_system_account_groups(target_company_id);
  end if;
  if to_regprocedure('public.ensure_retained_earnings_ledger(uuid)') is not null then
    perform public.ensure_retained_earnings_ledger(target_company_id);
  end if;

  insert into public.accounts(id, company_id, name, type, "group", category_id, is_system, is_party, opening_balance)
  select target_company_id::text || ':' || seed.account_key, target_company_id, seed.account_name, seed.account_type, seed.group_name, category.id, seed.is_system, false, 0
  from (values
    ('cash','Cash','Asset','Cash-in-Hand',true),
    ('bank','Bank Account','Asset','Bank Accounts',true),
    ('inventory','Stock-in-Hand','Asset','Current Assets',true),
    ('vat_payable','VAT Payable (Output)','Liability','Duties & Taxes',true),
    ('vat_receivable','VAT Receivable (Input)','Liability','Duties & Taxes',true),
    ('sales','Sales Account','Income','Sales Accounts',true),
    ('purchase','Purchase Account','Expense','Purchase Accounts',true),
    ('sales_return','Sales Return Account','Income','Sales Accounts',true),
    ('purchase_return','Purchase Return Account','Expense','Purchase Accounts',true),
    ('capital','Owner''s Capital','Equity','Capital Account',true),
    ('retained_earnings','Retained Earnings','Equity','Reserves & Surplus',true),
    ('discount_allowed','Discount Allowed','Expense','Indirect Expenses',false),
    ('rent','Rent Expense','Expense','Indirect Expenses',false),
    ('salary','Salary Expense','Expense','Indirect Expenses',false),
    ('electricity','Electricity Expense','Expense','Indirect Expenses',false)
  ) seed(account_key, account_name, account_type, group_name, is_system)
  left join public.account_categories category
    on category.company_id = target_company_id
   and category.name = seed.group_name
   and category.account_type = seed.account_type
  where not exists (
    select 1 from public.accounts existing
    where existing.company_id = target_company_id
      and (
        existing.id = target_company_id::text || ':' || seed.account_key
        or lower(btrim(existing.name)) = lower(btrim(seed.account_name))
      )
  )
  on conflict (id) do nothing;

  insert into public.item_categories(company_id, name, is_archived)
  select target_company_id, 'General', false
  where not exists (
    select 1 from public.item_categories existing
    where existing.company_id = target_company_id
      and lower(btrim(existing.name)) = lower('General')
  )
  on conflict (company_id, name) do nothing;
end;
$$;

commit;
notify pgrst, 'reload schema';
