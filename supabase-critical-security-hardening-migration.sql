-- Critical-path authorization and accounting-integrity hardening.
-- Apply after all existing schema, cheque, retained-earnings, and atomic
-- voucher migrations. Safe to run repeatedly.
begin;

-- Tenant users may edit company presentation/accounting settings, but plan,
-- support, ownership, and suspension are developer-controlled security data.
create or replace function public.protect_company_control_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_developer_admin() then return new; end if;

  if nullif(btrim(coalesce(new.logo_url, '')), '') is not null
    and (length(new.logo_url) > 2048 or new.logo_url !~ '^https://') then
    raise exception 'Company logo must use an HTTPS URL'
      using errcode = '22023';
  end if;

  -- A tenant may refresh the cached owner email only from the authenticated
  -- JWT. It may not use this presentation column to impersonate another
  -- owner in the developer dashboard.
  if new.owner_email is distinct from old.owner_email
    and new.owner_email is distinct from nullif(auth.jwt()->>'email', '') then
    raise exception 'Company owner email must match the authenticated user'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.plan_status is distinct from old.plan_status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.support_status is distinct from old.support_status
    or new.developer_notes is distinct from old.developer_notes
    or new.suspended is distinct from old.suspended then
    raise exception 'Developer-controlled company fields cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists company_control_fields_guard on public.companies;
create trigger company_control_fields_guard
before update on public.companies
for each row execute function public.protect_company_control_fields();

-- Legacy trials predated enforced expiry. Give each one the originally
-- intended fourteen-day period from company creation; developer admins can
-- extend or convert the plan before applying this migration when appropriate.
update public.companies
set trial_ends_at = created_at::date + 14
where plan_status = 'trial' and trial_ends_at is null;

-- UI route guards are not an authorization boundary. This trigger blocks a
-- suspended tenant's direct PostgREST/RPC writes as well. Service operations
-- with no end-user JWT and developer admins remain available for maintenance.
create or replace function public.enforce_tenant_write_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
  owner_id uuid;
  company_suspended boolean;
  company_plan_status text;
  company_trial_ends_at date;
begin
  if auth.uid() is null or public.is_developer_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_argv[0] = 'company' then
    target_company := case when tg_op = 'DELETE' then old.id else new.id end;
    if tg_op = 'INSERT' then
      -- The company row is not visible yet in a BEFORE INSERT trigger. Check
      -- ownership and developer-controlled defaults directly on NEW.
      if new.user_id is distinct from auth.uid()
        or new.plan_status is distinct from 'trial'
        or new.trial_ends_at is not null
        or new.support_status is distinct from 'normal'
        or new.developer_notes is not null
        or coalesce(new.suspended, false) then
        raise exception 'New company security fields are invalid'
          using errcode = '42501';
      end if;
      if new.owner_email is not null
        and new.owner_email is distinct from nullif(auth.jwt()->>'email', '') then
        raise exception 'Company owner email must match the authenticated user'
          using errcode = '42501';
      end if;
      if nullif(btrim(coalesce(new.logo_url, '')), '') is not null
        and (length(new.logo_url) > 2048 or new.logo_url !~ '^https://') then
        raise exception 'Company logo must use an HTTPS URL'
          using errcode = '22023';
      end if;
      new.trial_ends_at := current_date + 14;
      return new;
    end if;
  elsif tg_argv[0] = 'voucher_child' then
    select voucher.company_id into target_company
    from public.vouchers voucher
    where voucher.id = case when tg_op = 'DELETE' then old.voucher_id else new.voucher_id end;
  else
    target_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  end if;

  -- Parent rows can already be invisible to a trigger reached through an
  -- authorized ON DELETE CASCADE. A dangling child cannot be created because
  -- the foreign keys remain enforced, so this exception is delete-only.
  if target_company is null and tg_op = 'DELETE' then
    return old;
  end if;

  select company.user_id, company.suspended, company.plan_status, company.trial_ends_at
    into owner_id, company_suspended, company_plan_status, company_trial_ends_at
  from public.companies company
  where company.id = target_company;

  if owner_id is distinct from auth.uid() then
    raise exception 'Company write access denied' using errcode = '42501';
  end if;

  -- Owners must still be able to delete their account/company data.
  if (coalesce(company_suspended, false)
      or company_plan_status = 'expired'
      or (company_plan_status = 'trial' and company_trial_ends_at is not null
        and current_date > company_trial_ends_at))
    and not (tg_argv[0] = 'company' and tg_op = 'DELETE') then
    raise exception 'Company plan is inactive and is read-only' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts','account_categories','parties','items','item_categories',
    'master_change_logs','vouchers','voucher_settlements','app_events',
    'cheque_banks','cheques','cheque_events'
  ] loop
    execute format('drop trigger if exists tenant_write_access_guard on public.%I', table_name);
    execute format(
      'create trigger tenant_write_access_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write_access(%L)',
      table_name, 'direct'
    );
  end loop;

  foreach table_name in array array['voucher_lines','stock_lines','invoice_items'] loop
    execute format('drop trigger if exists tenant_write_access_guard on public.%I', table_name);
    execute format(
      'create trigger tenant_write_access_guard before insert or update or delete on public.%I for each row execute function public.enforce_tenant_write_access(%L)',
      table_name, 'voucher_child'
    );
  end loop;
end;
$$;

drop trigger if exists tenant_write_access_guard on public.companies;
create trigger tenant_write_access_guard
before insert or update or delete on public.companies
for each row execute function public.enforce_tenant_write_access('company');

-- Foreign keys guarantee existence, not tenant ownership. Validate master
-- references and numeric bounds independently of the browser forms.
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
    if new.sell_rate < 0 or new.opening_qty < 0 or new.opening_rate < 0
      or coalesce(new.reorder_level, 0) < 0 then
      raise exception 'Item rates, opening stock and reorder level cannot be negative';
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

drop trigger if exists tenant_master_record_guard on public.accounts;
create trigger tenant_master_record_guard before insert or update on public.accounts
for each row execute function public.validate_tenant_master_record();
drop trigger if exists tenant_master_record_guard on public.parties;
create trigger tenant_master_record_guard before insert or update on public.parties
for each row execute function public.validate_tenant_master_record();
drop trigger if exists tenant_master_record_guard on public.items;
create trigger tenant_master_record_guard before insert or update on public.items
for each row execute function public.validate_tenant_master_record();

-- Independently derive and verify financial totals at transaction end. This
-- prevents a modified browser request from posting a balanced ledger while
-- supplying false invoice subtotal, discount, VAT, or total fields.
create or replace function public.validate_voucher_financial_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_voucher_id uuid;
  voucher_record public.vouchers%rowtype;
  line_count integer;
  item_count integer;
  debit_total numeric;
  credit_total numeric;
  calculated_subtotal numeric;
  calculated_discount numeric;
  calculated_taxable numeric;
  calculated_vat numeric;
  calculated_total numeric;
  expected_discount numeric;
  source_voucher public.vouchers%rowtype;
begin
  -- The header table has `id`; child tables have `voucher_id`. Branch on the
  -- table before touching OLD/NEW so PostgreSQL never resolves a field that
  -- does not exist on that trigger row type.
  if tg_table_name = 'vouchers' then
    target_voucher_id := case when tg_op = 'DELETE' then old.id else new.id end;
  elsif tg_op = 'DELETE' then
    target_voucher_id := old.voucher_id;
  else
    target_voucher_id := new.voucher_id;
  end if;

  select * into voucher_record from public.vouchers where id = target_voucher_id;
  if not found then return null; end if;

  select count(*),
         coalesce(sum(coalesce(line.debit, 0)), 0),
         coalesce(sum(coalesce(line.credit, 0)), 0)
    into line_count, debit_total, credit_total
  from public.voucher_lines line
  where line.voucher_id = target_voucher_id;

  if exists (
    select 1 from public.voucher_lines line
    where line.voucher_id = target_voucher_id
      and (coalesce(line.debit, 0) < 0 or coalesce(line.credit, 0) < 0
        or (coalesce(line.debit, 0) > 0 and coalesce(line.credit, 0) > 0))
  ) then raise exception 'Voucher lines must contain one non-negative debit or credit'; end if;

  if abs(debit_total - credit_total) > 0.01 then
    raise exception 'Voucher debit and credit totals do not match';
  end if;

  if exists (
    select 1
    from public.voucher_lines line
    left join public.accounts account
      on account.id = line.account_id
     and account.company_id = voucher_record.company_id
    where line.voucher_id = target_voucher_id and account.id is null
  ) then raise exception 'Voucher ledger belongs to another company'; end if;

  if exists (
    select 1
    from public.invoice_items invoice_item
    left join public.items item
      on item.id = invoice_item.item_id
     and item.company_id = voucher_record.company_id
    where invoice_item.voucher_id = target_voucher_id and item.id is null
  ) or exists (
    select 1
    from public.stock_lines stock_line
    left join public.items item
      on item.id = stock_line.item_id
     and item.company_id = voucher_record.company_id
    where stock_line.voucher_id = target_voucher_id and item.id is null
  ) then raise exception 'Voucher item belongs to another company'; end if;

  if exists (
    select 1 from public.stock_lines stock_line
    where stock_line.voucher_id = target_voucher_id
      and (stock_line.qty <= 0 or stock_line.rate < 0)
  ) then raise exception 'Stock movements require positive quantities and non-negative rates'; end if;

  if voucher_record.party_account_id is not null and not exists (
    select 1 from public.accounts account
    where account.id = voucher_record.party_account_id
      and account.company_id = voucher_record.company_id
  ) then raise exception 'Voucher party ledger belongs to another company'; end if;

  if voucher_record.settlement_account_id is not null and not exists (
    select 1 from public.accounts account
    where account.id = voucher_record.settlement_account_id
      and account.company_id = voucher_record.company_id
  ) then raise exception 'Voucher settlement ledger belongs to another company'; end if;

  if voucher_record.original_voucher_id is not null and not exists (
    select 1 from public.vouchers original
    where original.id = voucher_record.original_voucher_id
      and original.company_id = voucher_record.company_id
  ) then raise exception 'Original voucher belongs to another company'; end if;

  if voucher_record.cancelled and exists (
    select 1 from public.vouchers return_voucher
    where return_voucher.original_voucher_id = target_voucher_id
      and return_voucher.company_id = voucher_record.company_id
      and not return_voucher.cancelled
  ) then raise exception 'Cancel linked return vouchers before cancelling the original invoice'; end if;

  if voucher_record.cancelled and exists (
    select 1 from public.cheques cheque
    where cheque.linked_voucher_id = target_voucher_id
      and cheque.company_id = voucher_record.company_id
      and cheque.status = 'cleared'
  ) then raise exception 'A Receipt linked to a cleared cheque cannot be cancelled'; end if;

  if voucher_record.type <> 'Stock Adjustment' then
    if line_count < 2 then raise exception 'Posted vouchers require at least two ledger lines'; end if;
    if abs(coalesce(voucher_record.total, 0) - debit_total) > 0.01 then
      raise exception 'Voucher total does not match its ledger posting';
    end if;
    if voucher_record.type in ('Receipt','Payment','Journal')
      and coalesce(voucher_record.total, 0) <= 0 then
      raise exception 'Voucher total must be greater than zero';
    end if;
  end if;

  if length(coalesce(voucher_record.narration, '')) > 4000
    or length(coalesce(voucher_record.return_reason, '')) > 2000
    or length(coalesce(voucher_record.invoice_no, '')) > 100 then
    raise exception 'Voucher text exceeds the allowed length';
  end if;

  if voucher_record.type in ('Sales','Purchase','Sales Return','Purchase Return') then
    select count(*),
           coalesce(sum(round(item.qty * item.rate, 2)), 0),
           coalesce(sum(coalesce(item.discount_amount, 0)), 0),
           coalesce(sum(coalesce(item.taxable_amount, round(item.qty * item.rate, 2))), 0),
           coalesce(sum(coalesce(item.vat_amount, 0)), 0)
      into item_count, calculated_subtotal, calculated_discount,
           calculated_taxable, calculated_vat
    from public.invoice_items item
    where item.voucher_id = target_voucher_id;

    if item_count = 0 or exists (
      select 1 from public.invoice_items item
      where item.voucher_id = target_voucher_id
        and (item.qty <= 0 or item.rate < 0 or coalesce(item.conversion_factor, 1) <= 0
          or (item.base_qty is not null and abs(item.base_qty - item.qty * coalesce(item.conversion_factor, 1)) > 0.0001))
    ) then raise exception 'Invoice items require positive quantities and non-negative rates'; end if;

    if voucher_record.type in ('Sales','Purchase') then
      calculated_discount := coalesce(voucher_record.discount, 0);
      if calculated_discount < 0 or calculated_discount > calculated_subtotal then
        raise exception 'Invoice discount is outside the valid range';
      end if;
      calculated_taxable := round(calculated_subtotal - calculated_discount, 2);
      if coalesce(voucher_record.vat_rate, 0) < 0 or coalesce(voucher_record.vat_rate, 0) > 100 then
        raise exception 'VAT rate is outside the valid range';
      end if;
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 2);
    else
      if calculated_discount < 0 or calculated_discount > calculated_subtotal then
        raise exception 'Return discount is outside the valid range';
      end if;
      if abs(calculated_taxable - round(calculated_subtotal - calculated_discount, 2)) > 0.01 then
        raise exception 'Return taxable amounts are inconsistent';
      end if;
      if coalesce(voucher_record.vat_rate, 0) < 0 or coalesce(voucher_record.vat_rate, 0) > 100 then
        raise exception 'Return VAT rate is outside the valid range';
      end if;
      if abs(calculated_vat - round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 2)) > 0.01 then
        raise exception 'Return VAT does not match server-calculated VAT';
      end if;
      calculated_vat := round(calculated_taxable * coalesce(voucher_record.vat_rate, 0) / 100, 2);
      if voucher_record.original_voucher_id is null and calculated_discount <> 0 then
        raise exception 'A manual return cannot introduce an invoice discount';
      end if;
    end if;

    calculated_total := round(calculated_taxable + calculated_vat, 2);
    if abs(coalesce(voucher_record.subtotal, 0) - calculated_subtotal) > 0.01
      or abs(coalesce(voucher_record.discount, 0) - calculated_discount) > 0.01
      or abs(coalesce(voucher_record.vat_amount, 0) - calculated_vat) > 0.01
      or abs(coalesce(voucher_record.total, 0) - calculated_total) > 0.01 then
      raise exception 'Invoice totals do not match server-calculated values';
    end if;

    if voucher_record.type = 'Sales Return' and not coalesce(voucher_record.restock_items, false) then
      if exists (select 1 from public.stock_lines where voucher_id = target_voucher_id) then
        raise exception 'A non-restocked sales return cannot create stock movements';
      end if;
    else
      if exists (
        with invoice_quantity as (
          select invoice_item.item_id,
                 sum(coalesce(invoice_item.base_qty,
                   invoice_item.qty * coalesce(invoice_item.conversion_factor, 1))) as qty
          from public.invoice_items invoice_item
          where invoice_item.voucher_id = target_voucher_id
          group by invoice_item.item_id
        ), movement_quantity as (
          select stock_line.item_id, sum(stock_line.qty) as qty
          from public.stock_lines stock_line
          where stock_line.voucher_id = target_voucher_id
            and stock_line.direction = case
              when voucher_record.type in ('Purchase','Sales Return') then 'in'
              else 'out'
            end
          group by stock_line.item_id
        )
        select 1
        from invoice_quantity invoice
        full join movement_quantity movement using (item_id)
        where invoice.item_id is null or movement.item_id is null
          or abs(invoice.qty - movement.qty) > 0.0001
      ) or exists (
        select 1 from public.stock_lines stock_line
        where stock_line.voucher_id = target_voucher_id
          and stock_line.direction <> case
            when voucher_record.type in ('Purchase','Sales Return') then 'in'
            else 'out'
          end
      ) then raise exception 'Invoice stock movements do not match invoice item quantities'; end if;
    end if;
  end if;

  if voucher_record.type in ('Sales Return','Purchase Return')
    and voucher_record.original_voucher_id is not null then
    if not exists (
      select 1 from public.vouchers original
      where original.id = voucher_record.original_voucher_id
        and original.company_id = voucher_record.company_id
        and not original.cancelled
        and original.type = case when voucher_record.type = 'Sales Return' then 'Sales' else 'Purchase' end
    ) then raise exception 'Return source invoice is invalid'; end if;

    select * into source_voucher
    from public.vouchers original
    where original.id = voucher_record.original_voucher_id;

    if coalesce(voucher_record.vat_rate, 0) is distinct from coalesce(source_voucher.vat_rate, 0) then
      raise exception 'Return VAT rate must match the source invoice';
    end if;

    expected_discount := case
      when coalesce(source_voucher.subtotal, 0) > 0
        then round(coalesce(source_voucher.discount, 0) * calculated_subtotal / source_voucher.subtotal, 2)
      else 0
    end;
    if abs(calculated_discount - expected_discount) > greatest(0.02, item_count * 0.01) then
      raise exception 'Return discount does not match the source invoice allocation';
    end if;

    if exists (
      select 1
      from public.invoice_items returned
      left join public.invoice_items source
        on source.id = returned.source_invoice_item_id
       and source.voucher_id = voucher_record.original_voucher_id
      where returned.voucher_id = target_voucher_id
        and (source.id is null or source.item_id is distinct from returned.item_id
          or abs(source.rate - returned.rate) > 0.01)
    ) then raise exception 'Returned item does not match its source invoice'; end if;

    if exists (
      select 1
      from public.invoice_items source
      join public.invoice_items returned on returned.source_invoice_item_id = source.id
      join public.vouchers return_voucher on return_voucher.id = returned.voucher_id
      where source.voucher_id = voucher_record.original_voucher_id
        and not return_voucher.cancelled
      group by source.id, source.qty
      having sum(returned.qty) > source.qty + 0.0001
    ) then raise exception 'Return quantity exceeds the source invoice quantity'; end if;
  end if;

  return null;
end;
$$;

drop trigger if exists voucher_financial_integrity_header on public.vouchers;
create constraint trigger voucher_financial_integrity_header
after insert or update on public.vouchers
deferrable initially deferred for each row
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_lines on public.voucher_lines;
create constraint trigger voucher_financial_integrity_lines
after insert or update or delete on public.voucher_lines
deferrable initially deferred for each row
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_items on public.invoice_items;
create constraint trigger voucher_financial_integrity_items
after insert or update or delete on public.invoice_items
deferrable initially deferred for each row
execute function public.validate_voucher_financial_integrity();

drop trigger if exists voucher_financial_integrity_stock on public.stock_lines;
create constraint trigger voucher_financial_integrity_stock
after insert or update or delete on public.stock_lines
deferrable initially deferred for each row
execute function public.validate_voucher_financial_integrity();

-- A cleared received cheque is only valid when it points to one matching,
-- active Receipt voucher. This prevents a caller from marking a cheque as
-- cleared through the Data API without creating the accounting entry.
do $$
begin
  if exists (
    select 1 from public.cheques
    where linked_voucher_id is not null
    group by linked_voucher_id having count(*) > 1
  ) then
    raise exception 'Duplicate cheque receipt links exist; resolve them before applying security hardening';
  end if;
end;
$$;

create unique index if not exists cheques_linked_receipt_unique
  on public.cheques(linked_voucher_id)
  where linked_voucher_id is not null;

create or replace function public.validate_cleared_cheque_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  receipt public.vouchers%rowtype;
  destination_debit numeric;
  party_credit numeric;
begin
  if new.status <> 'cleared' then
    if new.linked_voucher_id is not null or new.cleared_to_account_id is not null then
      raise exception 'Only cleared cheques may link a receipt voucher';
    end if;
    return null;
  end if;

  if new.linked_voucher_id is null then
    raise exception 'A cleared cheque requires a linked Receipt voucher';
  end if;

  select * into receipt
  from public.vouchers voucher
  where voucher.id = new.linked_voucher_id
    and voucher.company_id = new.company_id
    and voucher.type = 'Receipt'
    and not voucher.cancelled;

  if not found or receipt.party_account_id is distinct from new.party_ledger_id
    or receipt.total is distinct from new.amount
    or receipt.settlement_account_id is null then
    raise exception 'Linked Receipt does not match the cleared cheque';
  end if;

  select coalesce(sum(line.debit), 0) into destination_debit
  from public.voucher_lines line
  where line.voucher_id = receipt.id
    and line.account_id = receipt.settlement_account_id;

  select coalesce(sum(line.credit), 0) into party_credit
  from public.voucher_lines line
  where line.voucher_id = receipt.id
    and line.account_id = new.party_ledger_id;

  if abs(destination_debit - new.amount) > 0.01
    or abs(party_credit - new.amount) > 0.01 then
    raise exception 'Linked Receipt posting does not match the cleared cheque amount';
  end if;
  return null;
end;
$$;

drop trigger if exists cleared_cheque_receipt_guard on public.cheques;
create constraint trigger cleared_cheque_receipt_guard
after insert or update on public.cheques
deferrable initially deferred for each row
execute function public.validate_cleared_cheque_receipt();

-- Internal SECURITY DEFINER maintenance helpers are trigger/migration entry
-- points, not public APIs. PostgreSQL grants function EXECUTE to PUBLIC by
-- default, so revoke it explicitly to prevent cross-tenant seeding calls.
revoke all on function public.ensure_system_account_groups(uuid) from public, anon, authenticated;
revoke all on function public.ensure_retained_earnings_ledger(uuid) from public, anon, authenticated;
revoke all on function public.seed_nepal_cheque_banks(uuid) from public, anon, authenticated;
revoke all on function public.seed_cheque_banks_on_entitlement() from public, anon, authenticated;
revoke all on function public.seed_system_account_groups_for_company() from public, anon, authenticated;
revoke all on function public.protect_system_account_category() from public, anon, authenticated;
revoke all on function public.protect_company_control_fields() from public, anon, authenticated;
revoke all on function public.enforce_tenant_write_access() from public, anon, authenticated;
revoke all on function public.validate_cheque_bank() from public, anon, authenticated;
revoke all on function public.cheque_touch_and_audit() from public, anon, authenticated;
revoke all on function public.validate_cleared_cheque_receipt() from public, anon, authenticated;
revoke all on function public.validate_voucher_financial_integrity() from public, anon, authenticated;
revoke all on function public.validate_tenant_master_record() from public, anon, authenticated;

revoke all on function public.is_developer_admin() from public, anon;
grant execute on function public.is_developer_admin() to authenticated;
revoke all on function public.get_developer_schema_status() from public, anon;
grant execute on function public.get_developer_schema_status() to authenticated;
revoke all on function public.has_company_permission(uuid,text) from public, anon;
grant execute on function public.has_company_permission(uuid,text) to authenticated;
revoke all on function public.company_module_access(uuid,text,boolean) from public, anon;
grant execute on function public.company_module_access(uuid,text,boolean) to authenticated;

-- No application table is needed before authentication. RLS remains enabled
-- as the primary boundary, and explicit anon revocation reduces the exposed
-- surface further if a future policy is accidentally made permissive.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

commit;
notify pgrst, 'reload schema';
