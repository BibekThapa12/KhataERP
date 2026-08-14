-- Beginner-friendly Income/Expense entries remain Journal vouchers while this
-- marker preserves their dedicated editor and list identity.
alter table public.vouchers add column if not exists simple_entry_type text;
alter table public.vouchers drop constraint if exists vouchers_simple_entry_type_check;
alter table public.vouchers add constraint vouchers_simple_entry_type_check
  check (simple_entry_type is null or (type = 'Journal' and simple_entry_type in ('Income', 'Expense')));

create or replace function public.sync_simple_entry_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type = 'Journal' and new.draft_payload ? 'simpleEntryType' then
    new.simple_entry_type := nullif(new.draft_payload->>'simpleEntryType', '');
  end if;
  return new;
end;
$$;

drop trigger if exists vouchers_sync_simple_entry_type on public.vouchers;
create trigger vouchers_sync_simple_entry_type
before insert or update of draft_payload, simple_entry_type on public.vouchers
for each row execute function public.sync_simple_entry_type();

create or replace function public.validate_simple_entry_voucher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  voucher_row public.vouchers%rowtype;
  expected_type text;
  counter_debit numeric;
  counter_credit numeric;
  detail_total numeric;
  detail_count integer;
begin
  if tg_table_name = 'voucher_lines' then
    target_id := case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  else
    target_id := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  select * into voucher_row from public.vouchers where id = target_id;
  if not found or voucher_row.simple_entry_type is null or voucher_row.status <> 'Completed' then return null; end if;
  expected_type := voucher_row.simple_entry_type;

  if voucher_row.type <> 'Journal' or voucher_row.settlement_account_id is null then
    raise exception 'Simple entry requires a Journal voucher and counter ledger';
  end if;
  if not exists (select 1 from public.accounts where id = voucher_row.settlement_account_id and company_id = voucher_row.company_id and not is_archived) then
    raise exception 'Simple entry counter ledger is unavailable';
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into counter_debit, counter_credit
  from public.voucher_lines where voucher_id = target_id and account_id = voucher_row.settlement_account_id;

  select count(*), coalesce(sum(case when expected_type = 'Income' then line.credit else line.debit end), 0)
    into detail_count, detail_total
  from public.voucher_lines line
  join public.accounts account on account.id = line.account_id and account.company_id = voucher_row.company_id
  join public.account_categories category on category.id = account.category_id and category.company_id = voucher_row.company_id
  where line.voucher_id = target_id and line.account_id <> voucher_row.settlement_account_id
    and account.type = expected_type and category.account_type = expected_type and not account.is_archived and not category.is_archived
    and case when expected_type = 'Income' then line.credit > 0 and line.debit = 0 else line.debit > 0 and line.credit = 0 end;

  if detail_count < 1 or detail_total <= 0
     or detail_count <> (select count(*) from public.voucher_lines where voucher_id = target_id and account_id <> voucher_row.settlement_account_id)
     or (expected_type = 'Income' and (counter_debit <> detail_total or counter_credit <> 0))
     or (expected_type = 'Expense' and (counter_credit <> detail_total or counter_debit <> 0))
     or round(detail_total, 6) <> round(voucher_row.total, 6) then
    raise exception 'Simple entry ledger lines are invalid or unbalanced';
  end if;
  return null;
end;
$$;

drop trigger if exists vouchers_validate_simple_entry on public.vouchers;
create constraint trigger vouchers_validate_simple_entry
after insert or update of status, simple_entry_type, settlement_account_id, total on public.vouchers
deferrable initially deferred for each row execute function public.validate_simple_entry_voucher();

drop trigger if exists voucher_lines_validate_simple_entry on public.voucher_lines;
create constraint trigger voucher_lines_validate_simple_entry
after insert or update or delete on public.voucher_lines
deferrable initially deferred for each row execute function public.validate_simple_entry_voucher();

revoke all on function public.sync_simple_entry_type() from public;
revoke all on function public.validate_simple_entry_voucher() from public;
