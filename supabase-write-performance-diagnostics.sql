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
