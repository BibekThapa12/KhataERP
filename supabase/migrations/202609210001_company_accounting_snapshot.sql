begin;

-- A complete company accounting read in one PostgreSQL statement. Returning a
-- scalar JSON document avoids PostgREST row limits while the explicit company
-- predicate and membership check preserve tenant isolation.
create or replace function public.get_company_accounting_snapshot(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with authorized as materialized (
    select p_company_id as company_id
    where auth.uid() is not null
      and public.is_company_member(p_company_id)
      and exists (select 1 from public.companies where id = p_company_id)
  ), scoped_vouchers as materialized (
    select voucher.*
    from public.vouchers voucher
    join authorized access on access.company_id = voucher.company_id
  ), ledger_rows as materialized (
    select line.voucher_id,
      jsonb_agg(to_jsonb(line) order by line.id) as rows,
      count(*)::integer as row_count
    from public.voucher_lines line
    join scoped_vouchers voucher on voucher.id = line.voucher_id
    group by line.voucher_id
  ), stock_rows as materialized (
    select line.voucher_id,
      jsonb_agg(to_jsonb(line) order by line.id) as rows,
      count(*)::integer as row_count
    from public.stock_lines line
    join scoped_vouchers voucher on voucher.id = line.voucher_id
    group by line.voucher_id
  ), invoice_rows as materialized (
    select line.voucher_id,
      jsonb_agg(to_jsonb(line) order by line.id) as rows,
      count(*)::integer as row_count
    from public.invoice_items line
    join scoped_vouchers voucher on voucher.id = line.voucher_id
    group by line.voucher_id
  ), settlement_rows as materialized (
    select settlement.settlement_voucher_id as voucher_id,
      jsonb_agg(to_jsonb(settlement) order by settlement.id) as rows,
      count(*)::integer as row_count
    from public.voucher_settlements settlement
    join scoped_vouchers voucher on voucher.id = settlement.settlement_voucher_id
    where settlement.company_id = p_company_id
    group by settlement.settlement_voucher_id
  ), bundles as materialized (
    select voucher.id,
      voucher.date_bs_key,
      voucher.seq,
      to_jsonb(voucher) || jsonb_build_object(
        'lines', coalesce(ledger.rows, '[]'::jsonb),
        'stock_lines', coalesce(stock.rows, '[]'::jsonb),
        'invoice_items', coalesce(invoice.rows, '[]'::jsonb),
        'settlements', coalesce(settlement.rows, '[]'::jsonb)
      ) as payload,
      coalesce(ledger.row_count, 0) as ledger_count,
      coalesce(stock.row_count, 0) as stock_count,
      coalesce(invoice.row_count, 0) as invoice_count,
      coalesce(settlement.row_count, 0) as settlement_count
    from scoped_vouchers voucher
    left join ledger_rows ledger on ledger.voucher_id = voucher.id
    left join stock_rows stock on stock.voucher_id = voucher.id
    left join invoice_rows invoice on invoice.voucher_id = voucher.id
    left join settlement_rows settlement on settlement.voucher_id = voucher.id
  )
  select case
    when not exists (select 1 from authorized) then
      jsonb_build_object('access_denied', true)
    else jsonb_build_object(
      'company_id', p_company_id,
      'generated_at', statement_timestamp(),
      'counts', jsonb_build_object(
        'vouchers', (select count(*) from bundles),
        'voucher_lines', coalesce((select sum(ledger_count) from bundles), 0),
        'stock_lines', coalesce((select sum(stock_count) from bundles), 0),
        'invoice_items', coalesce((select sum(invoice_count) from bundles), 0),
        'settlements', coalesce((select sum(settlement_count) from bundles), 0)
      ),
      'vouchers', coalesce((
        select jsonb_agg(payload order by date_bs_key desc, seq desc, id desc)
        from bundles
      ), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.get_company_accounting_snapshot(uuid) from public, anon;
grant execute on function public.get_company_accounting_snapshot(uuid) to authenticated;
comment on function public.get_company_accounting_snapshot(uuid) is
  'Returns one statement-consistent, company-scoped accounting snapshot after one membership check.';

-- FOR ALL policies also participate in SELECT as permissive OR branches. Keep
-- the same administrator write authorization without adding it to read plans.
drop policy if exists vouchers_admin_write on public.vouchers;
drop policy if exists vouchers_admin_insert on public.vouchers;
drop policy if exists vouchers_admin_update on public.vouchers;
drop policy if exists vouchers_admin_delete on public.vouchers;
create policy vouchers_admin_insert on public.vouchers for insert
  with check (public.is_company_admin(company_id));
create policy vouchers_admin_update on public.vouchers for update
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));
create policy vouchers_admin_delete on public.vouchers for delete
  using (public.is_company_admin(company_id));

drop policy if exists voucher_settlements_admin_write on public.voucher_settlements;
drop policy if exists voucher_settlements_admin_insert on public.voucher_settlements;
drop policy if exists voucher_settlements_admin_update on public.voucher_settlements;
drop policy if exists voucher_settlements_admin_delete on public.voucher_settlements;
create policy voucher_settlements_admin_insert on public.voucher_settlements for insert
  with check (public.is_company_admin(company_id));
create policy voucher_settlements_admin_update on public.voucher_settlements for update
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));
create policy voucher_settlements_admin_delete on public.voucher_settlements for delete
  using (public.is_company_admin(company_id));

do $$
declare table_name text;
begin
  foreach table_name in array array['voucher_lines', 'stock_lines', 'invoice_items'] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_write', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_delete', table_name);
    execute format(
      'create policy %I on public.%I for insert with check (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_admin(voucher.company_id)))',
      table_name || '_admin_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_admin(voucher.company_id))) with check (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_admin(voucher.company_id)))',
      table_name || '_admin_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (exists (select 1 from public.vouchers voucher where voucher.id = voucher_id and public.is_company_admin(voucher.company_id)))',
      table_name || '_admin_delete', table_name
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
