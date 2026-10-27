-- Run with `supabase test db` against a database with all migrations applied.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select throws_ok(
  $$select public.apply_voucher_serial_movements(gen_random_uuid(), gen_random_uuid(), 'Sales', '[]'::jsonb)$$,
  '42501',
  'Serial movements can only be written while saving a voucher',
  'direct RPC calls cannot rewrite serial history'
);

select set_config('khata.serial_voucher_id', '00000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.apply_voucher_serial_movements('00000000-0000-0000-0000-000000000002', gen_random_uuid(), 'Sales', '[]'::jsonb)$$,
  '42501',
  'Serial movements can only be written while saving a voucher',
  'the save flag only authorises the voucher being saved'
);

select ok(
  position('khata.serial_voucher_id' in pg_get_functiondef('public.save_voucher_atomic(jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,boolean,integer,integer,text,jsonb)'::regprocedure)) > 0,
  'save_voucher_atomic sets the serial writer flag'
);

select has_trigger('public', 'vouchers', 'vouchers_serialized_deactivation_guard', 'cancel and un-complete are guarded for serials');

select ok(
  position('inventorySerials' in pg_get_functiondef('public.system_export_company_backup(uuid)'::regprocedure)) > 0,
  'automated backups include serial numbers'
);

select * from finish();
rollback;
