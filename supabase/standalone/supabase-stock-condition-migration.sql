-- Tracks stock condition without changing historical quantities or valuation.
-- Existing stock movements are classified as saleable.
begin;

alter table public.stock_lines
  add column if not exists stock_condition text not null default 'saleable';

alter table public.stock_lines
  add column if not exists is_transfer boolean not null default false;

update public.stock_lines
set stock_condition = 'saleable'
where stock_condition is null or stock_condition not in ('saleable', 'damaged', 'expired');

do $$
begin
  alter table public.stock_lines drop constraint if exists stock_lines_stock_condition_check;
  alter table public.stock_lines add constraint stock_lines_stock_condition_check
    check (stock_condition in ('saleable', 'damaged', 'expired'));
end $$;s

create index if not exists idx_slines_item_condition
  on public.stock_lines(item_id, stock_condition);

commit;
notify pgrst, 'reload schema';
