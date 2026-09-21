-- Allocate automatic voucher numbers exactly once.
--
-- The counter allocator already returns the newly reserved number. The
-- write-latency migration replaced the former MAX() lookup but left the
-- writer's old "+ 1" formatting in place, causing 2, 4, 6... numbering.
-- Manual Journal numbers bypass both allocation and counter synchronization.
begin;

do $migration$
declare
  atomic_sql text;
  patched_atomic_sql text;
  document_sql text;
  patched_document_sql text;
  old_allocation text := $old$
    select public.next_voucher_number(
      target_company, target_type,
      case when p_reset_numbering then coalesce(nullif(p_voucher->>'numbering_period', ''), 'all') else 'all' end
    ) into highest_number;
    generated_number := p_invoice_prefix || lpad((highest_number + 1)::text, 4, '0');
$old$;
  new_allocation text := $new$
    if target_type = 'Journal' and coalesce((
      select company.journal_numbering_mode
      from public.companies company
      where company.id = target_company
    ), 'auto') = 'manual' then
      generated_number := nullif(btrim(p_voucher->>'invoice_no'), '');
      if generated_number is null then
        raise exception 'Enter the Journal voucher number';
      end if;
    else
      select public.next_voucher_number(
        target_company, target_type,
        case when p_reset_numbering then coalesce(nullif(p_voucher->>'numbering_period', ''), 'all') else 'all' end
      ) into highest_number;
      generated_number := p_invoice_prefix || lpad(highest_number::text, 4, '0');
    end if;
$new$;
  old_document_call text := $old$
  result := public.save_voucher_atomic(
    p_voucher, p_lines, p_stock_lines, p_invoice_items, p_settlements,
$old$;
  new_document_call text := $new$
  result := public.save_voucher_atomic(
    case
      when nullif(p_voucher->>'type', '') = 'Journal' and normalized_manual_number is not null
        then jsonb_set(p_voucher, '{invoice_no}', to_jsonb(normalized_manual_number), true)
      else p_voucher
    end,
    p_lines, p_stock_lines, p_invoice_items, p_settlements,
$new$;
begin
  select pg_get_functiondef(
    'public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure
  ) into atomic_sql;
  if atomic_sql is null then
    raise exception 'save_voucher_atomic() is missing';
  end if;

  patched_atomic_sql := atomic_sql;
  if position(old_allocation in patched_atomic_sql) > 0 then
    patched_atomic_sql := replace(patched_atomic_sql, old_allocation, new_allocation);
  elsif position('generated_number := p_invoice_prefix || lpad(highest_number::text, 4, ''0'');' in patched_atomic_sql) = 0
    or position('journal_numbering_mode' in patched_atomic_sql) = 0 then
    raise exception 'The deployed atomic voucher writer has an unsupported numbering structure';
  end if;
  if patched_atomic_sql is distinct from atomic_sql then
    execute patched_atomic_sql;
  end if;

  select pg_get_functiondef(
    'public.save_voucher_with_document_metadata_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text)'::regprocedure
  ) into document_sql;
  if document_sql is null then
    raise exception 'save_voucher_with_document_metadata_atomic() is missing';
  end if;

  patched_document_sql := document_sql;
  if position(old_document_call in patched_document_sql) > 0 then
    patched_document_sql := replace(patched_document_sql, old_document_call, new_document_call);
  elsif position('jsonb_set(p_voucher, ''{invoice_no}'', to_jsonb(normalized_manual_number), true)' in patched_document_sql) = 0 then
    raise exception 'The deployed voucher document wrapper has an unsupported structure';
  end if;
  if patched_document_sql is distinct from document_sql then
    execute patched_document_sql;
  end if;
end;
$migration$;

create or replace function public.sync_voucher_number_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare parsed_number bigint;
begin
  if new.invoice_no is null then return new; end if;
  if new.type = 'Journal' and coalesce((
    select company.journal_numbering_mode
    from public.companies company
    where company.id = new.company_id
  ), 'auto') = 'manual' then
    return new;
  end if;
  parsed_number := nullif(substring(new.invoice_no from '([0-9]+)$'), '')::bigint;
  if parsed_number is null then return new; end if;
  insert into public.voucher_number_counters(company_id, voucher_type, numbering_period, last_number)
  values (new.company_id, new.type, coalesce(new.numbering_period, 'all'), parsed_number)
  on conflict (company_id, voucher_type, numbering_period)
  do update set last_number = greatest(public.voucher_number_counters.last_number, excluded.last_number), updated_at = now();
  insert into public.voucher_number_counters(company_id, voucher_type, numbering_period, last_number)
  values (new.company_id, new.type, 'all', parsed_number)
  on conflict (company_id, voucher_type, numbering_period)
  do update set last_number = greatest(public.voucher_number_counters.last_number, excluded.last_number), updated_at = now();
  return new;
end;
$$;

revoke all on function public.sync_voucher_number_counter() from public, anon, authenticated;

do $verification$
declare
  atomic_sql text;
  document_sql text;
  counter_sql text;
  allocator_calls integer;
begin
  select pg_get_functiondef(
    'public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure
  ) into atomic_sql;
  select pg_get_functiondef(
    'public.save_voucher_with_document_metadata_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text)'::regprocedure
  ) into document_sql;
  select pg_get_functiondef('public.sync_voucher_number_counter()'::regprocedure)
    into counter_sql;

  allocator_calls := (
    length(atomic_sql) - length(replace(atomic_sql, 'next_voucher_number', ''))
  ) / length('next_voucher_number');

  if allocator_calls <> 1
    or position('lpad((highest_number + 1)' in atomic_sql) > 0
    or position('lpad(highest_number::text, 4, ''0'')' in atomic_sql) = 0 then
    raise exception 'Voucher automatic numbering still allocates incorrectly';
  end if;
  if position('journal_numbering_mode' in atomic_sql) = 0
    or position('jsonb_set(p_voucher, ''{invoice_no}'', to_jsonb(normalized_manual_number), true)' in document_sql) = 0
    or position('journal_numbering_mode' in counter_sql) = 0 then
    raise exception 'Manual Journal numbering still modifies the automatic sequence';
  end if;
end;
$verification$;

notify pgrst, 'reload schema';
commit;
