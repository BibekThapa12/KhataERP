# Missing vouchers: implementation and evidence

## Gaura Suppliers loading follow-up

Read-only production queries subsequently succeeded for Gaura Suppliers (`92cd4243-1b58-4b93-b903-7129c4db91eb`): 1,077 vouchers, 340 accounts, 304 parties, 42 items, 2,475 invoice items, 2,340 ledger lines, and 2,519 stock movements. These are privileged database counts, not a claim that an authenticated client loaded the same IDs. No production records were modified.

The client reported an indefinite “Loading company data…” screen. Local review found first-load deduplication keyed by an active-company ID that changes during hydration, ordinary focus/reconnect refreshes invalidating in-flight reads, and missing read deadlines. Fixed by stable user/company-identity load keys, sharing initial/background reads for ordinary refresh requests, abortable 45-second page/company-access read deadlines, and a 120-second full-snapshot deadline. Post-commit reads still invalidate older data. No partial history is published. The precise request hanging in the client's deployed browser remains unverified.

Follow-up validation: 42 test files / 233 tests pass, including first-load/focus coalescing and a never-resolving initial snapshot becoming a retryable error. No database migration is needed for this loading follow-up.

## Safety and live evidence (2026-09-20)

- Work is on the existing `main` worktree. No commit, push, production migration, historical repair, or voucher write was executed.
- Linked Supabase project: `qmyskqlmnamvjoffhvzv` (from `.temp/project-ref`). Project identity should still be confirmed by an administrator before deployment.
- `supabase inspect db table-stats --linked` reached the configured pooler but failed with `LegacyDbConnectError: Connection timed out`.
- Initial production inspection timed out. A later explicitly authorized test setup targeted `khata erp test` (`mylnujpiabkpjnxaxlsh`), verified it was empty, and partially initialized its schema before bootstrap verification failed. No voucher write/rollback tests ran. Disabling its backup job failed with a permission error.
- The user subsequently requested removing only the test-project configuration and stopping staging setup. The test runner and two setup SQL scripts were removed. The partially initialized remote test schema was NOT deleted or rolled back. Production configuration was never changed. Continue local missing-voucher validation; do not substitute production for integration write tests.
- **Production API row limit, affected voucher IDs, deployed function/trigger/RLS definitions, and historical posting anomalies are UNVERIFIED.** No clean historical audit is claimed. Missing access is not a zero-count result.

## Confirmed code findings

| Finding | Reproduction / evidence | Consequence | Correction / remaining risk |
|---|---|---|---|
| Unpaginated accounting history | Original `fetchVouchers`, `fetchAccounts`, `fetchItems`, and `fetchParties` made one select each | A server response cap becomes an apparently complete history, affecting every balance and stock consumer | Exact-count, stable-ID paginated reads; regression datasets exceed both a 1,000-row cap and a smaller simulated cap |
| Independently capped child arrays | Original voucher query embedded ledger, invoice, stock, and settlement arrays | A large individual invoice can load incompletely even if header paging is added | Children are now top-level paginated queries, explicitly scoped through their parent company |
| Settlement schema errors hidden | Original code used `[]` for errors matching `does not exist` or `schema cache` | Outstanding/allocation calculations silently lose input | Propagate the error and retain the last complete snapshot as stale |
| Broad query fallback | Any voucher-query error retried a legacy date ordering | Schema/auth failures could be obscured | Removed fallback; use current BS fields and deterministic ID tie-breaks |
| Local-only voucher updates | Saves/cancellations changed local arrays and applied deltas using `get()` after awaiting writes | Old-company responses could contaminate the current company's arrays; edits absent from an array were not inserted | Voucher mutations reconcile full company inputs; publish vouchers, balances, and stock together; captured user/company/identity and read-generation guards |
| Unguarded loader catch | `loadAll` checked successful load generations but not its catch | Obsolete failures could replace a new company's status | Guard failure and success paths; tests cover logout, switching companies, and newer committed reads |
| Hidden write-on-read repair | `loadAll` automatically rewrote system masters and opening-balance sign/category mappings when `bootstrap_version < 1` | Inspecting/loading legacy companies could change accounting data | Removed legacy repair block from ordinary loading. First-account onboarding remains separate from existing-company repairs |
| Silent party collapse | Original hydration deduplicated parties by `account_id` | Multiple persisted rows could disappear without evidence | Preserve fetched IDs; diagnostic counts can expose discrepancies |

## Implemented paths

- `completeFetch.ts`: deterministic ID-ordered pagination that advances by the actual returned length and proves completion with an empty final page. It avoids repeated PostgreSQL exact-count scans, tolerates server caps below the requested page size, rejects repeated IDs/unavailable data/page errors, and never publishes a partial result.
- `supabase.ts`: all-history vouchers, ledger/invoice/stock children, settlements, accounts, parties, items, both category sets, pricing rules/slabs. Parent header revisions are checked again after child reads; unmatched children fail hydration. Company filtering is retained and existing RLS still applies.
- `companySnapshot.ts`: batched reads and existing engine recomputation, with company ownership checks. No repair writes.
- `useAppStore.ts`: voucher save/edit/cancel/draft save/delete reconciliation; captured company identity; stale flags; post-commit failure returns a saved result instead of repeating the write; bounded read-only retry; no incremental voucher-array publication.
- `reconciliationQueue.ts`: coalesces concurrent requests and rereads if a later commit invalidates an in-flight read. Old success/failure callbacks do not publish.
- `App.tsx` / `AccountingSyncStatus.tsx`: revalidate on reconnect/focus/visibility, retain session/realtime reloads, show stale status with read-only retry, and do not render an initial failed partial dataset as ready.
- `accountingIntegrity.ts` / `AccountingIntegrityPanel.tsx`: Settings → Company Admin → Accounting Integrity Check. Admin-gated read-only check and JSON export. Includes company/reference/ID/check/severity/evidence, database/API/client comparison, status/dates/ownership, required children, debit/credit balance, invoice totals, goods/service stock handling, settlements, and same-engine financial snapshots. No automatic repair.
- Existing accounting engine, BS fiscal selectors, voucher numbering, historical records, VAT, stock valuation formulas, and posting SQL were not modified.

## Diagnostic migration

`supabase/migrations/202609200001_accounting_integrity_manifest.sql` adds only `accounting_integrity_manifest(uuid)`.

- STABLE, read-only function; explicit target-company predicates for all tables.
- Company-admin/developer-admin authorization, authenticated-only execute, fixed search path.
- Returns database counts and voucher IDs as scalar JSON, avoiding PostgREST result-row truncation.
- Synced verbatim into base schema and complete staging bootstrap.
- **Not applied to any database.** Validate and apply in the isolated staging environment first. The UI labels the database comparison unavailable if the RPC is missing; it does not report zero records or a clean audit.

## Validation status

Automated coverage includes complete-fetch caps, duplicate/date-tied rows, failed pages, unavailable data, masters >1,000 rows, vouchers >1,000 rows, >1,500 children on one voucher, settlements >1,000 rows, tenant filtering, discarded stale reads, overlapping refreshes, logout, company switches, failed post-save refresh and read-only retry, zero-value/service lines, returns, missing children, invalid references, and read-only checker behavior.

Latest local validation: **41 test files / 228 tests passed**; Vite production build passed (bundle-size warning); Oxlint passed with existing warnings; accounting migration-copy/static checks and `git diff --check` passed. Full TypeScript checking is **not clean**: existing errors include chart tooltip types, dialog event types, legacy module-response casts, test Node typings, category audit arguments, and duplicate item fields. `tsc --noEmit` at the root is insufficient because the root config only contains references; use `tsc -b` or `tsc -p tsconfig.app.json --noEmit`.

## Remaining validation / limitations (do not treat these as completed)

1. Authenticate against the confirmed project and compare database manifest, authenticated API, client, and actual visible Sales/Purchase/report IDs, including older fiscal years. The new export compares full history, not a user's current search-filtered DOM.
2. Run RLS isolation and administrator authorization against the deployed SQL, including an ordinary member and an unrelated-company administrator. Static review is not an execution test.
3. Run isolated database posting failure injection after each child-write stage; confirm header, children, numbering, and audit writes roll back together. Local SQL uses atomic functions, but deployed definitions were not retrieved.
4. Exercise every voucher workflow and report after writes and browser refresh; verify all financial outputs independently. The checker uses the existing engine, so it is not an independent proof of that engine's formulas.
5. Existing draft completion is still a create-completed-then-delete-draft workflow. It is not a single server transaction. A failure between these operations can retain both records; a durable server-side completion/idempotency design needs isolated tests before changing numbering/posting behavior.
6. Voucher revision checks detect header changes during loading, but separate HTTP reads are not a PostgreSQL repeatable-read snapshot. Concurrent master changes or direct child edits without a header revision remain a consistency risk. Do not claim serializable snapshot guarantees.
7. Full-history reconciliation intentionally prioritizes correctness; profile large-company latency in staging before rollout. Diagnostic JSON contains authorized accounting evidence; treat downloaded reports as confidential.

Any historical data correction must be reviewed and authorized separately. No historical repair script was generated or executed.
