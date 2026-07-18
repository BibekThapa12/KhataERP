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
