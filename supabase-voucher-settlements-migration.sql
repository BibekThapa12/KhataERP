-- KhataERP invoice settlement allocation migration
-- Safe to run more than once in Supabase SQL Editor.

create extension if not exists "uuid-ossp";

create table if not exists voucher_settlements (
  id                    uuid primary key default uuid_generate_v4(),
  company_id            uuid not null references companies(id) on delete cascade,
  settlement_voucher_id uuid not null references vouchers(id) on delete cascade,
  invoice_voucher_id    uuid not null references vouchers(id) on delete cascade,
  party_account_id      text not null references accounts(id),
  amount                numeric(14,2) not null check (amount > 0),
  created_at            timestamptz not null default now(),
  unique (settlement_voucher_id, invoice_voucher_id, party_account_id),
  check (settlement_voucher_id <> invoice_voucher_id)
);

create index if not exists idx_vsettlements_company on voucher_settlements(company_id);
create index if not exists idx_vsettlements_settlement on voucher_settlements(settlement_voucher_id);
create index if not exists idx_vsettlements_invoice on voucher_settlements(invoice_voucher_id);
create index if not exists idx_vsettlements_party on voucher_settlements(company_id, party_account_id);

create or replace function validate_voucher_settlement()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from vouchers
    where id = new.settlement_voucher_id and company_id = new.company_id
      and type in ('Receipt', 'Payment') and not cancelled
  ) then raise exception 'Settlement voucher must be an active Receipt or Payment in the same company'; end if;
  if not exists (
    select 1 from vouchers
    where id = new.invoice_voucher_id and company_id = new.company_id
      and type in ('Sales', 'Purchase') and not cancelled
  ) then raise exception 'Invoice voucher must be an active Sales or Purchase voucher in the same company'; end if;
  if not exists (select 1 from accounts where id = new.party_account_id and company_id = new.company_id and is_party) then
    raise exception 'Settlement party ledger must belong to the same company';
  end if;
  return new;
end $$;

drop trigger if exists validate_voucher_settlement_trigger on voucher_settlements;
create trigger validate_voucher_settlement_trigger before insert or update on voucher_settlements
for each row execute function validate_voucher_settlement();

alter table voucher_settlements enable row level security;

drop policy if exists "voucher_settlements_own" on voucher_settlements;
create policy "voucher_settlements_own" on voucher_settlements
  for all using (company_id = my_company_id()) with check (company_id = my_company_id());

drop policy if exists "voucher_settlements_developer_select" on voucher_settlements;
create policy "voucher_settlements_developer_select" on voucher_settlements
  for select using (is_developer_admin());

notify pgrst, 'reload schema';

