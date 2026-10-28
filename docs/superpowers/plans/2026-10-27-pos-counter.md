# POS Counter Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen `/pos` page where a cashier scans or searches items, takes Cash / QR / Credit payment, and every bill posts as a normal completed `Sales` voucher and prints an 80mm receipt.

**Architecture:** The POS is a thin front-end over the existing `saveSalesVoucher` store action. Cart math lives in a pure module (`src/lib/pos.ts`) that converts VAT-inclusive shelf prices into the exclusive rates `buildSalesVoucherData` expects. QR sales reuse the voucher's existing `settlement_account_id` column as the debit account. Two new company columns hold the POS settings.

**Tech Stack:** React 19, TypeScript, Zustand store (`src/store/useAppStore.ts`), Supabase, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-27-pos-design.md` (approved). Read it before starting.

## Global Constraints

- Every POS bill is a `Sales` voucher saved through `saveSalesVoucher`. No separate POS tables, and no bypassing of `buildSalesVoucherData`.
- Shelf prices (`items.sell_rate`) are **VAT-inclusive**. Bill total = sum(shelf price × qty) − discount, within **Rs 0.01**.
- Below-zero stock **blocks** the line, with the same rule and message as `InvoiceForm.tsx:424-427`.
- Serialized items are refused with: `Sell serialized items from the Sales Invoice`.
- QR bills: `is_cash: true` + `settlement_account_id` = the company's POS QR ledger.
- Completed Sales vouchers with a `settlement_account_id` can't be edited. Error text: `POS QR bill. Cancel it and re-ring it at the POS.`
- `/pos` is inside `ProtectedRoute` but outside `AppShell`. The opener shortcut is **F10** (F2 is the Calculator, F5–F9 are voucher shortcuts).
- POS is a per-company **module**, key `pos_counter`, name `POS Counter`, toggled by the developer exactly like `cheque_management`. When it's off, the sidebar link, F10 and the Settings POS section are hidden, and `/pos` shows `POS Counter unavailable` plus the reason. There is no server-side enforcement.
- Bill-level VAT only. `items.vat_applicable` stays unused, as it is today.
- Work on a feature branch (`feat/pos-counter`), not `main`.
- Test command: `npx vitest run <file>`. Full check before finishing: `npm test`, `npm run build`, `npm run lint`.

## Review Focus

1. **Paisa drift on awkward prices.** A cart of several items like Rs 33, Rs 17.50, qty 1.5 must still total exactly the shelf sum ±0.01. Test: `pos.test.ts › keeps total within a paisa of shelf prices` (Task 3).
2. **Double tap on Cash/QR.** Two quick presses must post one bill. `SubmissionLock` guards the payment handler. Manual check in Task 6, step "double-press".
3. **Scanner sends a code that's both a barcode and a substring of names.** An exact barcode/SKU match must win over the search list. Test: `pos.test.ts › exact barcode wins over name matches` (Task 3).
4. **Stock check counts the whole cart.** Adding the same item via two scans must check the merged qty, not each scan alone. Test: `pos.test.ts › blocks when merged qty exceeds stock` (Task 3).
5. **Company with VAT off.** No inclusive→exclusive conversion, and the total equals the shelf sum. Test: `pos.test.ts › no VAT conversion when VAT disabled` (Task 3).

---

### Task 1: Engine debits a settlement account for QR sales

**Files:**
- Modify: `src/lib/engine.ts:555-595` (`InvoiceParams`, `buildSalesVoucherData`)
- Test: `src/lib/engine.test.ts`

**Interfaces:**
- Produces: `InvoiceParams.settlement_account_id?: string | null`. When it's set and `is_cash` is true, the debit line uses it instead of the system Cash account.

- [ ] **Step 1: Write the failing tests** in the existing `describe('accounting engine integrity')` block:

```ts
it('debits the settlement ledger for a QR sale', () => {
  const data = buildSalesVoucherData({ party_account_id: null, is_cash: true, settlement_account_id: 'c:esewa', items: [{ item_id: 'i1', qty: 2, rate: 100 }], vat_rate: 13, system_accounts: accounts })
  expect(data.lines[0]).toEqual({ account_id: 'c:esewa', debit: 226, credit: 0 })
  expect(validateBalanced(data.lines as VoucherLine[]).valid).toBe(true)
})
it('still debits cash when no settlement ledger is given', () => {
  const data = buildSalesVoucherData({ party_account_id: null, is_cash: true, items: [{ item_id: 'i1', qty: 1, rate: 100 }], vat_rate: 0, system_accounts: accounts })
  expect(data.lines[0].account_id).toBe('c:cash')
})
```

- [ ] **Step 2:** Run `npx vitest run src/lib/engine.test.ts`. Expected: the first test FAILS (debit goes to `c:cash`).
- [ ] **Step 3:** Add `settlement_account_id?: string | null` to `InvoiceParams`. In `buildSalesVoucherData`, the debit account becomes `p.is_cash ? (p.settlement_account_id || sys(p.system_accounts, 'cash')) : p.party_account_id!`. Don't touch `buildPurchaseVoucherData`.
- [ ] **Step 4:** Run the same command. Expected: all engine tests PASS.
- [ ] **Step 5: Commit** `feat(engine): allow settlement ledger debit on cash sales`

---

### Task 2: Store returns the saved sale, stores the QR ledger, blocks editing QR bills

**Files:**
- Modify: `src/store/useAppStore.ts` (`InvoiceSaveParams` ~line 137, `AppState.saveSalesVoucher` type ~line 217, `saveSalesVoucher` ~line 1249, `updateSalesVoucher` ~line 1465)

**Interfaces:**
- Consumes: Task 1's `settlement_account_id`.
- Produces: `saveSalesVoucher(params: InvoiceSaveParams, status?: Voucher['status']) => Promise<Voucher>`, where `InvoiceSaveParams.settlement_account_id?: string | null`.

- [ ] **Step 1:** Add `settlement_account_id?: string | null` to `InvoiceSaveParams`. Change the `saveSalesVoucher` type in `AppState` to return `Promise<Voucher>`.
- [ ] **Step 2:** In `saveSalesVoucher`, add `settlement_account_id: effectiveParams.settlement_account_id ?? undefined` to the `voucher` object passed to `insertVoucher`, and `return newVoucher` after `notifySuccess`. The `measuredWrite` callback must return it too, so `saveSalesVoucher` resolves to the voucher. `buildSalesVoucherData` already receives the field through `effectiveParams`.
- [ ] **Step 3:** At the top of `updateSalesVoucher`, after `existing` is found: if `existing.status === 'Completed' && existing.settlement_account_id`, throw `new Error('POS QR bill. Cancel it and re-ring it at the POS.')`.
- [ ] **Step 4:** Run `npm run build`. Expected: no type errors. `InvoiceForm.tsx:440` ignores the return value, so no caller changes.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(store): return saved sales voucher and guard POS QR bills`

Note: the post-save refresh (`savedCompanyRefresh`) already swallows refresh failures and marks the data stale. A failed refresh after a successful insert therefore doesn't throw, and the cashier won't retry into a duplicate. No change is needed.

---

### Task 3: Pure cart logic

**Files:**
- Create: `src/lib/pos.ts`
- Test: `src/lib/pos.test.ts`

**Interfaces:**
- Consumes: `Item` from `@/types`; `invoiceSubtotal` and `buildSalesVoucherData` (test only) from `@/lib/engine`.
- Produces:

```ts
export interface PosLine { item_id: string; name: string; qty: number; shelf_rate: number }
export type PosAddResult = { ok: true; lines: PosLine[] } | { ok: false; error: string }
export function findPosItemByCode(items: Item[], code: string): Item | undefined        // exact barcode, then exact SKU; trimmed, case-insensitive; skips archived
export function addPosItem(lines: PosLine[], item: Item, availableQty: (itemId: string) => number, qty?: number): PosAddResult  // merges same item_id; qty default 1
export function setPosLineQty(lines: PosLine[], itemId: string, qty: number, item: Item, availableQty: (itemId: string) => number): PosAddResult // qty <= 0 removes the line
export function posTotals(lines: PosLine[], discount: number, vatRate: number): { shelfTotal: number; subtotal: number; discount: number; taxable: number; vat: number; total: number }
export function toInvoiceItems(lines: PosLine[], vatRate: number): { item_id: string; qty: number; rate: number }[]  // exclusive rates
export function exclusiveDiscount(discount: number, vatRate: number): number
```

Rules: `addPosItem` refuses archived items, serialized items (`Sell serialized items from the Sales Invoice`), and non-service items whose merged qty > `availableQty(item.id)`. The stock error text matches `InvoiceForm.tsx:426`: `Not enough stock for "<name>": have <available>, selling <qty> <unit>.` Service items skip the stock check. `availableQty` returns base-unit stock (the POS sells in the item's main `unit` only, conversion factor 1).

Inclusive → exclusive: `rate = round6(shelf_rate / (1 + vatRate/100))`. `posTotals` must return exactly what `buildSalesVoucherData` would compute from `toInvoiceItems` + `exclusiveDiscount` (reuse `invoiceSubtotal` and the same `round2` steps), so the cart display and the saved voucher can't disagree.

- [ ] **Step 1: Write the failing tests** in `pos.test.ts` (build `Item` fixtures with `name`, `unit: 'pcs'`, `sell_rate`, `barcode`, `sku`, `is_serialized`, `is_service`, `is_archived`):
  - `exact barcode wins over name matches`: items `Sugar` (barcode `111`) and `Sugar 111 pack`. `findPosItemByCode(items, ' 111 ')?.name === 'Sugar'`.
  - `falls back to exact SKU`, and `ignores archived items`.
  - `merges a repeated scan into one line`: two `addPosItem` calls give one line with qty 2.
  - `blocks when merged qty exceeds stock`: stock 1, second add returns `{ ok: false }` with error starting `Not enough stock for "`.
  - `refuses serialized items`: error equals `Sell serialized items from the Sales Invoice`.
  - `removes a line when qty set to 0`.
  - `keeps total within a paisa of shelf prices`: lines (33 × 3), (17.5 × 1.5), (113 × 1), discount 10, VAT 13. `posTotals(...).total` is within 0.01 of `33*3 + 17.5*1.5 + 113 - 10`. **And** `buildSalesVoucherData({ party_account_id: null, is_cash: true, items: toInvoiceItems(lines, 13), discount: exclusiveDiscount(10, 13), vat_rate: 13 }).total === posTotals(lines, 10, 13).total`.
  - `no VAT conversion when VAT disabled`: with `vatRate` 0, rates equal shelf rates and total equals the shelf sum minus discount exactly.
- [ ] **Step 2:** Run `npx vitest run src/lib/pos.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/lib/pos.ts` with the signatures above.
- [ ] **Step 4:** Run the same command. Expected: PASS. If the paisa test fails, fix the rounding in `pos.ts`, not the tolerance.
- [ ] **Step 5: Commit** `feat(pos): cart logic with VAT-inclusive pricing`

Slab pricing: out of this task. Task 6 runs `repriceSalesLines` from `src/lib/pricing.ts` over the cart, the same way `InvoiceForm` does.

---

### Task 4: POS Counter module (catalogue, access check, developer toggle)

**Files:**
- Create: `supabase/migrations/202610280001_pos_module.sql`
- Modify: `db migration files/supabase-schema.sql`, `supabase-complete-staging-bootstrap.sql` (append the same insert after the existing `cheque_management` catalogue insert)
- Modify: `src/lib/pos.ts` (add the access function), `src/lib/pos.test.ts`
- Modify: `src/pages/DeveloperDashboard.tsx:391-470` (`CompanyModulesDialog`)

**Interfaces:**
- Consumes: `CompanyModule` from `@/types`; `useAppStore(s => s.companyModules)` (already loaded for cheques).
- Produces:

```ts
export const POS_MODULE_KEY = 'pos_counter'
export function posModuleAccess(entitlement?: CompanyModule | null, today?: string): { enabled: boolean; reason: string }
export function usePosModuleAccess(): { enabled: boolean; reason: string }   // finds the pos_counter entry in companyModules
```

`posModuleAccess` is **enabled** exactly when `chequeEntitlement(...)` (`src/lib/cheques.ts:7`) would give `canWrite: true`, using the same field rules but checking `module.key === 'pos_counter'`. Reasons are `POS Counter is not enabled for this company.`, `The module start date has not arrived.`, `The module has expired.`, `The module is disabled.`, and `Module payment is cancelled.`. Don't modify `chequeEntitlement`. Add `// shortcut: duplicates chequeEntitlement's write rule; extract a shared moduleEntitlement(key) if a third module appears`.

- [ ] **Step 1:** Migration:

```sql
-- POS Counter optional module, toggled per company by the developer.
insert into public.modules(key,name,description,default_price,is_active)
values ('pos_counter','POS Counter','Full-screen retail counter: barcode scanning, cash/QR/credit bills, 80mm receipts',0,true)
on conflict(key) do update set name=excluded.name, description=excluded.description;
```

- [ ] **Step 2: Write the failing tests** in `pos.test.ts` under `describe('posModuleAccess')`:
  - no entitlement → `{ enabled: false, reason: 'POS Counter is not enabled for this company.' }`;
  - `is_enabled: true, status: 'active', billing_type: 'included', module: { key: 'pos_counter', is_active: true }` → enabled;
  - same but `status: 'read_only'` → not enabled;
  - same but `expires_at` before `today` → reason `The module has expired.`;
  - a `cheque_management` entitlement passed in → not enabled.
- [ ] **Step 3:** Run `npx vitest run src/lib/pos.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 4:** Implement `POS_MODULE_KEY`, `posModuleAccess` and `usePosModuleAccess`.
- [ ] **Step 5:** Run the same command. Expected: PASS.
- [ ] **Step 6:** In `CompanyModulesDialog`, replace the hard-coded `modules.find(entry => entry.key === 'cheque_management')` with a selected module:
  - add a "Module" `SearchableSelect` at the top listing `modules` (name), defaulting to `cheque_management` if present, otherwise the first one;
  - `existing` and every field reset (the existing `useEffect` body) whenever the selected module changes;
  - the "Run the Cheque Management migration…" message becomes `Run the module migrations to create the module catalogue.`, shown only when `modules` is empty.

  `save` already uses `module.id`, so no change is needed there.
- [ ] **Step 7:** Apply the migration to dev/staging. As the developer, open a company's Modules dialog, pick "POS Counter", enable it as active / included, and save. Reopen the dialog and confirm both the cheque and POS settings show their own saved values.
- [ ] **Step 8:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 9: Commit** `feat(pos): POS Counter module and multi-module developer dialog`

---

### Task 5: POS settings (QR ledger, receipt footer)

**Files:**
- Create: `supabase/migrations/202610280002_pos_settings.sql`
- Modify: `db migration files/supabase-schema.sql`, `supabase-complete-staging-bootstrap.sql` (append the same `alter table` statements next to the existing `payment_qr_text` column definition, following how `202608180002_sales_payment_qr.sql` was mirrored)
- Modify: `src/types/index.ts` (`Company`), `src/lib/supabase.ts:175` (`COMPANY_FIELDS`), `src/pages/Settings.tsx` (form state, save payload ~line 424, `portableCompanyFields` line 36)

**Interfaces:**
- Produces: `Company.pos_qr_account_id?: string | null` and `Company.pos_receipt_footer?: string | null`.

- [ ] **Step 1:** Migration:

```sql
-- POS counter settings: QR payment ledger and receipt footer.
begin;
alter table public.companies add column if not exists pos_qr_account_id uuid references public.accounts(id) on delete set null;
alter table public.companies add column if not exists pos_receipt_footer text;
alter table public.companies drop constraint if exists companies_pos_receipt_footer_length;
alter table public.companies add constraint companies_pos_receipt_footer_length check (pos_receipt_footer is null or length(pos_receipt_footer) <= 200);
commit;
```

  Check whether any company-update RPC or trigger whitelists columns (search `supabase-complete-staging-bootstrap.sql` for `payment_qr_text` around lines 1136–1156). If one does, add the two columns there in the same migration.
- [ ] **Step 2:** Add both fields to `Company` and `COMPANY_FIELDS`. Add `'pos_receipt_footer'` to `portableCompanyFields`. Don't add `pos_qr_account_id`: account ids don't carry across a backup restore.
- [ ] **Step 3:** In Settings, next to the existing payment QR fields, add a "POS" group, rendered only when `usePosModuleAccess().enabled` (from Task 4):
  - "QR payment ledger": a `SearchableSelect` of non-archived Cash/Bank ledgers. Reuse whatever filter the Receipts form uses for its "deposit to" list.
  - "Receipt footer": an `Input`, `maxLength={200}`, placeholder `Thank you, visit again`.

  Save both through the existing settings save payload.
- [ ] **Step 4:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5:** Apply the migration to the dev/staging Supabase project the way earlier migrations were applied. Save a QR ledger in Settings, reload, and confirm it persists.
- [ ] **Step 6: Commit** `feat(settings): POS QR ledger and receipt footer`

---

### Task 6: 80mm receipt

**Files:**
- Create: `src/lib/posReceipt.ts`
- Test: `src/lib/posReceipt.test.ts`

**Interfaces:**
- Consumes: `Voucher`, `Company` types; `fmtMoney` from `@/lib/utils`.
- Produces:

```ts
export interface PosReceiptInput { company: Company; voucher: Voucher; lines: { name: string; qty: number; shelf_rate: number }[]; paymentLabel: string; tendered?: number; customerName?: string }
export function renderPosReceiptHtml(input: PosReceiptInput): string
```

Content follows the spec's "The receipt (80mm)" section. Use `@page { size: 80mm auto; margin: 0 }` with a body width of 72mm and a monospace font. Lines show shelf prices (what the customer saw). Totals show the voucher's `subtotal`, `discount`, `vat_amount`, and `total`. HTML-escape every user-controlled string (company name, address, item names, footer, customer name). Reuse an existing escape helper if `src/components/tables/VoucherTable.tsx`'s print renderer has one.

- [ ] **Step 1: Write the failing tests:**
  - contains `voucher.invoice_no`, the company name, `fmtMoney(voucher.total)`, and `company.pos_receipt_footer`;
  - shows `Change` with `tendered - total` when `tendered` is given, and no `Change` otherwise;
  - an item named `<b>x</b>` appears escaped (`&lt;b&gt;`).
- [ ] **Step 2:** Run `npx vitest run src/lib/posReceipt.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `renderPosReceiptHtml`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): 80mm receipt renderer`

---

### Task 7: POS page, route, and entry points

**Files:**
- Create: `src/pages/Pos.tsx`, plus `src/components/pos/PosModuleGuard.tsx` (modelled on `src/components/cheques/ChequeModuleGuard.tsx`: shows `Checking module access…` while loading, then `POS Counter unavailable` with `usePosModuleAccess().reason` when it's off)
- Modify: `src/App.tsx` (lazy import and a route `<Route path="/pos" element={<ProtectedRoute authReady={authReady}><PosModuleGuard><PosPage /></PosModuleGuard></ProtectedRoute>} />` placed **before** the `"/"` AppShell route)
- Modify: `src/components/layout/AppShell.tsx` (Transactions nav: `{ to: '/pos', label: 'POS counter', Icon: ScanBarcode, keywords: ['pos', 'counter', 'retail', 'billing'] }` as the first item, shown only when `usePosModuleAccess().enabled`, the same way cheque nav entries are filtered by `chequeAccess` at line ~454; an F10 keydown handler modelled on the F2 calculator handler at line ~559 that navigates to `/pos` only when the module is enabled)

**Interfaces:**
- Consumes: everything from Tasks 2–6; `SearchableSelect` / `partySelectorOption` for the credit customer; `SubmissionLock`; `useUnsavedChangesGuard`; `repriceSalesLines`; store `getStockEntry`, `items`, `company`, `accounts`, `parties`, `itemCategories`, `pricingRules`; `printHtmlDocument` from `@/lib/voucherPrinterRegistry`; `selectedFiscalYearEndBs` from `@/lib/reports`.

Behaviour (layout per the spec and the approved mockup):
- The search input is auto-focused and re-focused after every action. On Enter: `findPosItemByCode`, and if found, `addPosItem` and clear. Otherwise the first highlighted search result is added. Results use the existing item search text (`itemSelectorOption(...).searchText`), limited to 8, with arrow keys moving the highlight. No match shows `No item found for "<text>"` inline.
- Cart rows: name, qty input (decimals allowed) with −/+, line amount (shelf), remove. Errors from `addPosItem`/`setPosLineQty` show inline under the search box. Rates come from `repriceSalesLines` over the cart (keyed by `item_id`) whenever lines change. If a slab applies, the slab rate replaces `shelf_rate` and is treated as VAT-inclusive too.
- Discount: one flat Rs input.
- Payment keys inside the page: **F9** Cash, **F8** QR, **F7** Credit, **F4** Reprint last bill. An empty cart shows `Add an item first`.
  - **Cash:** a tendered input (Enter confirms; empty = exact) and change = tendered − total. Tendered below total shows `Tendered is less than the total`.
  - **QR:** confirm `Payment received?`. If `company.pos_qr_account_id` is unset, show `Set the QR payment ledger in Settings first`.
  - **Credit:** customer `SearchableSelect`. Save with `is_cash: false`, `party_account_id`, `credit_days` = the party's `default_credit_days ?? 0`.
- Save: `saveSalesVoucher({ party_account_id, is_cash, settlement_account_id, items: toInvoiceItems(lines, vatRate), discount: exclusiveDiscount(discount, vatRate), vat_rate: vatRate, credit_days, narration: 'POS', date_bs: today }, 'Completed')`, guarded by a `SubmissionLock`. `vatRate` = `(company?.vat_enabled ?? true) ? 13 : 0`, matching `InvoiceForm.tsx:71,79`. `today` = `selectedFiscalYearEndBs(company)` from `@/lib/reports`, the same default date `InvoiceForm.tsx:73` uses. On success: `printHtmlDocument(renderPosReceiptHtml(...))`, remember it as the last bill for reprint, clear the cart and discount, and focus the search box. On error: keep the cart and show `publicErrorMessage(error)` inline.
- `useUnsavedChangesGuard` is active while the cart is non-empty. "Back to ERP" links to `/`.

- [ ] **Step 1:** Add the route, nav item, and F10 handler. Create `Pos.tsx` with the layout and the search → cart flow (no payment yet).
- [ ] **Step 2:** Run `npm run dev`, log in, press F10. Expected: the full-screen POS shows with no sidebar. Scanning (type a barcode + Enter) adds the item, scanning it again makes qty 2, and a serialized item shows the refusal.
- [ ] **Step 3:** Add Cash, QR, Credit, discount, receipt printing and reprint.
- [ ] **Step 4: Manual checks** (record the results in the PR description):
  - A cash bill of 3 items appears in Sales Invoices and Daybook, and its total equals the shelf sum.
  - A QR bill posts its debit to the configured QR ledger (check Ledger report and Cash & Bank book). Opening it from Sales Invoices → Edit shows `POS QR bill. Cancel it and re-ring it at the POS.`
  - A credit bill appears in Debtors Ageing for that customer.
  - **Double-press:** pressing F9 then Enter twice fast creates exactly one voucher.
  - Selling more than in stock is blocked with the stock message.
  - The receipt prints at 80mm width (or prints correctly in the print preview set to 80mm).
  - A 10-item scanned cash bill needs no mouse.
  - With the module switched off for the company: no sidebar link, F10 does nothing, Settings has no POS group, `/pos` shows `POS Counter unavailable`, and earlier POS bills still open normally in Sales Invoices.
- [ ] **Step 5:** Run `npm test && npm run build && npm run lint`. Expected: all PASS.
- [ ] **Step 6: Commit** `feat(pos): POS counter page`
