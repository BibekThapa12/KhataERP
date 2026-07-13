-- Company-wide perpetual inventory valuation method.
-- Safe to run more than once.
begin;

alter table public.companies
  add column if not exists inventory_valuation_method text not null default 'weighted_average';

update public.companies
set inventory_valuation_method = 'weighted_average'
where inventory_valuation_method is null
   or inventory_valuation_method not in ('weighted_average', 'fifo', 'lifo');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'companies_inventory_valuation_method_check'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_inventory_valuation_method_check
      check (inventory_valuation_method in ('weighted_average', 'fifo', 'lifo'));
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
