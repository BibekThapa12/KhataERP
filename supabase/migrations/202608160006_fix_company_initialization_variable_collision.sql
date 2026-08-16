-- Avoid a PL/pgSQL variable/column collision in create_company_atomic.
begin;

create or replace function public.create_company_atomic(p_company jsonb)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  generated_company_id uuid := gen_random_uuid();
  user_email text;
  saved public.companies%rowtype;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform public.assert_company_creation_allowed(caller);
  select email into user_email from auth.users where id = caller;
  perform set_config('khataerp.initializing_company', generated_company_id::text, true);

  insert into public.companies(
    id,user_id,owner_email,name,address,pan_vat,phone,vat_enabled,
    inventory_valuation_method,sales_prefix,purchase_prefix,receipt_prefix,
    payment_prefix,sales_return_prefix,purchase_return_prefix,
    journal_numbering_mode,reset_numbering_fiscal_year,print_format,
    invoice_terms,payment_qr_text,fiscal_year_start,fiscal_year_configured
  )
  values(
    generated_company_id,caller,user_email,
    coalesce(nullif(btrim(coalesce(p_company->>'name','')),''),'My Company'),
    nullif(btrim(coalesce(p_company->>'address','')),''),
    nullif(btrim(coalesce(p_company->>'pan_vat','')),''),
    nullif(btrim(coalesce(p_company->>'phone','')),''),
    coalesce((p_company->>'vat_enabled')::boolean,true),
    coalesce(nullif(p_company->>'inventory_valuation_method',''),'weighted_average'),
    coalesce(nullif(btrim(p_company->>'sales_prefix'),''),'INV-'),
    coalesce(nullif(btrim(p_company->>'purchase_prefix'),''),'PB-'),
    coalesce(nullif(btrim(p_company->>'receipt_prefix'),''),'RCPT-'),
    coalesce(nullif(btrim(p_company->>'payment_prefix'),''),'PAY-'),
    coalesce(nullif(btrim(p_company->>'sales_return_prefix'),''),'SR-'),
    coalesce(nullif(btrim(p_company->>'purchase_return_prefix'),''),'PR-'),
    coalesce(nullif(p_company->>'journal_numbering_mode',''),'auto'),
    true,
    coalesce(nullif(p_company->>'print_format',''),'A5'),
    nullif(btrim(coalesce(p_company->>'invoice_terms','')),''),
    nullif(btrim(coalesce(p_company->>'payment_qr_text','')),''),
    coalesce(nullif(p_company->>'fiscal_year_start','')::date,'2026-07-17'::date),
    coalesce((p_company->>'fiscal_year_configured')::boolean,true)
  )
  returning * into saved;

  insert into public.company_members(company_id,user_id,role,status,created_by)
  values(saved.id,caller,'Admin','active',caller)
  on conflict(company_id,user_id) do update
  set role='Admin',status='active',updated_at=now();

  perform public.ensure_default_company_accounts(saved.id);
  perform public.set_active_company(saved.id);
  perform set_config('khataerp.initializing_company', '', true);
  return saved;
end;
$$;

revoke all on function public.create_company_atomic(jsonb) from public, anon;
grant execute on function public.create_company_atomic(jsonb) to authenticated;

commit;
notify pgrst, 'reload schema';
