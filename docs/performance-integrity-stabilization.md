# Performance and integrity stabilization

## Confirmed baseline

- Regression boundary: commit `da3950a` changed company hydration to separate full-history child scans and made voucher mutations wait for full reconciliation.
- Gaura Suppliers read-only production counts during investigation: 1,102 vouchers, 2,437 ledger lines, 2,540 stock lines, 2,494 invoice items, and 552 settlements.
- The 500-row loader required about 30 accounting-history HTTP requests per snapshot.
- Production `pg_stat_statements` averages were 3.33 s for `voucher_lines`, 3.43 s for `stock_lines`, and 3.52 s for `invoice_items`; observed maxima approached the authenticated role's 8 s statement timeout.
- A read-only production `EXPLAIN` showed nested parent/child loops plus repeated member/admin RLS subplans. No `EXPLAIN ANALYZE`, migration, or write was run against production.

## Implemented locally

- `get_company_accounting_snapshot(uuid)` validates membership once and returns one statement-consistent scalar JSON document containing voucher headers and all four child collections, plus independently verified counts.
- The client rejects malformed, duplicated, cross-company, unmatched-child, or count-mismatched snapshots. It no longer scans the three slow child tables during normal company hydration.
- Read policies remain enabled. Permissive `FOR ALL` administrator policies are split into INSERT, UPDATE, and DELETE policies so they no longer add an administrator branch to SELECT plans.
- Voucher create/edit/cancel responses are published directly into Zustand and only affected accounts/items are replayed. Draft deletion removes only the draft.
- Realtime voucher and child events are coalesced into targeted voucher reads. Master events refresh only their collection. Focus/visibility/reconnect events are coalesced and rate-limited before the optimized recovery snapshot.
- Late responses retain user/company identity guards. A post-commit publication failure marks data stale and retries only a read, never the posting request.

## Validation status

- Vitest: 43 files, 238 tests passed.
- Production build: passed.
- Oxlint: passed with existing warnings; no new realtime cleanup warning remains after correction.
- Migration/base-schema/staging-bootstrap synchronization and `git diff --check`: passed.
- Full TypeScript checking remains blocked by the repository's existing unrelated type errors; the new focused files/tests compile through the production build.

## Staging gate

`KhataERP-Test` is not currently visible/configured in the Supabase CLI. The migration has not been applied anywhere. Before production rollout, restore isolated test-project access and run authenticated `EXPLAIN (ANALYZE, BUFFERS)`, RLS isolation, large-data completeness, atomic rollback, workflow/report integrity, and before/after browser benchmarks. Never substitute production for these write tests.
