-- Phase 4: atomic voucher posting.
-- Apply after the base schema, integrity, alternative-unit, multiple-bank, and
-- voucher-settlement migrations. Safe to run repeatedly.
begin;

create or replace function public.save_voucher_atomic(
  p_voucher jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_stock_lines jsonb default '[]'::jsonb,
  p_invoice_items jsonb default '[]'::jsonb,
  p_settlements jsonb default '[]'::jsonb,
  p_voucher_id uuid default null,
  p_invoice_prefix text default null,
  p_reset_numbering boolean default false,
  p_period_start_key integer default null,
  p_next_period_start_key integer default null,
  p_audit_event_type text default null,
  p_audit_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved public.vouchers%rowtype;
  target_company uuid;
  target_type text;
  next_seq integer;
  highest_number bigint;
  generated_number text;
  debit_total numeric(14,2);
  credit_total numeric(14,2);
  result jsonb;
begin
  if p_voucher is null or jsonb_typeof(p_voucher) <> 'object' then
    raise exception 'Voucher payload must be an object';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_stock_lines, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_invoice_items, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_settlements, '[]'::jsonb)) <> 'array' then
    raise exception 'Voucher child payloads must be arrays';
  end if;

  select coalesce(sum(coalesce(line.debit, 0)), 0),
         coalesce(sum(coalesce(line.credit, 0)), 0)
    into debit_total, credit_total
  from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
    as line(account_id text, debit numeric, credit numeric);
  if abs(debit_total - credit_total) > 0.01 then
    raise exception 'Voucher is not balanced: debit %, credit %', debit_total, credit_total;
  end if;

  if p_voucher_id is null then
    target_company := nullif(p_voucher->>'company_id', '')::uuid;
    target_type := nullif(p_voucher->>'type', '');
  else
    select * into saved from public.vouchers where id = p_voucher_id for update;
    if not found then raise exception 'Voucher not found'; end if;
    target_company := saved.company_id;
    target_type := saved.type;
    if p_voucher ? 'company_id' and nullif(p_voucher->>'company_id', '')::uuid is distinct from target_company then
      raise exception 'Voucher company cannot be changed';
    end if;
  end if;

  if target_company is null or target_company is distinct from public.my_company_id() then
    raise exception 'Voucher company access denied' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as line(account_id text)
    left join public.accounts account on account.id = line.account_id and account.company_id = target_company
    where account.id is null
  ) then raise exception 'Every voucher ledger must belong to the voucher company'; end if;

  if nullif(p_voucher->>'party_account_id', '') is not null and not exists (
    select 1 from public.accounts account
    where account.id = p_voucher->>'party_account_id' and account.company_id = target_company
  ) then raise exception 'Voucher party ledger must belong to the voucher company'; end if;
  if nullif(p_voucher->>'settlement_account_id', '') is not null and not exists (
    select 1 from public.accounts account
    where account.id = p_voucher->>'settlement_account_id' and account.company_id = target_company
  ) then raise exception 'Voucher settlement ledger must belong to the voucher company'; end if;
  if nullif(p_voucher->>'original_voucher_id', '') is not null and not exists (
    select 1 from public.vouchers voucher
    where voucher.id = nullif(p_voucher->>'original_voucher_id', '')::uuid
      and voucher.company_id = target_company
  ) then raise exception 'Original voucher must belong to the voucher company'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_stock_lines, '[]'::jsonb)) as line(item_id uuid)
    left join public.items item on item.id = line.item_id and item.company_id = target_company
    where item.id is null
  ) or exists (
    select 1
    from jsonb_to_recordset(coalesce(p_invoice_items, '[]'::jsonb)) as line(item_id uuid)
    left join public.items item on item.id = line.item_id and item.company_id = target_company
    where item.id is null
  ) then raise exception 'Every voucher item must belong to the voucher company'; end if;

  if p_voucher_id is null then
    if target_type is null or p_invoice_prefix is null then
      raise exception 'Voucher type and numbering prefix are required';
    end if;

    -- Serializes numbering only within this company. The lock is released on
    -- commit/rollback, so concurrent companies remain independent.
    perform pg_advisory_xact_lock(hashtextextended(target_company::text, 0));
    select coalesce(max(voucher.seq), 0) + 1 into next_seq
    from public.vouchers voucher where voucher.company_id = target_company;

    select coalesce(max((substring(voucher.invoice_no from '([0-9]+)$'))::bigint), 0)
      into highest_number
    from public.vouchers voucher
    where voucher.company_id = target_company
      and voucher.type = target_type
      and substring(voucher.invoice_no from '([0-9]+)$') is not null
      and (
        not p_reset_numbering
        or (p_period_start_key is not null and p_next_period_start_key is not null
          and voucher.date_bs_key >= p_period_start_key
          and voucher.date_bs_key < p_next_period_start_key)
      );
    generated_number := p_invoice_prefix || lpad((highest_number + 1)::text, 4, '0');

    insert into public.vouchers (
      company_id, type, date, date_ad, date_bs, date_bs_key, invoice_no,
      numbering_period, credit_days, due_date_ad, due_date_bs, due_date_bs_key,
      narration, original_voucher_id, return_reason, settlement_mode,
      settlement_account_id, restock_items, party_account_id, is_cash,
      subtotal, discount, vat_rate, vat_amount, total, cancelled, seq
    ) values (
      target_company, target_type,
      (p_voucher->>'date')::date, (p_voucher->>'date_ad')::date,
      p_voucher->>'date_bs', (p_voucher->>'date_bs_key')::integer,
      generated_number, coalesce(nullif(p_voucher->>'numbering_period', ''), 'all'),
      nullif(p_voucher->>'credit_days', '')::integer,
      nullif(p_voucher->>'due_date_ad', '')::date, nullif(p_voucher->>'due_date_bs', ''),
      nullif(p_voucher->>'due_date_bs_key', '')::integer, nullif(p_voucher->>'narration', ''),
      nullif(p_voucher->>'original_voucher_id', '')::uuid, nullif(p_voucher->>'return_reason', ''),
      nullif(p_voucher->>'settlement_mode', ''), nullif(p_voucher->>'settlement_account_id', ''),
      coalesce((p_voucher->>'restock_items')::boolean, false), nullif(p_voucher->>'party_account_id', ''),
      coalesce((p_voucher->>'is_cash')::boolean, false), nullif(p_voucher->>'subtotal', '')::numeric,
      nullif(p_voucher->>'discount', '')::numeric, nullif(p_voucher->>'vat_rate', '')::numeric,
      nullif(p_voucher->>'vat_amount', '')::numeric, coalesce((p_voucher->>'total')::numeric, 0),
      coalesce((p_voucher->>'cancelled')::boolean, false), next_seq
    ) returning * into saved;
  else
    update public.vouchers voucher set
      date = case when p_voucher ? 'date' then (p_voucher->>'date')::date else voucher.date end,
      date_ad = case when p_voucher ? 'date_ad' then (p_voucher->>'date_ad')::date else voucher.date_ad end,
      date_bs = case when p_voucher ? 'date_bs' then p_voucher->>'date_bs' else voucher.date_bs end,
      date_bs_key = case when p_voucher ? 'date_bs_key' then (p_voucher->>'date_bs_key')::integer else voucher.date_bs_key end,
      numbering_period = case when p_voucher ? 'numbering_period' then p_voucher->>'numbering_period' else voucher.numbering_period end,
      credit_days = case when p_voucher ? 'credit_days' then nullif(p_voucher->>'credit_days', '')::integer else voucher.credit_days end,
      due_date_ad = case when p_voucher ? 'due_date_ad' then nullif(p_voucher->>'due_date_ad', '')::date else voucher.due_date_ad end,
      due_date_bs = case when p_voucher ? 'due_date_bs' then nullif(p_voucher->>'due_date_bs', '') else voucher.due_date_bs end,
      due_date_bs_key = case when p_voucher ? 'due_date_bs_key' then nullif(p_voucher->>'due_date_bs_key', '')::integer else voucher.due_date_bs_key end,
      narration = case when p_voucher ? 'narration' then nullif(p_voucher->>'narration', '') else voucher.narration end,
      original_voucher_id = case when p_voucher ? 'original_voucher_id' then nullif(p_voucher->>'original_voucher_id', '')::uuid else voucher.original_voucher_id end,
      return_reason = case when p_voucher ? 'return_reason' then nullif(p_voucher->>'return_reason', '') else voucher.return_reason end,
      settlement_mode = case when p_voucher ? 'settlement_mode' then nullif(p_voucher->>'settlement_mode', '') else voucher.settlement_mode end,
      settlement_account_id = case when p_voucher ? 'settlement_account_id' then nullif(p_voucher->>'settlement_account_id', '') else voucher.settlement_account_id end,
      restock_items = case when p_voucher ? 'restock_items' then (p_voucher->>'restock_items')::boolean else voucher.restock_items end,
      party_account_id = case when p_voucher ? 'party_account_id' then nullif(p_voucher->>'party_account_id', '') else voucher.party_account_id end,
      is_cash = case when p_voucher ? 'is_cash' then (p_voucher->>'is_cash')::boolean else voucher.is_cash end,
      subtotal = case when p_voucher ? 'subtotal' then nullif(p_voucher->>'subtotal', '')::numeric else voucher.subtotal end,
      discount = case when p_voucher ? 'discount' then nullif(p_voucher->>'discount', '')::numeric else voucher.discount end,
      vat_rate = case when p_voucher ? 'vat_rate' then nullif(p_voucher->>'vat_rate', '')::numeric else voucher.vat_rate end,
      vat_amount = case when p_voucher ? 'vat_amount' then nullif(p_voucher->>'vat_amount', '')::numeric else voucher.vat_amount end,
      total = case when p_voucher ? 'total' then (p_voucher->>'total')::numeric else voucher.total end,
      cancelled = case when p_voucher ? 'cancelled' then (p_voucher->>'cancelled')::boolean else voucher.cancelled end
    where voucher.id = p_voucher_id and voucher.company_id = target_company
    returning * into saved;

    delete from public.voucher_settlements where settlement_voucher_id = saved.id;
    delete from public.invoice_items where voucher_id = saved.id;
    delete from public.stock_lines where voucher_id = saved.id;
    delete from public.voucher_lines where voucher_id = saved.id;
  end if;

  insert into public.voucher_lines (voucher_id, account_id, debit, credit)
  select saved.id, line.account_id, coalesce(line.debit, 0), coalesce(line.credit, 0)
  from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
    as line(account_id text, debit numeric, credit numeric);

  insert into public.stock_lines (voucher_id, item_id, qty, rate, direction, stock_condition, is_transfer)
  select saved.id, line.item_id, line.qty, line.rate, line.direction,
         coalesce(line.stock_condition, 'saleable'), coalesce(line.is_transfer, false)
  from jsonb_to_recordset(coalesce(p_stock_lines, '[]'::jsonb))
    as line(item_id uuid, qty numeric, rate numeric, direction text, stock_condition text, is_transfer boolean);

  insert into public.invoice_items (
    voucher_id, item_id, qty, rate, source_invoice_item_id, item_name, unit,
    entry_unit, conversion_factor, base_qty, discount_amount, taxable_amount,
    vat_amount, cost_rate
  )
  select saved.id, item.item_id, item.qty, item.rate, item.source_invoice_item_id,
         item.item_name, item.unit, item.entry_unit, coalesce(item.conversion_factor, 1),
         item.base_qty, item.discount_amount, item.taxable_amount, item.vat_amount, item.cost_rate
  from jsonb_to_recordset(coalesce(p_invoice_items, '[]'::jsonb)) as item(
    item_id uuid, qty numeric, rate numeric, source_invoice_item_id uuid,
    item_name text, unit text, entry_unit text, conversion_factor numeric,
    base_qty numeric, discount_amount numeric, taxable_amount numeric,
    vat_amount numeric, cost_rate numeric
  );

  insert into public.voucher_settlements (
    company_id, settlement_voucher_id, invoice_voucher_id, party_account_id, amount
  )
  select target_company, saved.id, settlement.invoice_voucher_id,
         settlement.party_account_id, settlement.amount
  from jsonb_to_recordset(coalesce(p_settlements, '[]'::jsonb))
    as settlement(invoice_voucher_id uuid, party_account_id text, amount numeric);

  insert into public.app_events (company_id, user_id, event_type, metadata)
  values (
    target_company, auth.uid(),
    coalesce(nullif(p_audit_event_type, ''), case when p_voucher_id is null then 'voucher_created' else 'voucher_updated' end),
    coalesce(p_audit_metadata, '{}'::jsonb) || jsonb_build_object(
      'voucher_id', saved.id, 'type', saved.type,
      'ledger_line_count', jsonb_array_length(coalesce(p_lines, '[]'::jsonb)),
      'stock_line_count', jsonb_array_length(coalesce(p_stock_lines, '[]'::jsonb)),
      'invoice_item_count', jsonb_array_length(coalesce(p_invoice_items, '[]'::jsonb))
    )
  );

  select to_jsonb(saved) || jsonb_build_object(
    'lines', coalesce((select jsonb_agg(to_jsonb(line)) from public.voucher_lines line where line.voucher_id = saved.id), '[]'::jsonb),
    'stock_lines', coalesce((select jsonb_agg(to_jsonb(line)) from public.stock_lines line where line.voucher_id = saved.id), '[]'::jsonb),
    'invoice_items', coalesce((select jsonb_agg(to_jsonb(item)) from public.invoice_items item where item.voucher_id = saved.id), '[]'::jsonb),
    'settlements', coalesce((select jsonb_agg(to_jsonb(settlement)) from public.voucher_settlements settlement where settlement.settlement_voucher_id = saved.id), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb) from public;
grant execute on function public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb) to authenticated;

commit;
notify pgrst, 'reload schema';
