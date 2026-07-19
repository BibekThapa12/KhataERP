-- Read-only pre-deployment RLS audit. Run in the Supabase SQL Editor after all
-- migrations. Expected result: zero rows from both queries.

-- Public tables without Row Level Security.
select namespace.nspname as schema_name, class.relname as table_name
from pg_class class
join pg_namespace namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'public'
  and class.relkind in ('r', 'p')
  and not class.relrowsecurity
order by class.relname;

-- RLS-enabled public tables without any policy. An empty-policy table is
-- deny-by-default, but this identifies incomplete application configuration.
select class.relname as table_name
from pg_class class
join pg_namespace namespace on namespace.oid = class.relnamespace
where namespace.nspname = 'public'
  and class.relkind in ('r', 'p')
  and class.relrowsecurity
  and not exists (
    select 1 from pg_policy policy where policy.polrelid = class.oid
  )
order by class.relname;
