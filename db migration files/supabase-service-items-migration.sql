-- Service Item Support
-- Service items are invoiceable but must never create inventory movement.

begin;

alter table public.items
  add column if not exists is_service boolean not null default false;

update public.items
set is_service = false
where is_service is null;

create or replace function public.prevent_service_item_stock_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.items item
    where item.id = new.item_id
      and coalesce(item.is_service, false)
  ) then
    raise exception 'Service items cannot create stock movements';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_lines_reject_service_items on public.stock_lines;
create trigger stock_lines_reject_service_items
before insert or update of item_id on public.stock_lines
for each row
execute function public.prevent_service_item_stock_line();

do $service_items$
declare
  fn text;
begin
  select pg_get_functiondef('public.validate_voucher_financial_integrity()'::regprocedure)
    into fn;

  if fn is null then
    raise exception 'validate_voucher_financial_integrity() is missing';
  end if;

  if fn not like '%Service items cannot create stock movements%' then
    fn := replace(fn,
      $$  if exists (
    select 1 from public.stock_lines stock_line
    where stock_line.voucher_id = target_voucher_id
      and (stock_line.qty <= 0 or stock_line.rate < 0)
  ) then raise exception 'Stock movements require positive quantities and non-negative rates'; end if;$$,
      $$  if exists (
    select 1 from public.stock_lines stock_line
    where stock_line.voucher_id = target_voucher_id
      and (stock_line.qty <= 0 or stock_line.rate < 0)
  ) then raise exception 'Stock movements require positive quantities and non-negative rates'; end if;

  if exists (
    select 1
    from public.stock_lines stock_line
    join public.items item
      on item.id = stock_line.item_id
    where stock_line.voucher_id = target_voucher_id
      and coalesce(item.is_service, false)
  ) then raise exception 'Service items cannot create stock movements'; end if;$$);
  end if;

  if fn not like '%tracked_item.id = invoice_item.item_id%' then
    fn := replace(fn,
      $$          from public.invoice_items invoice_item
          where invoice_item.voucher_id = target_voucher_id
          group by invoice_item.item_id$$,
      $$          from public.invoice_items invoice_item
          join public.items tracked_item
            on tracked_item.id = invoice_item.item_id
           and tracked_item.company_id = voucher_record.company_id
           and not coalesce(tracked_item.is_service, false)
          where invoice_item.voucher_id = target_voucher_id
          group by invoice_item.item_id$$);
  end if;

  execute fn;
end $service_items$;

revoke all on function public.prevent_service_item_stock_line() from public, anon, authenticated;

commit;
