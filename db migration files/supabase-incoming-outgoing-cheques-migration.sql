-- Direction-aware received and issued cheque management.
begin;

alter table public.cheques add column if not exists direction text not null default 'received';
alter table public.cheques add column if not exists source_account_id text references public.accounts(id);
alter table public.cheques add column if not exists cleared_date_bs text;
alter table public.cheques add column if not exists cleared_date_bs_key integer;
alter table public.cheques alter column bank_id drop not null;
update public.cheques set direction='received' where direction is null;

-- Received cheques retain the external bank account validation. Issued cheques
-- identify the source by its company ledger, so an account number is optional.
alter table public.cheques drop constraint if exists cheques_identity_account_check;
alter table public.cheques add constraint cheques_identity_account_check check (
  (direction='issued' and btrim(account_number)='')
  or (char_length(btrim(account_number)) between 1 and 34 and btrim(account_number) ~ '^[[:alnum:] -]+$')
) not valid;

alter table public.cheques drop constraint if exists cheques_direction_check;
alter table public.cheques add constraint cheques_direction_check check(direction in ('received','issued'));
alter table public.cheques drop constraint if exists cheques_direction_metadata_check;
alter table public.cheques add constraint cheques_direction_metadata_check check(
  (direction='received' and bank_id is not null and source_account_id is null)
  or (direction='issued' and source_account_id is not null)
);
create unique index if not exists cheques_linked_voucher_unique on public.cheques(linked_voucher_id) where linked_voucher_id is not null;
create unique index if not exists issued_cheque_number_unique on public.cheques(company_id,source_account_id,lower(cheque_number)) where direction='issued';

create or replace function public.validate_directional_cheque()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.accounts account where account.id=new.party_ledger_id and account.company_id=new.company_id and account.is_party and not coalesce(account.is_archived,false)) then
    raise exception 'Cheque party must be an active party ledger in the same company';
  end if;
  if new.direction='issued' and not exists(
    select 1 from public.accounts account join public.account_categories category on category.id=account.category_id
    where account.id=new.source_account_id and account.company_id=new.company_id and not coalesce(account.is_archived,false)
      and ((category.name in ('Bank Accounts','Bank') and category.account_type='Asset') or (category.name='Bank OD A/c' and category.account_type='Liability'))
  ) then raise exception 'Issued cheque source must be an active company Bank or Bank OD ledger'; end if;
  if new.status<>'cleared' and (new.linked_voucher_id is not null or new.cleared_to_account_id is not null or new.cleared_date_bs is not null or new.cleared_date_bs_key is not null) then
    raise exception 'Only cleared cheques may contain settlement metadata';
  end if;
  if new.status='cleared' and (new.linked_voucher_id is null or new.cleared_date_bs is null or new.cleared_date_bs_key is null) then
    raise exception 'Cleared cheque requires a linked voucher and clearing date';
  end if;
  return new;
end $$;
drop trigger if exists cheque_direction_guard on public.cheques;
create trigger cheque_direction_guard before insert or update on public.cheques for each row execute function public.validate_directional_cheque();

-- Superseded by validate_cheque_voucher_link below. The legacy trigger only
-- accepted Receipt vouchers and therefore rejected every issued-cheque Payment.
drop trigger if exists cleared_cheque_receipt_guard on public.cheques;

-- Keep the original external-bank validator for received cheques only.
drop trigger if exists cheque_touch_guard on public.cheques;
create trigger cheque_touch_guard before insert or update on public.cheques for each row when (new.direction='received') execute function public.cheque_touch_and_audit();
create or replace function public.issued_cheque_touch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at=now(); new.updated_by=auth.uid();
  if tg_op='UPDATE' and old.status<>'pending' and row(new.cheque_number,new.source_account_id,new.party_ledger_id,new.amount,new.issue_date,new.due_date,new.notes) is distinct from row(old.cheque_number,old.source_account_id,old.party_ledger_id,old.amount,old.issue_date,old.due_date,old.notes) then raise exception 'Completed cheques cannot be edited'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status then
    if old.status<>'pending' then raise exception 'Only pending cheques may change status'; end if;
    if new.status='cleared' and not public.has_company_permission(new.company_id,'cheque.mark_cleared') then raise exception 'Missing cheque.mark_cleared permission'; end if;
    if new.status='bounced' and not public.has_company_permission(new.company_id,'cheque.mark_bounced') then raise exception 'Missing cheque.mark_bounced permission'; end if;
    if new.status='cancelled' and not public.has_company_permission(new.company_id,'cheque.cancel') then raise exception 'Missing cheque.cancel permission'; end if;
    if new.status='cleared' then new.cleared_at=now(); elsif new.status='bounced' then new.bounced_at=now(); elsif new.status='cancelled' then new.cancelled_at=now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists issued_cheque_touch_guard on public.cheques;
create trigger issued_cheque_touch_guard before insert or update on public.cheques for each row when (new.direction='issued') execute function public.issued_cheque_touch();

create or replace function public.validate_cleared_cheque_voucher()
returns trigger language plpgsql security definer set search_path=public as $$
declare target public.cheques%rowtype; linked public.vouchers%rowtype; party_debit numeric; party_credit numeric; bank_debit numeric; bank_credit numeric;
begin
  if tg_table_name='cheques' then target:=new; else select * into target from public.cheques where linked_voucher_id=new.id; end if;
  if target.id is null or target.status<>'cleared' then return null; end if;
  select * into linked from public.vouchers where id=target.linked_voucher_id;
  if not found or linked.company_id<>target.company_id or linked.cancelled or linked.status<>'Completed' then raise exception 'Cleared cheque voucher is missing or inactive'; end if;
  select coalesce(sum(debit),0),coalesce(sum(credit),0) into party_debit,party_credit from public.voucher_lines where voucher_id=linked.id and account_id=target.party_ledger_id;
  if target.direction='issued' then
    select coalesce(sum(debit),0),coalesce(sum(credit),0) into bank_debit,bank_credit from public.voucher_lines where voucher_id=linked.id and account_id=target.source_account_id;
    if linked.type<>'Payment' or party_debit<>target.amount or party_credit<>0 or bank_credit<>target.amount or bank_debit<>0 then raise exception 'Issued cheque must link to a matching Payment voucher'; end if;
  else
    select coalesce(sum(debit),0),coalesce(sum(credit),0) into bank_debit,bank_credit from public.voucher_lines where voucher_id=linked.id and account_id=target.cleared_to_account_id;
    if linked.type<>'Receipt' or target.cleared_to_account_id is null or party_credit<>target.amount or party_debit<>0 or bank_debit<>target.amount or bank_credit<>0 then raise exception 'Received cheque must link to a matching Receipt voucher'; end if;
  end if;
  return null;
end $$;
drop trigger if exists validate_cheque_voucher_link on public.cheques;
create constraint trigger validate_cheque_voucher_link after insert or update of status,linked_voucher_id,cleared_date_bs on public.cheques deferrable initially deferred for each row execute function public.validate_cleared_cheque_voucher();

create or replace function public.clear_cheque_atomic(
  p_cheque_id uuid,p_date_ad date,p_date_bs text,p_date_bs_key integer,p_numbering_period text,p_invoice_prefix text,
  p_reset_numbering boolean,p_period_start_key integer,p_next_period_start_key integer,p_settlement_account_id text default null,p_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.cheques%rowtype; voucher_result jsonb; settlement_id text; voucher_type text; voucher_lines jsonb; voucher_header jsonb; cash_ledger text;
begin
  select * into target from public.cheques where id=p_cheque_id for update;
  if not found or target.company_id<>public.my_company_id() then raise exception 'Cheque not found'; end if;
  if target.status<>'pending' then
    if target.status='cleared' and target.linked_voucher_id is not null then return jsonb_build_object('cheque',to_jsonb(target),'voucher',public.voucher_atomic_response(target.linked_voucher_id)); end if;
    raise exception 'Only pending cheques can be cleared';
  end if;
  if not public.company_module_access(target.company_id,'cheque_management',true) or not public.has_company_permission(target.company_id,'cheque.mark_cleared') then raise exception 'Missing cheque clearing permission'; end if;
  if p_date_bs is null or p_date_bs_key is null then raise exception 'Clearing date is required'; end if;
  if target.direction='issued' then settlement_id:=target.source_account_id;voucher_type:='Payment';
    voucher_lines:=jsonb_build_array(jsonb_build_object('account_id',target.party_ledger_id,'debit',target.amount,'credit',0),jsonb_build_object('account_id',settlement_id,'debit',0,'credit',target.amount));
  else settlement_id:=p_settlement_account_id;voucher_type:='Receipt';
    if settlement_id is null then raise exception 'Select the Cash or Bank ledger receiving this cheque'; end if;
    voucher_lines:=jsonb_build_array(jsonb_build_object('account_id',settlement_id,'debit',target.amount,'credit',0),jsonb_build_object('account_id',target.party_ledger_id,'debit',0,'credit',target.amount));
  end if;
  if not exists(select 1 from public.accounts where id=settlement_id and company_id=target.company_id and not coalesce(is_archived,false)) then raise exception 'Cheque settlement ledger is unavailable'; end if;
  cash_ledger:=target.company_id::text||':cash';
  -- Voucher idempotency keys are UUIDs. The cheque UUID is stable and unique,
  -- making repeated or concurrent clearing requests return the same voucher.
  voucher_header:=jsonb_build_object('company_id',target.company_id,'type',voucher_type,'date',p_date_ad,'date_ad',p_date_ad,'date_bs',p_date_bs,'date_bs_key',p_date_bs_key,'numbering_period',p_numbering_period,'narration',(case when target.direction='issued' then 'Issued' else 'Received' end)||' cheque '||target.cheque_number||' cleared','party_account_id',target.party_ledger_id,'settlement_account_id',settlement_id,'is_cash',settlement_id in (cash_ledger,'cash'),'total',target.amount,'cancelled',false,'status','Completed','idempotency_key',target.id);
  voucher_result:=public.save_voucher_atomic(voucher_header,voucher_lines,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,null,p_invoice_prefix,p_reset_numbering,p_period_start_key,p_next_period_start_key,'cheque_cleared',jsonb_build_object('cheque_id',target.id,'direction',target.direction));
  update public.cheques set status='cleared',linked_voucher_id=(voucher_result->>'id')::uuid,cleared_date_bs=p_date_bs,cleared_date_bs_key=p_date_bs_key,cleared_to_account_id=case when target.direction='received' then settlement_id else null end,status_reason=nullif(btrim(coalesce(p_reason,'')),'') where id=target.id returning * into target;
  insert into public.cheque_events(company_id,cheque_id,action,new_values,actor_id) values(target.company_id,target.id,'cheque_cleared',jsonb_build_object('direction',target.direction,'linked_voucher_id',target.linked_voucher_id,'cleared_date_bs',p_date_bs),auth.uid());
  return jsonb_build_object('cheque',to_jsonb(target),'voucher',voucher_result);
end $$;

revoke all on function public.validate_directional_cheque() from public,anon,authenticated;
revoke all on function public.validate_cleared_cheque_voucher() from public,anon,authenticated;
revoke all on function public.issued_cheque_touch() from public,anon,authenticated;
revoke all on function public.clear_cheque_atomic(uuid,date,text,integer,text,text,boolean,integer,integer,text,text) from public,anon;
grant execute on function public.clear_cheque_atomic(uuid,date,text,integer,text,text,boolean,integer,integer,text,text) to authenticated;
commit;
notify pgrst,'reload schema';
