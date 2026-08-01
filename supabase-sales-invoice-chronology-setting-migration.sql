-- Add an opt-in Sales-only chronological invoice date setting.
-- When disabled, all voucher types only require dates inside the active fiscal year.
begin;

alter table public.companies
  add column if not exists enforce_sales_invoice_chronology boolean not null default false;

create or replace function public.voucher_number_value(value text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select nullif(substring(coalesce(value, '') from '([0-9]+)$'), '')::bigint;
$$;

create or replace function public.validate_voucher_chronology()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  company_record public.companies%rowtype;
  current_number bigint;
  previous_voucher public.vouchers%rowtype;
  next_voucher public.vouchers%rowtype;
  bypass_allowed boolean := false;
begin
  if coalesce(new.status, 'Completed') = 'Draft' then
    return new;
  end if;

  if new.type <> 'Sales' then
    return new;
  end if;

  select * into company_record from public.companies where id = new.company_id;
  if not found then
    return new;
  end if;

  if not coalesce(company_record.enforce_sales_invoice_chronology, false) then
    return new;
  end if;

  current_number := public.voucher_number_value(new.invoice_no);
  if current_number is null then
    return new;
  end if;

  select voucher.* into previous_voucher
  from public.vouchers voucher
  where voucher.company_id = new.company_id
    and voucher.type = new.type
    and coalesce(voucher.status, 'Completed') <> 'Draft'
    and coalesce(voucher.numbering_period, 'all') = coalesce(new.numbering_period, 'all')
    and voucher.id is distinct from new.id
    and public.voucher_number_value(voucher.invoice_no) < current_number
  order by public.voucher_number_value(voucher.invoice_no) desc, voucher.seq desc
  limit 1;

  select voucher.* into next_voucher
  from public.vouchers voucher
  where voucher.company_id = new.company_id
    and voucher.type = new.type
    and coalesce(voucher.status, 'Completed') <> 'Draft'
    and coalesce(voucher.numbering_period, 'all') = coalesce(new.numbering_period, 'all')
    and voucher.id is distinct from new.id
    and public.voucher_number_value(voucher.invoice_no) > current_number
  order by public.voucher_number_value(voucher.invoice_no) asc, voucher.seq asc
  limit 1;

  if (previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key)
    or (next_voucher.id is not null and new.date_bs_key > next_voucher.date_bs_key) then
    bypass_allowed := coalesce(company_record.allow_admin_chronological_bypass, false)
      and public.is_company_admin(new.company_id);

    if not bypass_allowed then
      if tg_op = 'INSERT' and previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key then
        raise exception 'The voucher date cannot be earlier than the previous voucher (%). Please select the same or a later date.', previous_voucher.invoice_no;
      elsif previous_voucher.id is not null and new.date_bs_key < previous_voucher.date_bs_key then
        raise exception 'The voucher date cannot be earlier than Voucher %.', previous_voucher.invoice_no;
      else
        raise exception 'The voucher date cannot be later than Voucher %.', next_voucher.invoice_no;
      end if;
    end if;

    insert into public.app_events (company_id, user_id, event_type, metadata)
    values (
      new.company_id,
      auth.uid(),
      'voucher_chronology_bypass',
      jsonb_build_object(
        'voucher_type', new.type,
        'voucher_number', new.invoice_no,
        'previous_voucher', previous_voucher.invoice_no,
        'previous_date', previous_voucher.date_bs,
        'next_voucher', next_voucher.invoice_no,
        'next_date', next_voucher.date_bs,
        'new_date', new.date_bs,
        'source', 'database'
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists vouchers_chronology_guard on public.vouchers;
create trigger vouchers_chronology_guard
before insert or update of date_bs, date_bs_key, invoice_no, numbering_period, type, status on public.vouchers
for each row execute function public.validate_voucher_chronology();

revoke all on function public.validate_voucher_chronology() from public, anon, authenticated;
revoke all on function public.voucher_number_value(text) from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
