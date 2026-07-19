# KhataERP critical-path security audit

Date: 2026-07-19

Scope: the React/Vite client, Supabase Data API calls and RPCs, PostgreSQL tables,
functions, triggers and RLS policies in this repository. KhataERP has no custom
Express/Next API, payment-provider SDK, webhook receiver or server-side file
upload endpoint.

## Executive result

The application uses Supabase Auth and PostgreSQL RLS as its real security
boundary. Client route guards are only a user-experience layer. The audit found
and fixed several database-boundary weaknesses. Apply
`supabase-critical-security-hardening-migration.sql` before production; the
source changes alone do not secure an existing Supabase database.

The Supabase-hosted Auth settings listed under "Deployment controls" cannot be
verified from source code and remain launch gates.

## Findings and fixes

### SEC-01 — Tenant could alter paid/support/suspension fields (High, fixed)

- Location: `companies_own` in `supabase-schema.sql`; fields `plan_status`,
  `trial_ends_at`, `support_status`, `developer_notes`, and `suspended` on
  `public.companies`.
- Vulnerability: RLS correctly restricted a user to their company row, but it
  did not restrict which columns the owner could update.
- Exploit: an authenticated tenant could call PostgREST directly and set their
  plan to `paid`, remove suspension, or overwrite developer notes even though
  those controls are absent from the normal settings form.
- Fix: `protect_company_control_fields()` rejects tenant changes to ownership
  and developer-controlled fields. The insert guard permits only secure default
  values. Developer administrators retain the existing management access.

### SEC-02 — Suspension was only a UI control (High, fixed)

- Location: suspension rendering in `src/components/layout/AppShell.tsx`; base
  table policies in `supabase-schema.sql`.
- Vulnerability: a suspended user could bypass the screen and send Data API or
  RPC writes with a still-valid session.
- Exploit: issue inserts or updates from browser developer tools while the
  normal workspace is blocked.
- Fix: `enforce_tenant_write_access()` now guards every company-owned accounting,
  master, voucher, cheque and audit table, including voucher child tables. It
  blocks suspended-tenant writes at PostgreSQL while preserving self-deletion
  and developer maintenance.

### SEC-03 — Internal SECURITY DEFINER helpers were callable (High, fixed)

- Location: system-group, retained-earnings and cheque seeding functions in the
  SQL migrations.
- Vulnerability: PostgreSQL grants function execution to `PUBLIC` by default.
  Several internal helpers accept an arbitrary company UUID and execute as the
  function owner.
- Exploit: an authenticated user who learned another tenant UUID could invoke a
  seed/repair helper against that tenant. The available operations were narrow,
  but this still crossed the tenant boundary.
- Fix: execution is revoked from `PUBLIC`, `anon` and `authenticated` for
  internal helpers and trigger functions. Only intentional caller APIs retain
  grants. Tenant-triggered operations continue working because trigger
  invocation does not require the caller to execute the function directly.

### SEC-04 — Invoice financial snapshots trusted the browser (High, fixed)

- Location: invoice calculations in `src/lib/engine.ts` and JSON accepted by
  `save_voucher_atomic()`.
- Vulnerability: the RPC checked debit equals credit but previously accepted
  browser-provided subtotal, discount, VAT and total snapshots. A custom caller
  could post a balanced ledger with contradictory invoice fields.
- Exploit: alter the request body so displayed invoice totals disagree with the
  ledger, VAT report or item extensions.
- Fix: deferred database validation independently derives item subtotal,
  discount bounds, taxable value, VAT and total, then compares them to the
  voucher header and ledger debit total. Invalid or negative two-sided voucher
  lines are rejected. Validation runs at transaction end so atomic child
  insertion still works.

Rates remain editable by design: this ERP does not have an authoritative fixed
selling-price contract. The server guarantees arithmetic integrity, not a
business rule that every sale must use an item master's suggested price.

### SEC-05 — Return limits were client-only (High, fixed)

- Location: return validation in `src/store/useAppStore.ts` and
  `src/components/forms/ReturnForm.tsx`.
- Vulnerability: a modified request could bypass the UI's source bill, item,
  rate and maximum-return-quantity checks.
- Exploit: link a return to a different item or cumulatively return more than
  the source invoice quantity.
- Fix: deferred database checks verify source invoice type/company/status,
  source invoice-item identity and rate, and the aggregate active returned
  quantity. The original invoice cannot be cancelled while an active linked
  return exists.

### SEC-06 — Cross-company child references were possible (High, fixed)

- Location: RLS policies for `voucher_lines`, `stock_lines` and
  `invoice_items` authorize through the parent voucher.
- Vulnerability: parent ownership was checked, but a caller could try to attach
  a foreign account/item UUID to an owned voucher. RLS on the referenced table
  is not automatically applied by a foreign key.
- Exploit: use a guessed/leaked foreign identifier to create an invalid
  cross-tenant relationship.
- Fix: database transaction-end checks require all referenced accounts, items,
  parties, settlement accounts and original vouchers to belong to the voucher
  company. The atomic RPC keeps its earlier ownership checks as defense in
  depth.

### SEC-07 — Cleared cheque could lack matching accounting (High, fixed invariant)

- Location: `StatusDialog` in
  `src/pages/cheques/ChequeManagement.tsx` and the `cheques` update policy.
- Vulnerability: the browser creates a Receipt and then updates the cheque in a
  second request. A direct caller could previously mark it cleared without a
  receipt, reuse a receipt, or link a mismatched amount/party.
- Exploit: update status to `cleared` while omitting or forging
  `linked_voucher_id`.
- Fix: a deferred constraint requires one unique, active Receipt from the same
  company with matching party, amount, destination debit and party credit. A
  Receipt linked to a cleared cheque cannot be cancelled.
- Residual design debt: receipt creation, cheque update and cheque audit-event
  insertion are still separate client requests. The database now prevents an
  invalid accounting state, but a network failure may require the UI to reload
  the already-completed result. The complete architectural fix is a single
  `clear_received_cheque_atomic` RPC that creates the Receipt, updates the
  cheque and writes one audit event in one transaction.

### SEC-08 — Non-atomic browser backup restore (High, production path closed)

- Location: `handleRestore()` in `src/pages/Settings.tsx`.
- Vulnerability: a JSON file was read without a size limit and restored through
  many independent upserts/deletes. A large file could exhaust browser memory;
  a later failure could leave a partial restore.
- Exploit: select an oversized/malformed file or interrupt a restore after
  master rows but before all voucher children complete.
- Fix: JSON extension/MIME and a 10 MB maximum are checked before `file.text()`.
  Browser restore is disabled in production. Export remains available.
- Required operational replacement: perform restores through a privileged,
  administrator-controlled database backup/import transaction with validation,
  not through the anon browser client.

### SEC-09 — Untrusted logo URL (Medium, fixed)

- Location: Settings `logo_url`, later interpolated into print HTML after HTML
  escaping.
- Vulnerability: arbitrary URL schemes and credential-bearing URLs were
  accepted. HTML escaping prevented direct attribute injection, but arbitrary
  loading was still unnecessary exposure.
- Exploit: store an attacker-controlled URL that is fetched when a voucher is
  printed.
- Fix: client and database accept only credential-free HTTPS URLs up to 2048
  characters. The print attribute remains escaped and the CSP restricts image
  sources.

### SEC-10 — Browser-only auth rate counter is bypassable (Medium, provider gate)

- Location: `src/lib/authRateLimit.ts`.
- Vulnerability: `sessionStorage` throttling improves UX but is not a security
  boundary; it can be cleared or bypassed by calling Supabase Auth directly.
- Exploit: script requests directly against `/auth/v1/token` or
  `/auth/v1/signup` without loading the application.
- Current protection: hCaptcha tokens are passed to Supabase for sign-in and
  sign-up. Supabase Auth also supplies server-side endpoint rate limiting.
- Required deployment fix: verify CAPTCHA enforcement and Auth rate-limit
  settings in the Supabase Dashboard. The local counter must never be cited as
  the server-side defense.

### SEC-11 — Spreadsheet formula injection in CSV exports (High, fixed)

- Location: shared CSV serializer in `src/lib/csv.ts`.
- Vulnerability: party, item, account, narration or other exported text could
  begin with `=`, `+`, `-` or `@`. Excel-compatible applications may interpret
  that cell as a formula rather than data.
- Exploit: an attacker supplies a party name such as a formula payload; an
  administrator later exports and opens the report, causing the spreadsheet
  application to evaluate it. Depending on spreadsheet security settings this
  can trigger links, data exfiltration prompts or legacy command execution.
- Fix: the central serializer prefixes formula-shaped values (including values
  hidden behind leading whitespace/control characters) with an apostrophe
  before applying normal CSV quoting. Unit tests cover formula and comma cases.

### SEC-12 — Expired trials were not enforced (High, fixed)

- Location: `plan_status` and `trial_ends_at` were only consumed by the
  Developer Dashboard; `AppShell` only checked manual suspension.
- Vulnerability: a trial or plan marked expired retained normal accounting
  access, including direct Data API writes.
- Exploit: simply continue using the application after the displayed trial
  period, or bypass any future UI notice with direct Supabase requests.
- Damage: indefinite unpaid feature use and unbounded tenant storage/write cost.
- Fix: new trials receive a server-controlled fourteen-day expiry. Legacy
  null-expiry trials are backfilled from company creation. Expired plans and
  elapsed trials become read-only in PostgreSQL, while company deletion remains
  available. The workspace shows the matching inactive-plan screen. Plan fields
  cannot be changed by the tenant.

### SEC-13 — Master records accepted foreign references and negative stock (High, fixed)

- Location: direct inserts/updates to `accounts`, `parties` and `items`.
- Vulnerability: foreign keys checked that a category/account existed but did
  not require the referenced record to belong to the same company. Browser
  validation of item rates/opening quantities could also be bypassed.
- Exploit: submit a guessed foreign category/account UUID, or insert negative
  opening stock/rates through PostgREST to corrupt reports and valuation.
- Damage: cross-tenant referential corruption and materially false inventory.
- Fix: database triggers now require same-company account/category references,
  matching account category/type/group, non-negative item financial fields,
  valid alternative units, bounded credit days and bounded master text fields.
  Non-stock vouchers and returns also require positive totals.

## Authentication and authorization review

- All application pages except `/login` are nested under `ProtectedRoute`.
  Cheque pages add entitlement and permission guards. The Developer Dashboard
  checks developer membership before loading data.
- Database RLS—not React routing—enforces ownership. Table policies scope rows
  through `my_company_id()`; cheque policies additionally enforce entitlement
  and permission. The hardening migration adds write-time suspension and
  cross-reference checks.
- Helpers that accept record IDs are not IDOR boundaries by themselves. The
  corresponding update/select/delete is constrained by RLS; cheque helpers
  also include explicit `company_id` filters. No endpoint accepts an arbitrary
  user ID and returns that user's data without the database ownership check.
- Supabase Auth handles password hashing and credential verification; the app
  never stores password values in application tables or logs.
- There is no password-reset UI or custom reset-token implementation in this
  repository. If recovery is enabled, use Supabase's recovery flow and set OTP
  expiry to no more than 900 seconds. Do not create application reset-token
  tables.
- JWT signing keys and refresh-token state are Supabase-managed and are not in
  this repository. `signOut()` uses the provider's global scope. Access JWTs
  remain usable until their short expiry even after refresh tokens are revoked;
  sensitive server actions can additionally validate the JWT `session_id`
  against `auth.sessions` if immediate revocation is required.

## Payment and paid-module review

- No Stripe, Razorpay, checkout session, payment webhook or card-data handling
  exists. Therefore webhook-signature validation is not applicable today.
- The accounting `Payment` voucher is not an online payment. Its amount is
  posted through the same atomic, balanced voucher RPC and database validation.
- Cheque Management access is based on `company_modules`; tenant users have
  SELECT-only access to their entitlement. Only developer RLS policies can
  insert/update/delete module entitlements. `company_module_access()` checks
  enabled state, dates, status, billing type and payment status on every cheque
  read/write policy.
- If online billing is added, entitlement must be changed only by a verified
  server-side webhook. Never expose a service-role key or let the browser set
  `payment_status` after a checkout redirect.

## Input, SQL injection, XSS and upload review

- Data access uses the Supabase query builder and typed RPC parameters. No user
  string is concatenated into runtime SQL. Migration-only dynamic SQL uses
  PostgreSQL `format()` identifier quoting over hard-coded/catalog table names.
- React escapes normal text. Print windows that construct HTML use
  `escapePrintHtml`/`esc`; the Stock Ledger print copies DOM already rendered
  and escaped by React. No `dangerouslySetInnerHTML`, `eval`, or executable
  user-upload path was found.
- There is no file-storage/upload endpoint. The only file input is local JSON
  backup import, now bounded and unavailable in production. If document uploads
  are added later, validate magic bytes and size server-side, randomize object
  names, store outside the application origin, and serve as attachment with a
  non-executable content type.

## Deployment controls (must be verified outside this repository)

1. Supabase Auth CAPTCHA enforcement is enabled for both sign-in and sign-up.
2. JWT expiry is at most one hour; refresh-token reuse detection remains on.
3. Recovery OTP expiry is at most 900 seconds before exposing password reset.
4. Server-side Auth rate limits are configured for the expected traffic and
   tested to return HTTP 429. The browser counter is only supplemental.
5. All migrations, ending with
   `supabase-critical-security-hardening-migration.sql`, are applied.
6. Run `supabase-security-audit.sql` and verify every public application table
   has RLS and no unintended function/table grants exist for `anon`.
7. Confirm Vercel supplies only the public Supabase URL/key and hCaptcha site
   key. No service-role, JWT signing, hCaptcha secret or database credential may
   use a `VITE_*` name.

## Adversarial follow-up results

### ID manipulation and unauthenticated access

- URL identifiers are used only to select from data already loaded through
  tenant RLS, or are accompanied by an explicit company filter. Mutation helpers
  that accept only a record ID remain protected by table RLS. The atomic voucher
  RPC independently compares its payload company with `my_company_id()`.
- A read-only anonymous probe against the configured Supabase project returned
  no application rows: application resources rejected the request and
  `developer_admins` returned an empty RLS result. The final migration also
  revokes all table/sequence privileges from `anon` as defense in depth.
- A conclusive IDOR penetration test still requires two disposable authenticated
  users: create data as tenant A, attempt every ID from tenant B, then reverse
  the test. No test credentials were present in the repository, so this live
  destructive test was not fabricated.

### Login and privilege escalation

- No default administrator username/password, test login, backdoor route or
  seeded `developer_admins` record exists.
- Malformed/expired JWT verification is performed by Supabase before RLS. A
  client-modified role claim invalidates the token signature. Developer access
  is looked up in the protected `developer_admins` table using `auth.uid()`; it
  does not trust editable `user_metadata`.
- React guards protect navigation UX, while PostgreSQL policies protect the
  actual data. Guessing `/developer` or a cheque route cannot grant its database
  permissions.

### Abuse paths

- Sign-in and signup use hCaptcha. Supabase Auth rate limits are the server-side
  control; the browser counter is explicitly supplemental and bypassable.
- There is no messaging, referral, promo-code, card-payment or server-side file
  upload feature to abuse. Production browser backup import is disabled.
- Authenticated accounting writes are not routed through a custom API gateway,
  so a per-IP application throttle cannot be enforced by Vercel. Supabase
  project abuse/DDoS controls and quotas must be monitored. If tenant-specific
  write quotas are required, route mutations through an Edge Function/API
  gateway and keep direct table grants disabled rather than adding a contended
  per-row PostgreSQL counter.

### Injection and internal exposure

- Search/filter/login values use Supabase query parameters; no runtime raw SQL
  concatenation was found. Normal React rendering escapes text and generated
  print HTML uses explicit HTML escaping.
- CSV formula injection was found and fixed centrally (SEC-11).
- Local probes of `/.env`, `/.env.local`, `/.git/config`, Swagger/OpenAPI,
  debug, health and admin paths returned either the inert SPA document or an
  access denial; it did not return the requested internal resource. Production output contains
  no source maps, environment files, Git files, API documentation or private-key
  patterns. The public Supabase URL/anon key and hCaptcha site key remain
  intentionally browser-visible.
