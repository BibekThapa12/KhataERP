# KhataERP write-performance audit

## Scope and measurement rule

This audit maps the current application code. It does not infer production database timings. Browser traces label Supabase awaits as `network_database` because a PostgREST response combines network latency, PostgreSQL/RLS/trigger execution, and response decoding. Database-only time must be read from PostgreSQL statistics using `supabase-write-performance-diagnostics.sql` after exercising a representative development workload.

Enable client traces in a development build with either:

```js
localStorage.setItem('khataerp:write-performance', '1')
location.reload()
```

or `VITE_WRITE_PERF=true`. Disable them with:

```js
localStorage.removeItem('khataerp:write-performance')
```

Each structured log contains a random trace ID, operation, company ID, record type, line count, stage, category, duration, success, database operation, and cumulative query count. It deliberately excludes names, amounts, narration, PAN/VAT values, account numbers, and row payloads.

## Write-flow map

All arrows in the following flows are sequential unless marked `parallel` or `fire-and-forget`.

### Sales and purchase invoices

`InvoiceForm submit` → form validation → Zustand `saveSalesVoucher` / `savePurchaseVoucher` → accounting payload and balance validation → next global sequence SELECT → voucher-number SELECT → voucher header INSERT → voucher-lines bulk INSERT → stock-lines bulk INSERT → invoice-item snapshots bulk INSERT → normalize response → recompute every account balance from loaded vouchers → replay inventory for all loaded items/vouchers → Zustand state update → reset/close or reopen form.

- Create: 6 database round trips for a typical invoice.
- Update: header UPDATE → DELETE voucher lines → DELETE stock lines → DELETE invoice items → DELETE settlements → INSERT voucher lines → INSERT stock lines → INSERT invoice items. This is up to 8 sequential round trips.
- Post-save refetch: none. The complete in-memory balance and stock state is recomputed.
- Contra: represented by Journal entries in the current application; there is no separate Contra voucher type.

### Receipts and payments

`ReceiptPaymentForm submit` → allocation/account validation → build balanced lines → sequence SELECT → voucher-number SELECT → header INSERT → voucher-lines INSERT → settlement DELETE → settlement INSERT → recompute all account balances → Zustand update → reset/close or reopen.

- Create: 4 round trips without allocations linked to invoices; 6 with settlements.
- Update: header UPDATE → three child-table DELETE requests (including unused stock/item tables) → settlement DELETE → line INSERT → settlement helper DELETE again → settlement INSERT. Up to 8 sequential round trips.
- Settlement validation trigger performs voucher, invoice, and party existence checks for each settlement row.

### Journal and contra

`JournalForm submit` → line/balance validation → sequence SELECT → voucher-number SELECT → header INSERT → lines INSERT → recompute all account balances → Zustand update → form completion.

- Create: 4 sequential round trips.
- Update: header UPDATE + four child/settlement DELETE requests + line INSERT = 6 sequential round trips.

### Credit notes and debit notes

Sales Return is the Credit Note flow; Purchase Return is the Debit Note flow.

`ReturnForm submit` → fiscal-year/original-document/party/item/settlement validation → return accounting and inventory payload → sequence SELECT → voucher-number SELECT → header INSERT → voucher-lines INSERT → stock-lines INSERT → invoice-item snapshots INSERT → full account and inventory replay → Zustand update → `app_events` audit write (`fire-and-forget`) → form completion.

- Manual and source-document returns share this persistence path.
- Current UI fiscal-year filtering does not alter this write sequence.

### Stock adjustments and transfers

`StockAdjustmentForm submit` → item/condition/availability validation → sequence SELECT → voucher-number SELECT → header INSERT → stock-lines bulk INSERT (one adjustment line or two transfer lines) → full inventory replay → Zustand update → app-event write (`fire-and-forget`) → dialog close.

- Create: 4 sequential posting round trips plus the asynchronous audit write.

### Voucher cancellation/deletion behavior

Voucher cancellation is an UPDATE of `vouchers.cancelled`, followed by full account and stock recomputation. Vouchers are not physically deleted by the normal cancel flow. During a failed create, the client performs a best-effort voucher DELETE so cascading foreign keys remove children.

### Parties and accounts, including opening balances

- Party create: validation/payload → account INSERT → party INSERT → full account recomputation → full stock replay → state update. Two sequential writes; not currently one database transaction.
- Account create: account INSERT → optional linked-party INSERT → full account recomputation → state update. One or two sequential writes.
- Party update/type change: party UPDATE → linked account UPDATE → full account recomputation → state update → audit auth lookup + audit INSERT (`fire-and-forget`).
- Account update: account UPDATE → optional linked-party INSERT → full balance recomputation → state update → audit (`fire-and-forget`).
- Opening balances are columns on account/item masters, so they use these same flows.

### Items and categories

- Item create/update: one INSERT/UPDATE → full inventory replay → state update. Updates also write audit asynchronously.
- Account category rename: category UPDATE → denormalized account-group UPDATE → state recomputation → asynchronous audit.
- Category hierarchy validation uses database triggers that walk ancestry/descendants and enforce company/type/depth rules.

## Database-side execution involved

- RLS is enabled on all accounting tables. Child voucher tables authorize through an `EXISTS` lookup of the parent voucher and `my_company_id()`.
- `voucher_lines_balance_guard` is a deferred row-level constraint trigger. A bulk insert of N lines invokes the same indexed voucher SUM check N times at commit.
- `validate_voucher_settlement_trigger` performs three existence checks for every inserted/updated settlement.
- Voucher child foreign keys cascade on header deletion. Invoice source links restrict deletion where required.
- Existing relevant indexes include voucher company/date/sequence, voucher number uniqueness by company/type/period, every voucher child `voucher_id`, stock item/condition, settlement company/voucher/party, and source invoice item.
- Account balances and inventory balances are not persisted or updated by database triggers. They are replayed in the browser after every voucher mutation.

## Confirmed structural latency sources to measure

These are code facts, not claims about their percentage of production latency:

1. Voucher creation/editing uses multiple sequential HTTP transactions rather than one atomic database call.
2. Party/account paired writes are also separate transactions.
3. Voucher numbering performs two reads before posting; invoice-number lookup downloads every matching number and reduces it in JavaScript.
4. Voucher updates issue DELETE requests for all three child tables even when a voucher type never uses some of them. Receipt/payment settlement deletion is duplicated when replacement rows exist.
5. The deferred balance trigger repeats an identical aggregate once per affected line.
6. The browser recomputes all loaded ledger and inventory history after each mutation; this cost grows with company history.
7. Audit helpers perform a fresh auth lookup before the audit INSERT and generally run outside the primary write transaction.
8. The current multi-request posting and best-effort cleanup do not provide the requested all-or-nothing database atomicity. This is a correctness/performance architecture gap that should be addressed only after baseline timings are captured.

## Baseline procedure before optimization

For each voucher type, record at least five creates and five edits with 1, 5, and 20 lines. Capture the structured browser logs and then run the SQL diagnostics. Compare:

- `validation_and_payload` (frontend)
- every `network_database` request (combined round trip)
- `client_balance_recompute` / `client_stock_recompute` (frontend cache calculation)
- `zustand_state_update` (cache/state)
- total elapsed and query count
- PostgreSQL mean/total execution time and function time from the diagnostic SQL

This baseline determines whether the next safe change should prioritize a transactional posting RPC, voucher-number generation, trigger consolidation, client incremental recomputation, or network location/configuration.

## Phase 3 bulk-write changes

- Voucher lines, stock movements, and invoice-item snapshots were already inserted as arrays; no per-line write loop existed in normal voucher posting.
- System account categories are now upserted in three dependency-level batches instead of one request per group.
- Legacy, system, uncategorized, and party-ledger account repairs are accumulated locally and persisted with one bulk account upsert.
- Missing party records are inserted in one request.
- Missing item-category assignments are updated in one statement.
- Multiple module audit events are inserted together after one authentication lookup.
- New settlement vouchers no longer issue a pointless DELETE before their first INSERT, and voucher edits no longer delete settlements twice.
- Backup voucher restoration remains a per-voucher flow. Flattening it client-side would widen the partial-failure blast radius; it should only be replaced by a dedicated transactional restore RPC.

## Phase 4 atomic voucher posting

- `supabase-atomic-voucher-posting-migration.sql` adds the security-invoker `save_voucher_atomic` RPC.
- Sales, purchases, receipts, payments, journals, returns, and stock adjustments now send one payload through one client-to-database request.
- The RPC creates the voucher number and global company sequence while holding a transaction-scoped company advisory lock, avoiding both numbering SELECT round trips and concurrent duplicate allocation.
- Header creation/update, old-child replacement, bulk ledger lines, bulk stock movements, bulk invoice snapshots, settlements, and one audit event execute in one PostgreSQL transaction.
- Any validation, RLS, foreign-key, balance-trigger, settlement-trigger, or child-write failure rolls back the header and every child change. The former best-effort cleanup path is no longer used.
- Edits lock the existing voucher row before replacement. Existing immutable identity, type, sequence, voucher number, and creation timestamp are preserved.
- The RPC returns only the saved voucher and its four child collections required to update the local store.
- Cancellation remains a single atomic UPDATE and therefore does not require the posting RPC.

Expected request count after applying the migration:

- Create: 1 posting RPC (previous baseline: 6 requests for a typical invoice).
- Edit: 1 replacement RPC (previous baseline: 8 requests for a typical invoice with settlements).

## Phase 5 write-query optimization

The captured `pg_stat_statements` workload did not show a database query slow
enough to explain the user-visible delay. Normal accounting inserts averaged
about 1–10 ms. The multi-second browser timings were dominated by network
round trips, which Phase 4 removes. For that reason Phase 5 deliberately avoids
adding broad indexes for every possible account, item, party, status, and date
combination.

Changes made:

- Fiscal-year voucher-number allocation now filters by
  `(company_id, type, numbering_period)`, matching the leading columns of the
  existing `vouchers_company_type_period_invoice_no_unique` index. It no longer
  filters numbering through a separate BS-date range when the numbering period
  is already known.
- `my_company_id()` is now a stable, search-path-pinned security-definer lookup
  over the existing unique `companies(user_id)` index. It still derives the
  company exclusively from `auth.uid()`.
- Write RLS policies wrap `my_company_id()` and `auth.uid()` in scalar subqueries
  so PostgreSQL can evaluate them as init-plans once per statement instead of
  repeating membership work for each row of a bulk voucher insert.
- Added only `accounts(category_id)`, because account-group rename writes use
  that exact predicate and the same index supports category foreign-key deletion
  checks. No extra voucher-line, invoice-item, status, creator, or date indexes
  were added without a measured need.
- Existing indexes already cover company sequence allocation, voucher-number
  uniqueness, voucher child replacement/return queries, balance validation,
  stock item/condition lookup, original invoice items, and settlements.
- `supabase-write-performance-diagnostics.sql` now includes read-only
  `EXPLAIN (ANALYZE, BUFFERS)` plans, index size/use statistics, and an audit of
  foreign keys without leading-column indexes. A sequential scan on a tiny
  table is not automatically considered a problem.

Apply `supabase-write-query-optimization-migration.sql` after Phase 4. The
updated Phase 4 migration is idempotent and should be rerun once if an older
copy was already installed, so the voucher-number query uses the existing
numbering-period index.

## Phase 6 trigger review

| Table / trigger | Frequency | Database work | Decision |
| --- | --- | --- | --- |
| `voucher_lines_balance_guard` | Deferred, once per changed row | Re-sums debit and credit for the affected voucher through `idx_vlines_voucher` | Preserved. It repeats for multi-line writes, but measured voucher-line inserts remain low-cost. Converting it to an immediate statement trigger would break valid multi-statement SQL; bypassing it inside the RPC would weaken direct-write protection. |
| `validate_voucher_settlement_trigger` | Before every settlement row | Two voucher PK lookups and one account PK lookup | Preserved. The RPC bulk write still needs this protection for direct SQL/API writes outside the RPC. All lookups use primary keys. |
| Account/item hierarchy guards | Before each affected category row | Parent PK walks plus recursive descendant lookup | Preserved. Parent-category indexes already cover descendant traversal and category writes are infrequent. |
| `account_category_system_guard` | Before each system-category update/delete | Field comparisons; company PK existence check only for delete | Preserved; no balance recalculation or recursive writes. |
| Company system-group and retained-ledger seed triggers | After each new company | Both previously called system-group seeding, causing duplicate upserts | Consolidated into one ordered trigger: system groups, then retained earnings. The standalone retained-ledger repair helper remains self-contained. |
| `cheque_bank_guard` | Before each bank row | Case-insensitive duplicate-bank lookup and optional account PK lookup | Preserved and backed by `(company_id, lower(bank_name))`. Clean databases receive a unique concurrency guard; databases containing legacy duplicate names receive a non-unique lookup index without changing cheque data. |
| `cheque_touch_guard` | Before each cheque row | Bank, party, entitlement/settings, optional clearing-ledger, and permission checks | Preserved. These enforce module access and status transitions; existing PK/unique entitlement indexes cover the lookups. |
| Cheque-bank entitlement seed | After entitlement insert/enable update | One set-based insert of the Nepal bank catalogue | Preserved; it is set-based and runs only when entitlement is enabled. |

There are no balance-maintenance triggers on vouchers, stock movements,
inventory balances, party balances, account balances, or audit logs. Account,
party, and inventory balances remain derived by the existing application replay
engine, so no hidden full-table balance UPDATE is executed during posting.

No reviewed trigger writes back into its own source table recursively. The
company bootstrap writes categories/accounts only, and cheque/category guards
are validation-only. The Phase 4 advisory lock is scoped by company and only
serializes voucher-number allocation for the same tenant.

## Phase 7 RLS review

- Core write policies continue to require `company_id = my_company_id()`.
- Child voucher tables continue to require an indexed parent-voucher `EXISTS`.
- `my_company_id()` still derives the tenant solely from `auth.uid()` through
  the unique `companies(user_id)` index.
- Owner, developer, module-entitlement, cheque-permission, and `auth.uid()`
  checks are wrapped as scalar init-plans where their inputs are constant for
  the statement. This avoids repeating stable permission queries for every row.
- Cheque policies still require all three layers: selected company, active
  module entitlement, and the appropriate user permission.
- Developer policies remain separate permissive policies and still require
  `is_developer_admin()`.
- No service-role key, company name, or hard-coded company identifier is used.
- Existing unique indexes cover module key, company/module entitlement, and
  company/user/permission lookups. No additional RLS support index was needed.

Apply `supabase-trigger-rls-optimization-migration.sql` after the Phase 5 and
Cheque Management migrations. The expanded diagnostics file reports trigger
orientation/frequency, function timing, effective policy definitions, and live
lock waits.

## Phases 8 and 9: affected balance and stock updates

- Database writes do not maintain denormalized account, party, inventory,
  dashboard, trial-balance, receivable/payable, or P&L totals. Those reports
  continue to derive from posted voucher entries, so no historical report is
  rebuilt or persisted during a save.
- The Zustand post-save path no longer calls full account and inventory replay
  for every voucher. It extracts account and item IDs from the new voucher and,
  for edits, unions them with IDs from the previous version so removed lines are
  also corrected.
- Voucher create/edit/cancel applies the exact new movement minus the previous
  movement directly to affected ledger cache rows. Account-master/opening
  changes replay only that ledger. Both paths retain the existing normal
  debit/credit rules.
- Inventory replay is limited to affected items. It remains chronological over
  that item's complete history; this intentionally preserves backdated entries,
  negative-stock limits, weighted average, FIFO/LIFO layers, purchase returns,
  and original-issue cost restoration for sales returns. A naive value delta is
  not used.
- New/updated party ledgers, accounts, and items now recompute only their own
  cache rows. Account-group renames update presentation fields without replaying
  balances, and safe ledger deletion removes only that cache row.
- Full inventory replay remains only on initial company load and when the
  company valuation method changes, because the latter legitimately affects
  every item.

## Phase 10: compact returned data

- `save_voucher_atomic` still returns the saved voucher header because the UI
  inserts it into the local voucher cache without a refetch.
- Child collections now return explicit UI-required fields instead of complete
  table rows. Invoice-item IDs remain present because later returns reference
  the original invoice-item row.
- Voucher creation/editing therefore needs one response and no follow-up fetch;
  cancellation already returns no record payload.
- Rerun `supabase-atomic-voucher-posting-migration.sql` once after deploying
  this client update so the compact response projection is installed.

## Phase 11: targeted cache refresh

- The application uses Zustand rather than React Query/TanStack Query; no
  global query invalidation or query-cache clearing was found.
- Voucher saves replace/add one voucher plus only affected account and stock
  cache rows. Report components remain memoized derivations and are not fetched
  from the database after a save.
- Cheque and issuing-bank mutations now merge the single returned record into
  their respective Zustand collection instead of refetching both complete
  cheque and bank lists.
- Required writes and local cache updates remain awaited. No unrelated report,
  dashboard, master-list, or module refresh extends the form's saving state.

## Phases 12-16: submission, audit, concurrency, and failure safety

- Sales, purchase, return, receipt, payment, journal, stock-adjustment, item,
  and cheque submission handlers now use an immediate ref-backed
  `SubmissionLock`. This closes the interval before React applies the disabled
  button state. Transaction mutations are not launched from effects, and React
  Strict Mode therefore cannot repeat them.
- Every new atomic voucher request carries a UUID idempotency key. A partial
  unique `(company_id, idempotency_key)` index and the company posting lock make
  an identical retry return the original voucher without inserting children or
  a second audit event.
- Creates and edits take one short transaction-scoped advisory lock per company
  after payload/company/account/item validation. This serializes only posting,
  numbering, and stock availability for the same tenant; different companies
  remain independent. Voucher edits additionally lock only their header row.
- Voucher numbers still use the existing format and fiscal-year scope. `MAX +
  1` is now protected by the tenant-scoped transaction lock and the existing
  unique voucher-number index, so concurrent allocation cannot duplicate a
  number.
- A set-based stock availability check runs after child insertion and before
  commit. Because all same-company postings use the same lock, concurrent sales,
  returns, or adjustments cannot both consume the same available quantity.
- The posting RPC keeps exactly one summarized `app_events` record inside the
  same transaction. Module configuration now records one event per save with a
  compact changed-field list instead of several duplicate full snapshots.
- The RPC tracks its current stage. On failure PostgreSQL preserves the original
  user-facing message and SQLSTATE while adding `save_voucher_atomic stage=...`
  to error details. Any failure still rolls back header, ledger lines, stock,
  invoice items, settlements, and audit together.
- Unit coverage includes accounting balance/VAT/stock behavior, affected-cache
  equivalence, duplicate submission locking, and payload sizes of 1, 10, 50,
  and 100 lines. RLS, rollback, permission, and true concurrent-session tests
  must be run against staging Supabase; browser-only tests cannot prove database
  isolation. The diagnostics file now reports RPC timing, idempotency-index
  installation, duplicate voucher audit events, and live lock waits.
