-- Journal-backed Contra vouchers and their protected Bank Charges ledger.
alter table public.vouchers add column if not exists contra_entry boolean not null default false;
alter table public.vouchers add column if not exists contra_destination_account_id text references public.accounts(id);
alter table public.vouchers add column if not exists contra_charge_amount numeric(14,2) not null default 0;
alter table public.vouchers drop constraint if exists vouchers_contra_metadata_check;
alter table public.vouchers add constraint vouchers_contra_metadata_check check (
  contra_charge_amount >= 0 and (not contra_entry or (type = 'Journal' and (status = 'Draft' or (settlement_account_id is not null and contra_destination_account_id is not null))))
);

insert into public.account_categories(company_id, name, account_type, is_system)
select id, 'Indirect Expenses', 'Expense', true from public.companies
where not exists (
  select 1 from public.account_categories category
  where category.company_id = companies.id
    and lower(btrim(category.name)) = lower('Indirect Expenses')
    and category.account_type = 'Expense'
);

update public.account_categories
set is_system = true
where lower(btrim(name)) = lower('Indirect Expenses')
  and account_type = 'Expense';

insert into public.accounts(id, company_id, name, type, "group", category_id, is_system, is_party, opening_balance)
select company.id::text || ':bank_charges', company.id, 'Bank Charges', 'Expense', 'Indirect Expenses', category.id, true, false, 0
from public.companies company
join public.account_categories category on category.company_id = company.id and category.name = 'Indirect Expenses' and category.account_type = 'Expense'
where not exists (
  select 1 from public.accounts existing
  where existing.company_id = company.id
    and lower(btrim(existing.name)) = lower('Bank Charges')
    and existing.type = 'Expense'
)
on conflict (id) do update set name = 'Bank Charges', type = 'Expense', "group" = 'Indirect Expenses', category_id = excluded.category_id, is_system = true, is_archived = false;

update public.accounts account
set is_system = true, is_archived = false, "group" = 'Indirect Expenses', category_id = category.id
from public.account_categories category
where account.company_id = category.company_id
  and lower(btrim(account.name)) = lower('Bank Charges')
  and account.type = 'Expense'
  and category.name = 'Indirect Expenses'
  and category.account_type = 'Expense';

create or replace function public.sync_contra_metadata()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.type = 'Journal' and new.draft_payload->>'journalEntryType' = 'Contra' then
    new.contra_entry := true;
    new.settlement_account_id := coalesce(nullif(new.draft_payload->>'sourceAccountId', ''), new.settlement_account_id);
    new.contra_destination_account_id := coalesce(nullif(new.draft_payload->>'destinationAccountId', ''), new.contra_destination_account_id);
    new.contra_charge_amount := coalesce(nullif(new.draft_payload->>'chargeAmount', '')::numeric, new.contra_charge_amount, 0);
  end if;
  return new;
end;
$$;
drop trigger if exists vouchers_sync_contra_metadata on public.vouchers;
create trigger vouchers_sync_contra_metadata before insert or update of draft_payload, contra_entry, contra_destination_account_id, contra_charge_amount on public.vouchers for each row execute function public.sync_contra_metadata();

create or replace function public.validate_contra_voucher()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_id uuid;
  v public.vouchers%rowtype;
  destination_debit numeric;
  source_credit numeric;
  charge_debit numeric;
  line_count integer;
  expected_line_count integer;
begin
  if tg_table_name = 'voucher_lines' then
    if tg_op = 'DELETE' then
      target_id := old.voucher_id;
    else
      target_id := new.voucher_id;
    end if;
  else
    if tg_op = 'DELETE' then
      target_id := old.id;
    else
      target_id := new.id;
    end if;
  end if;
  select * into v from public.vouchers where id = target_id;
  if not found or not v.contra_entry or v.status <> 'Completed' then return null; end if;
  if v.type <> 'Journal' or v.settlement_account_id = v.contra_destination_account_id then raise exception 'Contra requires different source and destination ledgers'; end if;
  if exists (
    select 1 from (values (v.settlement_account_id), (v.contra_destination_account_id)) endpoint(id)
    left join public.accounts account on account.id = endpoint.id and account.company_id = v.company_id and not account.is_archived
    left join public.account_categories category on category.id = account.category_id and category.company_id = v.company_id and not category.is_archived
    where account.id is null or not (category.name in ('Cash-in-Hand','Bank Accounts','Bank','Bank OD A/c') and category.account_type in ('Asset','Liability'))
  ) then raise exception 'Contra source and destination must be active Cash or Bank ledgers'; end if;

  select coalesce(sum(case when account_id = v.contra_destination_account_id then debit else 0 end),0),
         coalesce(sum(case when account_id = v.settlement_account_id then credit else 0 end),0), count(*)
    into destination_debit, source_credit, line_count from public.voucher_lines where voucher_id = target_id;
  select coalesce(sum(line.debit),0) into charge_debit from public.voucher_lines line join public.accounts account on account.id = line.account_id
    where line.voucher_id = target_id and account.company_id = v.company_id and lower(btrim(account.name)) = lower('Bank Charges') and account.is_system and account.type = 'Expense';
  expected_line_count := case when v.contra_charge_amount > 0 then 3 else 2 end;
  if destination_debit <= 0 or round(charge_debit,2) <> round(v.contra_charge_amount,2) or round(source_credit,2) <> round(destination_debit + charge_debit,2)
     or line_count <> expected_line_count
     or exists (select 1 from public.voucher_lines where voucher_id = target_id and debit > 0 and credit > 0)
  then raise exception 'Contra voucher lines are invalid or unbalanced'; end if;
  return null;
end;
$$;
drop trigger if exists vouchers_validate_contra on public.vouchers;
create constraint trigger vouchers_validate_contra after insert or update of status, contra_entry, settlement_account_id, contra_destination_account_id, contra_charge_amount on public.vouchers deferrable initially deferred for each row execute function public.validate_contra_voucher();
drop trigger if exists voucher_lines_validate_contra on public.voucher_lines;
create constraint trigger voucher_lines_validate_contra after insert or update or delete on public.voucher_lines deferrable initially deferred for each row execute function public.validate_contra_voucher();
revoke all on function public.sync_contra_metadata() from public;
revoke all on function public.validate_contra_voucher() from public;
