-- Read-only write-performance diagnostics. Run after a representative test
-- workload. This file does not change schema, data, RLS, or configuration.

-- Database-only statement execution (requires pg_stat_statements, normally
-- available in Supabase). Values exclude browser processing and most client
-- network latency.
select
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 240) as normalized_query
from pg_stat_statements
where query ~* '(insert|update|delete).*(vouchers|voucher_lines|stock_lines|invoice_items|voucher_settlements|accounts|parties|items|account_categories|item_categories|master_change_logs|app_events)'
order by total_exec_time desc
limit 50;

-- Trigger/function time is populated when PostgreSQL track_functions is
-- enabled by the project. Zero rows means the project is not collecting it;
-- do not infer that triggers are free.
select
  schemaname,
  funcname,
  calls,
  round(total_time::numeric, 2) as total_ms,
  round(self_time::numeric, 2) as self_ms,
  case when calls > 0 then round((total_time / calls)::numeric, 3) else 0 end as mean_ms
from pg_stat_user_functions
where funcname in (
  'validate_voucher_balance',
  'validate_voucher_settlement',
  'save_voucher_atomic',
  'validate_account_category_hierarchy',
  'validate_item_category_hierarchy'
)
order by total_time desc;

-- Verify the indexes used by current write validation and foreign-key paths.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('vouchers','voucher_lines','stock_lines','invoice_items','voucher_settlements','accounts','parties','items')
order by tablename, indexname;

-- Phase 5 representative plans. These are read-only SELECT equivalents of
-- lookups executed during atomic posting and category writes. PostgreSQL may
-- correctly choose a sequential scan for very small test tables; compare the
-- estimated/actual rows and buffers rather than treating every Seq Scan as a
-- defect.
explain (analyze, buffers, verbose)
with sample_company as (
  select company_id
  from public.vouchers
  group by company_id
  order by count(*) desc
  limit 1
)
select max(voucher.seq)
from public.vouchers voucher
join sample_company sample on sample.company_id = voucher.company_id;

explain (analyze, buffers, verbose)
with sample_scope as (
  select company_id, type, numbering_period
  from public.vouchers
  where invoice_no is not null
  group by company_id, type, numbering_period
  order by count(*) desc
  limit 1
)
select max((substring(voucher.invoice_no from '([0-9]+)$'))::bigint)
from public.vouchers voucher
join sample_scope sample
  on sample.company_id = voucher.company_id
 and sample.type = voucher.type
 and sample.numbering_period = voucher.numbering_period
where voucher.invoice_no is not null;

explain (analyze, buffers, verbose)
select account.id
from public.accounts account
where account.category_id = (
  select category_id from public.accounts
  where category_id is not null
  limit 1
);

explain (analyze, buffers, verbose)
select line.id
from public.voucher_lines line
where line.voucher_id = (select voucher_id from public.voucher_lines limit 1);

explain (analyze, buffers, verbose)
select line.id
from public.stock_lines line
where line.voucher_id = (select voucher_id from public.stock_lines limit 1);

explain (analyze, buffers, verbose)
select item.id
from public.invoice_items item
where item.voucher_id = (select voucher_id from public.invoice_items limit 1);

-- Index use and size after a representative Phase 4 workload. Low idx_scan on
-- a newly created or tiny table is not enough reason to remove an index.
select
  stats.relname as table_name,
  stats.indexrelname as index_name,
  stats.idx_scan,
  stats.idx_tup_read,
  stats.idx_tup_fetch,
  pg_size_pretty(pg_relation_size(stats.indexrelid)) as index_size
from pg_stat_user_indexes stats
where stats.schemaname = 'public'
  and stats.relname in (
    'companies','accounts','parties','items','vouchers','voucher_lines',
    'stock_lines','invoice_items','voucher_settlements','app_events'
  )
order by stats.relname, stats.indexrelname;

-- Foreign keys without a supporting index whose leading columns exactly match
-- the FK. This is an audit list, not an instruction to index every result:
-- indexes are mainly justified when referenced rows are actually updated or
-- deleted often enough to make the FK check measurable.
select
  constraint_record.conrelid::regclass as child_table,
  constraint_record.conname as foreign_key,
  pg_get_constraintdef(constraint_record.oid) as definition
from pg_constraint constraint_record
where constraint_record.contype = 'f'
  and constraint_record.connamespace = 'public'::regnamespace
  and not exists (
    select 1
    from pg_index index_record
    where index_record.indrelid = constraint_record.conrelid
      and index_record.indisvalid
      and cardinality(index_record.indkey::smallint[]) >= cardinality(constraint_record.conkey)
      and not exists (
        select 1
        from generate_subscripts(constraint_record.conkey, 1) position
        where constraint_record.conkey[position]
          <> (index_record.indkey::smallint[])[position - 1]
      )
  )
order by constraint_record.conrelid::regclass::text, constraint_record.conname;

-- Phase 6 trigger inventory: frequency is per ROW or STATEMENT as shown.
-- Internal constraint triggers are excluded; enabled='O' means normal.
select
  trigger_record.tgrelid::regclass as table_name,
  trigger_record.tgname as trigger_name,
  case when trigger_record.tgtype & 1 = 1 then 'ROW' else 'STATEMENT' end as frequency,
  case
    when trigger_record.tgtype & 2 = 2 then 'BEFORE'
    when trigger_record.tgtype & 64 = 64 then 'INSTEAD OF'
    else 'AFTER'
  end as timing,
  concat_ws(', ',
    case when trigger_record.tgtype & 4 = 4 then 'INSERT' end,
    case when trigger_record.tgtype & 8 = 8 then 'DELETE' end,
    case when trigger_record.tgtype & 16 = 16 then 'UPDATE' end,
    case when trigger_record.tgtype & 32 = 32 then 'TRUNCATE' end
  ) as events,
  trigger_record.tgdeferrable,
  trigger_record.tginitdeferred,
  function_record.proname as function_name,
  pg_get_triggerdef(trigger_record.oid) as definition
from pg_trigger trigger_record
join pg_proc function_record on function_record.oid = trigger_record.tgfoid
where not trigger_record.tgisinternal
  and trigger_record.tgrelid::regclass::text in (
    'companies','account_categories','item_categories','vouchers','voucher_lines',
    'stock_lines','invoice_items','voucher_settlements','cheque_banks','cheques',
    'cheque_events','accounts','parties','items','app_events'
  )
order by trigger_record.tgrelid::regclass::text, trigger_record.tgname;

-- Legacy issuing-bank names that prevent a unique case-insensitive index.
-- Phase 6 leaves these records untouched and uses a non-unique lookup index.
select
  company_id,
  lower(bank_name) as normalized_bank_name,
  count(*) as records,
  array_agg(id order by created_at, id) as bank_ids
from public.cheque_banks
group by company_id, lower(bank_name)
having count(*) > 1
order by company_id, normalized_bank_name;

-- Trigger/function totals after a representative workload. Requires
-- track_functions; zero rows means timing collection is disabled.
select
  functions.schemaname,
  functions.funcname,
  functions.calls,
  round(functions.total_time::numeric, 3) as total_ms,
  round(functions.self_time::numeric, 3) as self_ms,
  case when functions.calls > 0
    then round((functions.total_time / functions.calls)::numeric, 4)
    else 0 end as mean_ms
from pg_stat_user_functions functions
where functions.funcname in (
  'validate_voucher_balance','validate_voucher_settlement',
  'validate_account_category_hierarchy','validate_item_category_hierarchy',
  'protect_system_account_category','seed_system_account_groups_for_company',
  'seed_cheque_banks_on_entitlement','validate_cheque_bank',
  'cheque_touch_and_audit'
)
order by functions.total_time desc;

-- Phase 7 effective policy definitions. Review qual/with_check to verify that
-- tenant, entitlement, and permission predicates remain present.
select
  schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'companies','accounts','account_categories','parties','items',
    'item_categories','master_change_logs','vouchers','voucher_lines',
    'stock_lines','invoice_items','voucher_settlements','app_events','modules',
    'company_modules','company_user_permissions','cheque_banks','cheques',
    'cheque_events'
  )
order by tablename, policyname;

-- Current non-idle locks on write-related tables. Run while reproducing a slow
-- write to distinguish index/query cost from lock waiting.
select
  activity.pid,
  activity.state,
  activity.wait_event_type,
  activity.wait_event,
  lock_record.relation::regclass as relation,
  lock_record.mode,
  lock_record.granted,
  left(activity.query, 180) as query
from pg_locks lock_record
join pg_stat_activity activity on activity.pid = lock_record.pid
where lock_record.relation::regclass::text in (
  'companies','accounts','account_categories','parties','items','vouchers',
  'voucher_lines','stock_lines','invoice_items','voucher_settlements',
  'cheque_banks','cheques','cheque_events','app_events'
)
  and activity.state <> 'idle'
order by lock_record.granted, activity.query_start;

-- Phases 12-16 verification: idempotency support and atomic-posting timing.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'vouchers'
  and indexname = 'vouchers_company_idempotency_unique';

select
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 240) as normalized_query
from pg_stat_statements
where query ilike '%save_voucher_atomic%'
order by total_exec_time desc;

-- One voucher audit event is expected per successful unique request. Reusing
-- an idempotency key must return the existing voucher without another event.
select
  metadata->>'voucher_id' as voucher_id,
  count(*) as audit_events,
  min(created_at) as first_event,
  max(created_at) as last_event
from public.app_events
where event_type in ('voucher_created','voucher_updated','return_created','stock_adjustment')
  and metadata ? 'voucher_id'
group by metadata->>'voucher_id'
having count(*) > 1
order by audit_events desc, voucher_id;

-- Same-company voucher posts may briefly wait on one advisory transaction
-- lock. Long waits here indicate an unexpectedly long posting transaction.
select
  activity.pid,
  activity.state,
  activity.xact_start,
  now() - activity.xact_start as transaction_age,
  activity.wait_event_type,
  activity.wait_event,
  lock_record.classid,
  lock_record.objid,
  lock_record.granted,
  left(activity.query, 180) as query
from pg_locks lock_record
join pg_stat_activity activity on activity.pid = lock_record.pid
where lock_record.locktype = 'advisory'
order by lock_record.granted, activity.xact_start;
