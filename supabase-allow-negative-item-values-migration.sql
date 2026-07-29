-- Allow negative item values for portable company restores and imported data.
-- Some legacy accounting systems export negative opening quantities/rates or
-- reorder levels. KhataERP calculations already support negative stock values;
-- keep tenant/reference validation but remove the non-negative item check.

create or replace function public.validate_tenant_master_record()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'accounts' then
    if length(btrim(new.name)) < 1 or length(new.name) > 200 then
      raise exception 'Account name must contain 1 to 200 characters';
    end if;
    if new.category_id is not null and not exists (
      select 1 from public.account_categories category
      where category.id = new.category_id
        and category.company_id = new.company_id
        and category.account_type = new.type
        and category.name = new."group"
    ) then raise exception 'Account category must belong to the company and match its type'; end if;
  elsif tg_table_name = 'parties' then
    if length(btrim(new.name)) < 1 or length(new.name) > 200
      or length(coalesce(new.phone, '')) > 50
      or length(coalesce(new.pan_vat, '')) > 100
      or length(coalesce(new.address, '')) > 1000 then
      raise exception 'Party field length is invalid';
    end if;
    if coalesce(new.default_credit_days, 0) < 0 or coalesce(new.default_credit_days, 0) > 36500 then
      raise exception 'Party credit days are outside the valid range';
    end if;
    if not exists (
      select 1 from public.accounts account
      where account.id = new.account_id and account.company_id = new.company_id
        and account.is_party
    ) then raise exception 'Party ledger must belong to the company'; end if;
  elsif tg_table_name = 'items' then
    if length(btrim(new.name)) < 1 or length(new.name) > 200
      or length(btrim(new.unit)) < 1 or length(new.unit) > 50
      or length(coalesce(new.alternate_unit, '')) > 50
      or length(coalesce(new.sku, '')) > 100
      or length(coalesce(new.barcode, '')) > 100 then
      raise exception 'Item field length is invalid';
    end if;
    if (new.alternate_unit is null) <> (new.alternate_conversion is null)
      or (new.alternate_unit is not null and (
        new.alternate_conversion <= 1
        or lower(btrim(new.alternate_unit)) = lower(btrim(new.unit)))) then
      raise exception 'Alternative item unit configuration is invalid';
    end if;
    if new.category_id is not null and not exists (
      select 1 from public.item_categories category
      where category.id = new.category_id and category.company_id = new.company_id
    ) then raise exception 'Item category must belong to the company'; end if;
  end if;
  return new;
end;
$$;
