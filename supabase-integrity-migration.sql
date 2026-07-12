-- Apply after supabase-schema.sql.
-- Existing duplicate invoice numbers are repaired deterministically: the oldest
-- voucher keeps its number and later duplicates receive numbers above the
-- current maximum for the same company, voucher type, and prefix.

begin;

create unique index if not exists vouchers_company_seq_unique
  on public.vouchers (company_id, seq);

with parsed as (
  select
    id,
    company_id,
    type,
    invoice_no,
    created_at,
    seq,
    regexp_replace(invoice_no, '[0-9]+$', '') as prefix,
    case
      when invoice_no ~ '[0-9]+$'
        then (substring(invoice_no from '([0-9]+)$'))::bigint
      else 0
    end as number_part,
    row_number() over (
      partition by company_id, type, invoice_no
      order by created_at nulls last, seq, id
    ) as duplicate_rank
  from public.vouchers
  where invoice_no is not null
), maxima as (
  select company_id, type, prefix, max(number_part) as max_number
  from parsed
  group by company_id, type, prefix
), duplicates as (
  select
    p.id,
    p.prefix,
    m.max_number,
    row_number() over (
      partition by p.company_id, p.type, p.prefix
      order by p.created_at nulls last, p.seq, p.id
    ) as repair_number
  from parsed p
  join maxima m using (company_id, type, prefix)
  where p.duplicate_rank > 1
)
update public.vouchers v
set invoice_no = d.prefix || lpad((d.max_number + d.repair_number)::text, 4, '0')
from duplicates d
where v.id = d.id;

create unique index if not exists vouchers_company_type_invoice_no_unique
  on public.vouchers (company_id, type, invoice_no)
  where invoice_no is not null;

-- This deferred guard rejects malformed journals at transaction commit.
create or replace function public.validate_voucher_balance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_id uuid := coalesce(new.voucher_id, old.voucher_id);
  debit_total numeric;
  credit_total numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into debit_total, credit_total
    from public.voucher_lines where voucher_id = target_id;
  if abs(debit_total - credit_total) > 0.005 then
    raise exception 'Voucher % is not balanced (debit %, credit %)', target_id, debit_total, credit_total;
  end if;
  return null;
end;
$$;

drop trigger if exists voucher_lines_balance_guard on public.voucher_lines;
create constraint trigger voucher_lines_balance_guard
after insert or update or delete on public.voucher_lines
deferrable initially deferred
for each row execute function public.validate_voucher_balance();

commit;
