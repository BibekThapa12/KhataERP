-- Voucher-scoped serial lookup for invoice previews and printing.
-- Serial movements remain outside the normal company accounting snapshot.

begin;

create or replace function public.get_voucher_serials(
  p_company_id uuid,
  p_voucher_id uuid
)
returns table(item_id uuid, serial_number text, direction text)
language plpgsql
stable
security invoker
set search_path=public
as $$
begin
  if p_company_id is null or not public.is_company_member(p_company_id) then
    raise exception 'Voucher company access denied' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.vouchers voucher
    where voucher.id=p_voucher_id and voucher.company_id=p_company_id
  ) then
    raise exception 'Voucher not found' using errcode='P0002';
  end if;

  return query
  select movement.item_id, serial.serial_number, movement.direction
  from public.inventory_serial_movements movement
  join public.inventory_serials serial on serial.id=movement.serial_id
  where movement.company_id=p_company_id and movement.voucher_id=p_voucher_id
  order by movement.item_id, serial.normalized_serial, movement.direction;
end;
$$;

revoke all on function public.get_voucher_serials(uuid,uuid) from public;
grant execute on function public.get_voucher_serials(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
