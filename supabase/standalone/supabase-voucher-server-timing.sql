-- Wrap the existing atomic writer to return privacy-safe PostgreSQL execution
-- time without rewriting its deployed function body.
begin;

create or replace function public.save_voucher_with_performance_timing_atomic(
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
  p_audit_metadata jsonb default '{}'::jsonb,
  p_manual_invoice_no text default null,
  p_supplier_invoice_no text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
  request_started_at timestamptz := clock_timestamp();
begin
  result := public.save_voucher_with_document_metadata_atomic(
    p_voucher, p_lines, p_stock_lines, p_invoice_items, p_settlements,
    p_voucher_id, p_invoice_prefix, p_reset_numbering,
    p_period_start_key, p_next_period_start_key,
    p_audit_event_type, p_audit_metadata,
    p_manual_invoice_no, p_supplier_invoice_no
  );
  return result || jsonb_build_object(
    '_performance', jsonb_build_object(
      'postgres_ms', round((extract(epoch from (clock_timestamp() - request_started_at)) * 1000)::numeric, 2)
    )
  );
end;
$$;

revoke all on function public.save_voucher_with_performance_timing_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text) from public, anon;
grant execute on function public.save_voucher_with_performance_timing_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb,text,text) to authenticated;

commit;
notify pgrst, 'reload schema';
