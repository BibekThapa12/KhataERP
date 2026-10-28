-- Preserve rates calculated from an explicitly entered invoice-line amount.
-- Six decimal places allow amount / quantity calculations to round back to
-- the user's two-decimal line amount during server integrity validation.
begin;

alter table public.invoice_items
  alter column rate type numeric(18,6) using rate::numeric(18,6);

commit;
notify pgrst, 'reload schema';
