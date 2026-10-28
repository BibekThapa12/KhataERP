-- POS counter settings: QR payment ledger and receipt footer.
begin;
alter table public.companies add column if not exists pos_qr_account_id text references public.accounts(id) on delete set null;
alter table public.companies add column if not exists pos_receipt_footer text;
alter table public.companies drop constraint if exists companies_pos_receipt_footer_length;
alter table public.companies add constraint companies_pos_receipt_footer_length check (pos_receipt_footer is null or length(pos_receipt_footer) <= 200);
notify pgrst,'reload schema';
commit;
