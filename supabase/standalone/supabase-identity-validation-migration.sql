-- Shared backend enforcement for company, party, ledger, bank, and cheque identity fields.
-- Invalid optional legacy phone/PAN values are intentionally cleared before constraints are installed.

update public.companies set phone = null where phone is not null and btrim(phone) !~ '^[0-9]{10}$';
update public.companies set pan_vat = null where pan_vat is not null and btrim(pan_vat) !~ '^[0-9]{9}$';
update public.accounts set contact_no = null where contact_no is not null and btrim(contact_no) !~ '^[0-9]{10}$';
update public.accounts set pan_no = null where pan_no is not null and btrim(pan_no) !~ '^[0-9]{9}$';
update public.parties set phone = null where phone is not null and btrim(phone) !~ '^[0-9]{10}$';
update public.parties set pan_vat = null where pan_vat is not null and btrim(pan_vat) !~ '^[0-9]{9}$';
update public.companies set phone = btrim(phone), pan_vat = btrim(pan_vat);
update public.accounts set contact_no = btrim(contact_no), pan_no = btrim(pan_no);
update public.parties set phone = btrim(phone), pan_vat = btrim(pan_vat);

alter table public.companies drop constraint if exists companies_identity_phone_check;
alter table public.companies add constraint companies_identity_phone_check check (phone is null or phone ~ '^[0-9]{10}$');
alter table public.companies drop constraint if exists companies_identity_pan_check;
alter table public.companies add constraint companies_identity_pan_check check (pan_vat is null or pan_vat ~ '^[0-9]{9}$');
alter table public.companies drop constraint if exists companies_identity_name_check;
alter table public.companies add constraint companies_identity_name_check check (char_length(btrim(name)) between 1 and 150 and name !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') not valid;
alter table public.companies drop constraint if exists companies_identity_address_check;
alter table public.companies add constraint companies_identity_address_check check (address is null or (char_length(btrim(address)) <= 500 and address !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')) not valid;

alter table public.accounts drop constraint if exists accounts_identity_phone_check;
alter table public.accounts add constraint accounts_identity_phone_check check (contact_no is null or contact_no ~ '^[0-9]{10}$');
alter table public.accounts drop constraint if exists accounts_identity_pan_check;
alter table public.accounts add constraint accounts_identity_pan_check check (pan_no is null or pan_no ~ '^[0-9]{9}$');
alter table public.accounts drop constraint if exists accounts_identity_name_check;
alter table public.accounts add constraint accounts_identity_name_check check (char_length(btrim(name)) between 1 and 150 and name !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') not valid;
alter table public.accounts drop constraint if exists accounts_identity_address_check;
alter table public.accounts add constraint accounts_identity_address_check check (address is null or (char_length(btrim(address)) <= 500 and address !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')) not valid;
alter table public.accounts drop constraint if exists accounts_identity_bank_account_check;
alter table public.accounts add constraint accounts_identity_bank_account_check check (bank_account_no is null or (char_length(btrim(bank_account_no)) between 1 and 34 and btrim(bank_account_no) ~ '^[[:alnum:] -]+$')) not valid;
alter table public.accounts drop constraint if exists accounts_identity_branch_check;
alter table public.accounts add constraint accounts_identity_branch_check check (bank_branch is null or (char_length(btrim(bank_branch)) <= 100 and bank_branch !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')) not valid;

alter table public.parties drop constraint if exists parties_identity_phone_check;
alter table public.parties add constraint parties_identity_phone_check check (phone is null or phone ~ '^[0-9]{10}$');
alter table public.parties drop constraint if exists parties_identity_pan_check;
alter table public.parties add constraint parties_identity_pan_check check (pan_vat is null or pan_vat ~ '^[0-9]{9}$');
alter table public.parties drop constraint if exists parties_identity_name_check;
alter table public.parties add constraint parties_identity_name_check check (char_length(btrim(name)) between 1 and 150 and name !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') not valid;
alter table public.parties drop constraint if exists parties_identity_address_check;
alter table public.parties add constraint parties_identity_address_check check (address is null or (char_length(btrim(address)) <= 500 and address !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')) not valid;

do $identity_optional_tables$
begin
  if to_regclass('public.cheque_banks') is not null then
    alter table public.cheque_banks disable trigger cheque_bank_guard;
    update public.cheque_banks set contact_number = null where contact_number is not null and btrim(contact_number) !~ '^[0-9]{10}$';
    update public.cheque_banks set contact_number = btrim(contact_number);
    alter table public.cheque_banks enable trigger cheque_bank_guard;
    alter table public.cheque_banks drop constraint if exists cheque_banks_identity_phone_check;
    alter table public.cheque_banks add constraint cheque_banks_identity_phone_check check (contact_number is null or contact_number ~ '^[0-9]{10}$');
    alter table public.cheque_banks drop constraint if exists cheque_banks_identity_name_check;
    alter table public.cheque_banks add constraint cheque_banks_identity_name_check check (char_length(btrim(bank_name)) between 1 and 150) not valid;
    alter table public.cheque_banks drop constraint if exists cheque_banks_identity_branch_check;
    alter table public.cheque_banks add constraint cheque_banks_identity_branch_check check (branch_name is null or char_length(btrim(branch_name)) <= 100) not valid;
    alter table public.cheque_banks drop constraint if exists cheque_banks_identity_account_check;
    alter table public.cheque_banks add constraint cheque_banks_identity_account_check check (account_number is null or btrim(account_number) = '' or (char_length(btrim(account_number)) <= 34 and btrim(account_number) ~ '^[[:alnum:] -]+$')) not valid;
  end if;
  if to_regclass('public.cheques') is not null then
    alter table public.cheques drop constraint if exists cheques_identity_number_check;
    alter table public.cheques add constraint cheques_identity_number_check check (char_length(btrim(cheque_number)) between 1 and 50 and btrim(cheque_number) ~ '^[[:alnum:]/-]+$') not valid;
    alter table public.cheques drop constraint if exists cheques_identity_account_check;
    alter table public.cheques add constraint cheques_identity_account_check check (char_length(btrim(account_number)) between 1 and 34 and btrim(account_number) ~ '^[[:alnum:] -]+$') not valid;
  end if;
end;
$identity_optional_tables$;
