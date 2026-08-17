begin;

create table if not exists public.performance_samples (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null,
  operation text not null check (operation ~ '^[a-z0-9_]{1,80}$'),
  record_type text not null check (length(record_type) between 1 and 80),
  duration_ms numeric(12,2) not null check (duration_ms >= 0),
  success boolean not null,
  line_items integer not null default 0 check (line_items between 0 and 10000),
  query_count integer not null default 0 check (query_count between 0 and 1000),
  network_class text check (network_class is null or length(network_class) <= 30),
  company_size_band text not null check (company_size_band in ('under_1k','1k_10k','10k_50k','50k_100k','over_100k')),
  app_version text check (app_version is null or length(app_version) <= 80),
  error_code text check (error_code is null or length(error_code) <= 80),
  stages jsonb not null default '[]'::jsonb check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) <= 30),
  created_at timestamptz not null default now()
);

-- A pre-release copy briefly stored company_id. Telemetry deliberately keeps
-- no company or business-record identifier.
alter table public.performance_samples drop column if exists company_id;

create index if not exists idx_performance_samples_created on public.performance_samples(created_at desc);
create index if not exists idx_performance_samples_operation_created on public.performance_samples(operation, created_at desc);
alter table public.performance_samples enable row level security;

drop policy if exists performance_samples_developer_select on public.performance_samples;
create policy performance_samples_developer_select on public.performance_samples
for select using (public.is_developer_admin());

create or replace function public.record_performance_sample(p_company_id uuid, p_sample jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_stages jsonb;
begin
  if auth.uid() is null or p_company_id is null or not public.is_company_member(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'stage', left(coalesce(stage->>'stage','unknown'), 80),
    'category', case when stage->>'category' in ('frontend','network_database','cache','ui','total') then stage->>'category' else 'frontend' end,
    'duration_ms', greatest(0, least(600000, coalesce((stage->>'duration_ms')::numeric, 0))),
    'success', coalesce((stage->>'success')::boolean, false)
  )), '[]'::jsonb)
  into safe_stages
  from jsonb_array_elements(coalesce(p_sample->'stages','[]'::jsonb)) stage;

  insert into public.performance_samples(
    trace_id, operation, record_type, duration_ms, success,
    line_items, query_count, network_class, company_size_band, app_version,
    error_code, stages
  ) values (
    (p_sample->>'trace_id')::uuid,
    left(coalesce(p_sample->>'operation','unknown'), 80),
    left(coalesce(p_sample->>'record_type','Unknown'), 80),
    greatest(0, least(600000, coalesce((p_sample->>'duration_ms')::numeric, 0))),
    coalesce((p_sample->>'success')::boolean, false),
    greatest(0, least(10000, coalesce((p_sample->>'line_items')::integer, 0))),
    greatest(0, least(1000, coalesce((p_sample->>'query_count')::integer, 0))),
    left(nullif(p_sample->>'network_class',''), 30),
    case when p_sample->>'company_size_band' in ('under_1k','1k_10k','10k_50k','50k_100k','over_100k') then p_sample->>'company_size_band' else 'under_1k' end,
    left(nullif(p_sample->>'app_version',''), 80),
    left(nullif(p_sample->>'error_code',''), 80),
    safe_stages
  );

  if random() < 0.01 then
    delete from public.performance_samples where created_at < now() - interval '30 days';
  end if;
end;
$$;

create or replace function public.developer_performance_summary(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_developer_admin() then
    raise exception 'Developer access required' using errcode = '42501';
  end if;
  with filtered as (
    select * from public.performance_samples
    where created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days,7), 30)))
  ), operation_summary as (
    select operation, count(*)::integer samples,
      round(percentile_cont(0.5) within group (order by duration_ms)::numeric, 2) p50_ms,
      round(percentile_cont(0.95) within group (order by duration_ms)::numeric, 2) p95_ms,
      round(percentile_cont(0.99) within group (order by duration_ms)::numeric, 2) p99_ms,
      round(avg(duration_ms), 2) average_ms,
      round(100.0 * count(*) filter (where not success) / nullif(count(*),0), 2) error_rate,
      max(duration_ms) max_ms
    from filtered group by operation
  ), stage_summary as (
    select stage->>'stage' stage, stage->>'category' category, count(*)::integer samples,
      round(avg((stage->>'duration_ms')::numeric), 2) average_ms,
      round(percentile_cont(0.95) within group (order by (stage->>'duration_ms')::numeric)::numeric, 2) p95_ms
    from filtered cross join lateral jsonb_array_elements(stages) stage
    group by stage->>'stage', stage->>'category'
    order by p95_ms desc limit 20
  )
  select jsonb_build_object(
    'window_days', greatest(1, least(coalesce(p_days,7), 30)),
    'total_samples', (select count(*) from filtered),
    'operations', coalesce((select jsonb_agg(to_jsonb(row) order by row.p95_ms desc) from operation_summary row), '[]'::jsonb),
    'slowest_stages', coalesce((select jsonb_agg(to_jsonb(row) order by row.p95_ms desc) from stage_summary row), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.record_performance_sample(uuid, jsonb) from public, anon;
grant execute on function public.record_performance_sample(uuid, jsonb) to authenticated;
revoke all on function public.developer_performance_summary(integer) from public, anon, authenticated;
grant execute on function public.developer_performance_summary(integer) to authenticated;

commit;
notify pgrst, 'reload schema';
