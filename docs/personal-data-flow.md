# KhataERP personal-data flow audit

Audit date: 2026-07-19

## System boundary

KhataERP is a browser SPA hosted as static frontend code. The only network SDK in the dependency tree is Supabase (`@supabase/supabase-js` and Supabase Auth UI packages). No Stripe, OpenAI, SendGrid, Twilio, Firebase, Sentry, analytics, advertising, or payment-card SDK is present. Vercel may host the static application, but the source does not send application records to Vercel APIs.

All normal database reads and writes go from the browser to the configured Supabase project over HTTPS. PostgreSQL RLS is the tenant boundary. `supabase-security-audit.sql` checks for public tables that lack RLS or policies and should be run after schema changes.

## Collection and data-flow map

| Collection point | Data collected | In-app travel | Stored destination | Other destination / disclosure |
|---|---|---|---|---|
| Login and signup (`Login.tsx`) | Email, password; on signup company name, address, PAN/VAT, phone, VAT mode | React form state -> Supabase Auth HTTPS request. Company fields are temporary signup metadata -> `getOrCreateCompany` | Email/auth verifier in Supabase Auth. Password is never stored by application code. Company details in `companies`; temporary `company_*` auth metadata is cleared after bootstrap | Supabase Auth may send confirmation email. No app log receives these values |
| Company Settings | Company name, address, PAN/VAT, phone, logo URL, invoice terms, payment/QR note and fiscal/configuration fields | React state -> Supabase PostgREST update | `companies` | User-initiated invoice/report print, JSON backup, or closing snapshot can include these fields on the user's device |
| Party master | Party/contact name, customer/supplier type, phone, address, PAN/VAT, credit days, opening balance | Form -> app store -> `accounts` and `parties` writes | `parties`; linked party ledger in `accounts` | Appears in authenticated reports, user-initiated print/CSV/share, invoices and voucher views |
| Account/item/category masters | Ledger/item/category names, opening balances/stock, rates, SKU, barcode and units | Form -> app store -> Supabase | `accounts`, `account_categories`, `items`, `item_categories` | User-initiated reports, print, CSV and backups |
| Voucher and return forms | Party/ledger references, dates, voucher number, line items, amount, tax, discount, narration/reason, settlement | Form -> atomic voucher RPC/PostgREST -> relational child rows | `vouchers`, `voucher_lines`, `stock_lines`, `invoice_items`, `voucher_settlements`, one summarized `app_events` audit event | User-initiated print, CSV and backup; realtime change notification contains database change data within Supabase |
| Stock adjustments | Item, quantity, unit, cost rate, condition and reason | Form -> voucher posting path | Voucher/stock tables above | Stock/report views and user-initiated export/print |
| Cheque Management | Cheque/account number, issuing bank/branch, party ledger, amount, dates, notes/status reason; optional bank contact/account-holder schema fields | Form -> Supabase cheque tables; clearing creates linked receipt voucher | `cheques`, `cheque_banks`; field-name-only history in `cheque_events` | Authenticated cheque pages/dashboard; user-selected print/export if invoked |
| Developer Dashboard | Owner email/company contact, plan/support state, developer notes, module billing/status/price/internal notes | Developer-only view/update -> Supabase | `companies`, `company_modules`, `modules` | Only users allowed by the developer-admin RLS policies |
| Search and filters | Search text may contain a party name, phone, PAN/VAT, cheque or account number | Component memory only; filtering is client-side for current loaded data | Not persisted by app logging | Some report/filter routes contain opaque record IDs in browser history, not names/contact values |
| Error and performance diagnostics | Error category/source/path; operation type, record type, item count, timing | Sanitizer -> `app_events`, or development console | Tenant-scoped `app_events`; development console only | Emails, phones, credentials, party/voucher IDs and payloads are redacted/omitted |
| Backup restore/export | Complete company/account/party/item/voucher dataset selected by user | Local file input or generated Blob in browser memory | User-selected local JSON file; restored records return to Supabase | The app does not upload the file anywhere else |
| Print/CSV/share | Report-specific company, party, voucher and financial data | Browser-generated document/blob | User-selected device/file/printer | `navigator.share` hands a party statement to the operating-system share target explicitly selected by the user |

A user-configured external logo URL is fetched by the browser when printing a voucher. The image host necessarily receives the network request/IP; the generated image tag uses `referrerpolicy="no-referrer"` so it is not sent the application page URL. Users should host logos with a trusted provider or use a controlled URL.

The source does **not** collect date of birth, card/payment credentials, biometric data, device fingerprints, advertising identifiers, IP addresses, or user-agent/device information. Supabase, the hosting provider, and network infrastructure may process IP/user-agent data in their own operational logs; that processing is outside this repository and must be reviewed in those provider dashboards/contracts.

## Password and authentication handling

- The password exists only in React form state long enough to call `supabase.auth.signInWithPassword` or `supabase.auth.signUp` over HTTPS.
- Application source never hashes, stores, logs, returns, exports, or writes the password to PostgreSQL. Credential hashing and verification are delegated to managed Supabase Auth; [Supabase documents that it stores salted bcrypt hashes](https://supabase.com/docs/guides/auth/password-security). No application MD5/SHA password code exists.
- Supabase tokens are never copied into application records or logs. Credential-shaped error text is redacted.
- Because this is a browser-only SPA, it cannot create an `httpOnly` session cookie. Supabase auth is configured to use `sessionStorage`, not persistent `localStorage`, so the token is scoped to the browser tab/session. A future server/SSR architecture would be required for an httpOnly-cookie session.
- The app creates no application cookies. Consequently there are no cookie flags to configure in this codebase.

## Browser memory and storage

- Zustand/React memory holds the authenticated company's records while the app is open.
- `sessionStorage` holds the Supabase session token; JavaScript can access it, so the existing CSP/input escaping and dependency hygiene remain important XSS controls.
- `localStorage` holds only non-personal UI preferences: chart visibility, selected fiscal year, and a development-only write-timing flag. Legacy fiscal-year keys containing a company UUID are removed when read.
- No email, phone, address, PAN/VAT, party name, cheque/account number, narration, or password is intentionally written to localStorage.

## Response minimization and authorization

- Supabase reads in `src/lib/supabase.ts` now use explicit field projections rather than `select('*')`, including nested voucher children and write `select` responses.
- The browser still receives relational IDs needed to edit, route, join and post accounting records. These are functional identifiers, not unnecessary identity fields.
- Owner queries remain scoped by RLS/company predicates. Developer Dashboard intentionally receives cross-company support fields only under developer-admin policies.
- Realtime subscriptions trigger a scoped refresh; they do not send records to a new third party.

## Logging and audit changes

- Console output is limited to non-sensitive warnings and opt-in development performance timings. Performance output no longer contains company IDs or business payloads.
- Operational app events omit party/voucher IDs and the logging sanitizer redacts credentials, email, phone, addresses, PAN/VAT, account numbers, notes and narration.
- Master and cheque history now stores changed field names with `[CHANGED]`, not full before/after values. The migration also minimizes existing historical snapshots and old frontend-error metadata.
- Required actor/company/entity foreign keys remain in tenant-protected audit rows so actions can be attributed and related; they are not printed to the console.

## Deletion and retention

Settings now includes **Delete my account**, protected by an exact `DELETE` confirmation. `public.delete_my_account()`:

1. requires an authenticated caller;
2. clears nullable audit-attribution references that could block identity deletion;
3. deletes only `auth.uid()` from `auth.users`;
4. relies on declared cascades to delete the caller-owned company and company-scoped companies, accounts, parties, items, categories, vouchers/children, app/master logs, module entitlements, permissions, banks, cheques and cheque events;
5. runs atomically, so any constraint failure rolls the deletion back.

The application cannot erase files the user previously downloaded, printouts, data sent through an OS share target, or backups/provider logs controlled outside Supabase. Provider backup retention and legal/accounting retention requirements must be configured operationally before production use.

## Files changed by this audit

- `src/lib/security.ts`: credential/PII redaction and field-name-only audit summaries.
- `src/lib/supabase.ts`: tab-scoped auth storage, explicit response projections, minimized audits, metadata cleanup, account-deletion client call.
- `src/lib/writePerformance.ts`: company ID removed from console timing output.
- `src/pages/Login.tsx`: secret-safe auth error display.
- `src/pages/Settings.tsx`: non-identifying diagnostics and confirmed account deletion UI.
- `src/pages/Parties.tsx`, `src/components/tables/VoucherTable.tsx`: record IDs removed from operational event metadata.
- `src/lib/reports.ts`: non-identifying fiscal-year localStorage key and cleanup of legacy UUID keys.
- `supabase-personal-data-protection-migration.sql`: historical log minimization and atomic self-deletion RPC.
