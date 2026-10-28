-- Reduce ordinary voucher latency without weakening direct-write integrity.
-- Apply after 202608170002_voucher_validation_once.sql.
begin;

-- The legacy balance trigger ran once for every changed ledger row at commit.
-- Schedule the same validator once per voucher/transaction instead.
drop trigger if exists voucher_lines_balance_guard on public.voucher_lines;
drop trigger if exists voucher_lines_balance_guard_write on public.voucher_lines;
drop trigger if exists voucher_lines_balance_guard_delete on public.voucher_lines;
create constraint trigger voucher_lines_balance_guard_write
after insert or update on public.voucher_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('balance', new.voucher_id))
execute function public.validate_voucher_balance();
create constraint trigger voucher_lines_balance_guard_delete
after delete on public.voucher_lines
deferrable initially deferred for each row
when (public.schedule_validation_once('balance', old.voucher_id))
execute function public.validate_voucher_balance();

-- seq is an internal stable ordering key. A global sequence removes the need
-- to calculate max(seq) while holding a company-wide transaction lock.
create sequence if not exists public.voucher_global_seq as bigint;
grant usage, select on sequence public.voucher_global_seq to authenticated;
select setval(
  'public.voucher_global_seq',
  greatest(coalesce((select max(seq)::bigint from public.vouchers), 0), 1),
  exists(select 1 from public.vouchers)
);

create table if not exists public.voucher_number_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  voucher_type text not null,
  numbering_period text not null,
  last_number bigint not null check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, voucher_type, numbering_period)
);
alter table public.voucher_number_counters enable row level security;
revoke all on public.voucher_number_counters from public, anon, authenticated;

create or replace function public.next_voucher_number(
  target_company_id uuid,
  target_voucher_type text,
  target_numbering_period text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare result bigint;
begin
  if auth.uid() is null or not public.is_company_member(target_company_id) then
    raise exception 'Voucher company access denied' using errcode = '42501';
  end if;
  insert into public.voucher_number_counters(company_id, voucher_type, numbering_period, last_number)
  values (
    target_company_id,
    target_voucher_type,
    target_numbering_period,
    coalesce((
      select max((substring(voucher.invoice_no from '([0-9]+)$'))::bigint)
      from public.vouchers voucher
      where voucher.company_id = target_company_id
        and voucher.type = target_voucher_type
        and (target_numbering_period = 'all' or voucher.numbering_period = target_numbering_period)
        and substring(voucher.invoice_no from '([0-9]+)$') is not null
    ), 0) + 1
  )
  on conflict (company_id, voucher_type, numbering_period)
  do update set last_number = public.voucher_number_counters.last_number + 1, updated_at = now()
  returning last_number into result;
  return result;
end;
$$;
revoke all on function public.next_voucher_number(uuid,text,text) from public, anon;
grant execute on function public.next_voucher_number(uuid,text,text) to authenticated;

create or replace function public.sync_voucher_number_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare parsed_number bigint;
begin
  if new.invoice_no is null then return new; end if;
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
drop trigger if exists vouchers_sync_number_counter on public.vouchers;
create trigger vouchers_sync_number_counter
after insert or update of invoice_no, type, numbering_period on public.vouchers
for each row execute function public.sync_voucher_number_counter();

-- Patch the deployed atomic writer in place so later domain additions to the
-- function are retained. Voucher numbering is serialized only within its
-- company/type/period; stock is serialized only for affected items.
do $migration$
declare
  function_sql text;
  patched_sql text;
  old_lock text := $old$
  posting_stage := 'company_write_lock';
  perform pg_advisory_xact_lock(hashtextextended(target_company::text, 0));
$old$;
  new_lock text := $new$
  posting_stage := 'scoped_write_locks';
  if p_voucher_id is null then
    perform pg_advisory_xact_lock(hashtextextended(
      'voucher-number:' || target_company::text || ':' || coalesce(target_type, '') || ':' ||
      case when p_reset_numbering then coalesce(nullif(p_voucher->>'numbering_period', ''), 'all') else 'all' end, 0
    ));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'voucher-stock:' || target_company::text || ':' || affected.item_id::text, 0
  ))
  from (
      select distinct line.item_id
      from jsonb_to_recordset(coalesce(p_stock_lines, '[]'::jsonb)) as line(item_id uuid)
      where line.item_id is not null
      union
      select distinct stock_line.item_id
      from public.stock_lines stock_line
      where p_voucher_id is not null and stock_line.voucher_id = p_voucher_id
  ) affected
  order by affected.item_id;
$new$;
  old_number_scan text := $old$
    select coalesce(max((substring(voucher.invoice_no from '([0-9]+)$'))::bigint), 0)
      into highest_number
    from public.vouchers voucher
    where voucher.company_id = target_company
      and voucher.type = target_type
      and substring(voucher.invoice_no from '([0-9]+)$') is not null
      and (
        not p_reset_numbering
        or voucher.numbering_period = coalesce(nullif(p_voucher->>'numbering_period', ''), 'all')
      );
$old$;
  new_number_call text := $new$
    select public.next_voucher_number(
      target_company, target_type,
      case when p_reset_numbering then coalesce(nullif(p_voucher->>'numbering_period', ''), 'all') else 'all' end
    ) into highest_number;
$new$;
begin
  select pg_get_functiondef(
    'public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure
  ) into function_sql;
  if function_sql is null then
    raise exception 'save_voucher_atomic is missing';
  end if;

  patched_sql := function_sql;
  if position(old_lock in patched_sql) > 0 then
    patched_sql := replace(patched_sql, old_lock, new_lock);
  elsif position('voucher-number:' in patched_sql) = 0 then
    -- Deployed functions may have been reformatted by an earlier dynamic
    -- migration. Remove the known statements independently, then insert the
    -- scoped block at the unique create-voucher branch.
    patched_sql := replace(patched_sql, 'perform pg_advisory_xact_lock(hashtextextended(target_company::text, 0));', '');
    patched_sql := replace(patched_sql, 'posting_stage := ''company_write_lock'';', '');
    patched_sql := replace(
      patched_sql,
      '  if p_voucher_id is null then' || E'\n    if target_type is null or p_invoice_prefix is null then',
      new_lock || E'\n\n  if p_voucher_id is null then\n    if target_type is null or p_invoice_prefix is null then'
    );
    if position('voucher-number:' in patched_sql) = 0 then
      raise notice 'Scoped lock insertion was skipped because the deployed atomic writer has an unknown structure';
    end if;
  end if;
  patched_sql := replace(
    patched_sql,
    'select coalesce(max(voucher.seq), 0) + 1 into next_seq' || E'\n    from public.vouchers voucher where voucher.company_id = target_company;',
    'select nextval(''public.voucher_global_seq'')::integer into next_seq;'
  );
  if position('nextval(''public.voucher_global_seq'')' in patched_sql) = 0 then
    raise notice 'Global sequence replacement was skipped because the deployed atomic writer has an unknown structure';
  end if;
  if position(old_number_scan in patched_sql) > 0 then
    patched_sql := replace(patched_sql, old_number_scan, new_number_call);
  elsif position('public.next_voucher_number(' in patched_sql) = 0 then
    raise notice 'Voucher counter replacement was skipped because the deployed atomic writer has an unknown structure';
  end if;
  execute patched_sql;
end;
$migration$;

-- Cover the affected-item stock scan and common numbering lookup without
-- adding overlapping indexes for already-covered child lookups.
create index if not exists stock_lines_item_condition_voucher_cover_idx
  on public.stock_lines (item_id, stock_condition, voucher_id)
  include (direction, qty);
create index if not exists vouchers_numbering_lookup_idx
  on public.vouchers (company_id, type, numbering_period, invoice_no)
  where invoice_no is not null;

analyze public.vouchers;
analyze public.voucher_lines;
analyze public.stock_lines;

commit;
notify pgrst, 'reload schema';
