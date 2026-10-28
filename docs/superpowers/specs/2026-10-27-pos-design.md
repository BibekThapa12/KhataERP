# POS counter mode — design

Date: 2026-10-27 · Status: ready for owner approval

## Intent

KhataERP's Sales Invoice form is built for accounting accuracy: party, credit days, due date, unit, rate, narration. A grocery/retail counter needs the opposite: many small bills, one after another, as fast as the cashier can scan. The POS is a **faster front-end for the Sales voucher that already exists**, not a second sales system. Every completed POS bill is an ordinary `Sales` voucher, so Daybook, ledgers, stock, VAT, Profit & Loss and the integrity checks keep working with no changes.

## POS is a module (owner's decision)

Not every business needs a counter, so POS is an optional module, managed exactly like Cheque Management. The developer switches it on or off per company from the Developer Dashboard → company → **Modules**.

- **Catalogue:** a row in `public.modules` with key `pos_counter`, name "POS Counter". Per company, a `public.company_modules` row with the same fields cheques use (enabled, status, billing, payment, price, start and expiry dates).
- **When it's usable:** the same rule as Cheque Management's write access in `chequeEntitlement` (`src/lib/cheques.ts`). The module must be enabled and active; the status must be `active` or `trial`; the start date must have arrived and the module must not be expired. The bill must be paid or waived, or on a trial or included plan. Read-only access means nothing for a counter, so "can read but can't write" counts as **off**.
- **When it's off:** the "POS counter" sidebar link, the F10 shortcut and the POS section in Settings are hidden. Opening `/pos` directly shows "POS Counter unavailable" plus the reason, in the same style as `ChequeModuleGuard`.
- **Turning it off later:** bills already rung up stay as ordinary Sales vouchers and keep working everywhere. The QR-bill edit block still applies, because it depends on the voucher, not the module.
- **Developer dialog:** `CompanyModulesDialog` (`src/pages/DeveloperDashboard.tsx:391`) is hard-wired to `cheque_management`. It gets a module picker so one dialog manages any module in the catalogue.
- *Designer's call:* no server-side enforcement of the module. A POS bill is an ordinary Sales voucher that the Sales Invoice could create anyway, so the module only controls whether the POS screen is offered.

## Who and where

- One grocery/retail counter, one user (the owner or a single cashier) for now.
- Hardware: a USB barcode scanner (acts as a keyboard and sends Enter after the code) and an 80mm thermal receipt printer.
- Payments: mostly cash and QR. QR means a static eSewa/Fonepay QR on the counter; the cashier checks the phone alert and then confirms. Credit sales are rare.

## Goals

1. Ring up a normal scanned bill without touching the mouse.
2. Add any item by scanning its barcode **or** by searching name/SKU in the same box.
3. Take payment as Cash, QR, or Credit (to a chosen customer).
4. Print a receipt for **every** bill, automatically, as soon as payment is confirmed.
5. Clear the screen for the next customer immediately after printing.
6. Post each bill as a completed `Sales` voucher with correct stock, VAT and ledger lines.

## Non-goals (first version)

- Multiple cashiers, cashier logins, shifts, cash float or drawer count.
- Offline selling / sync queue.
- Payment-gateway integration (no dynamic QR, no automatic payment confirmation).
- Split payment (part cash, part QR).
- Weighing-scale integration or price-embedded barcodes.
- Loyalty, coupons, customer display.
- Serialized (IMEI) items on the POS. See "Edge rules".

## Anti-goals (it fails if…)

- A POS bill doesn't match what an equivalent Sales Invoice would post (subtotal, VAT, stock, ledger).
- Saving or printing is slower than writing a paper bill.
- A failed save leaves the cashier unsure whether the bill was recorded. A bill must never be lost or double-posted.
- It breaks or clutters the existing Sales Invoice flow.

## What already exists (build on it)

| Need | Already in the code |
|---|---|
| Barcode on items | `items.barcode` column, edited in Items page, already included in `ITEM_FIELDS` (`src/lib/supabase.ts:179`) and in item search text (`src/lib/selectorOptions.ts:15`) |
| Posting a sale | `saveSalesVoucher` in `src/store/useAppStore.ts:1249` → `buildSalesVoucherData` in `src/lib/engine.ts:581` |
| Cash sale | `is_cash: true` debits the system Cash ledger |
| Slab pricing | the rate logic used by `InvoiceForm` (`pricing_rule_id`, `calculated_rate`) |
| Printing | `printHtmlDocument` and `printPersistedVoucher` in `src/lib/voucherPrinterRegistry.ts` |
| Voucher numbering, date order checks, VAT on/off | handled inside `saveSalesVoucher` |
| Routing | `src/App.tsx`. Every page currently sits inside `<AppShell />` |

## Screen and flow

Route `/pos`, rendered **outside** `AppShell` (full screen, no sidebar) but inside `ProtectedRoute` and a POS module guard. It opens from a new "POS counter" link in the sidebar Transactions group and from **F10** (F2 is the Calculator). Both are shown only when the module is on. A "Back to ERP" link returns to `/`.

Layout (see the sample design in the conversation / `docs/superpowers/specs/pos-sample.html` if added):

- **Top bar:** company name, today's BS date, "Back to ERP".
- **Left:** the search box (always focused) and a result list under it while typing.
- **Right:** the cart (item, qty − / +, line amount, remove), then subtotal, discount, VAT, a big total, and three payment buttons: Cash, QR, Credit.

### The search box

- On Enter: if the text **exactly** equals an active item's `barcode` (or `sku`), add that item at qty 1 and clear the box.
- Otherwise show matching active items (name / SKU / barcode, reusing the existing item search text). Arrow keys + Enter, or a click, adds the item.
- Adding an item already in the cart increases its qty by 1 instead of adding a new row.
- No match: show "No item found for <text>" inline. No sound or popup is required.
- Focus returns to the search box after every action.

### The cart

- Qty is editable and accepts decimals (e.g. `1.5` kg for loose items). Rate defaults to the item's `sell_rate`, and slab pricing applies the same way as on the Sales Invoice.
- Rate override is out of scope for v1 (builder's call whether to allow it; if allowed, reuse the `price_overridden` flag).
- Bill discount: a flat Rs amount (percentage optional).
- VAT uses the company's VAT setting, exactly as the Sales Invoice does.
- Stock below zero: **block, same as the Sales Invoice** (owner's decision). Reuse the check at `InvoiceForm.tsx:424`, and show the message inline on the cart line when the line is added or its qty is raised, not only at payment. A warn-and-allow override is a possible later change.
- **Prices are VAT-inclusive** (owner's decision): `sell_rate` is the shelf price including VAT. The cart shows and sums shelf prices. Before saving, convert each line to an exclusive rate (`rate / (1 + vat_rate/100)`) and convert the bill discount the same way, then call the normal `buildSalesVoucherData`. The saved voucher and receipt show the taxable amount and VAT separately, and the **total must equal the shelf-price sum minus discount**. Any paisa rounding difference must be at most Rs 0.01 per bill and covered by a test in `pos.test.ts` (several items with awkward prices). If VAT is off for the company, there's no conversion. `items.vat_applicable` is stored but not used by Sales today. The POS follows the same bill-level VAT and doesn't add per-item VAT in v1.

### Payment

| Button | Posts as | Extra step |
|---|---|---|
| **Cash** (shortcut F9 or similar) | `is_cash: true` → debit Cash | Optional "tendered" amount; show change. Enter confirms. |
| **QR** | Sales with the debit going to the **QR ledger** chosen in POS settings | One confirm ("Payment received?") |
| **Credit** | `is_cash: false`, `party_account_id` = chosen customer | Pick a customer with the existing party selector; credit days = the party's default |

On confirm: save → print the receipt → clear the cart → focus the search box.

**QR posting needs a small engine change.** Today `buildSalesVoucherData` debits either Cash or the party. Add an optional `settlement_account_id` to `InvoiceParams` / `InvoiceSaveParams`. When it's set, debit that account instead, and store it on the voucher's existing `settlement_account_id` column so the voucher list shows "eSewa" instead of "-". The database has no rule restricting the debit account of a Sales voucher, but the builder must verify a QR sale saves and that Daybook, Cash & Bank book and Registers display it correctly.

*Designer's call:* a QR bill saves with `is_cash: true` (paid at the counter, no credit days, no party) plus `settlement_account_id` = the QR ledger. That keeps it out of Debtors Ageing and receipt allocation. Reports that label `is_cash` bills "Cash" should prefer the settlement ledger name where it's cheap to do so; otherwise "Cash" is acceptable in v1.

*Designer's call:* `InvoiceForm` and `updateSalesVoucher` rebuild lines without `settlement_account_id`, so editing a QR bill there would silently move the debit to Cash. In v1, **block editing** of a completed Sales voucher that has a `settlement_account_id` with a message ("POS QR bill. Cancel it and re-ring it at the POS."). Cancelling and Sales Return keep working. This is the smallest guard that doesn't change the Sales Invoice flow for normal bills.

*Builder's note:* `insertVoucher` uses an idempotency key, but if the insert succeeds and the refresh after it fails, a retry could post a second bill. Reuse the same idempotency key across retries of one cart.

### Saving safely

- `saveSalesVoucher` currently returns `void`. The POS needs the saved voucher (number, totals) for the receipt. Change it to return the new voucher. The existing callers ignore the return value, so nothing else changes.
- Disable the payment buttons while saving to prevent a double-tap double bill (reuse the existing submission-lock helper in `src/lib/submissionLock.ts` if it fits).
- On save failure: keep the cart intact, show the error, and allow retry. Never clear a cart that wasn't saved.
- Each save currently triggers a company reconcile/refresh. If that makes back-to-back bills feel slow, the builder should measure it before changing anything.

### The receipt (80mm)

Printed through `printHtmlDocument` with an 80mm-wide HTML layout:

- Company name, address, PAN/VAT no., phone
- Bill no. (the voucher's `invoice_no`), BS date and time
- Lines: item, qty × rate, amount
- Subtotal, discount, VAT, **total**; payment method; tendered and change for cash
- Customer name for credit bills
- A footer line set in POS settings (e.g. "Thank you, visit again")

Silent printing (no print dialog) depends on browser/kiosk settings and is documented for the user, not solved in code. The receipt must also work from a normal print dialog.

A **"Reprint last bill"** button on the POS screen covers paper jams.

### POS settings

A small section in the existing Settings page (or a settings dialog on the POS screen; builder's call):

- QR ledger (choose from Cash/Bank ledgers)
- Receipt footer text

Store these wherever the company's other settings live. Don't add a new table if a settings column/JSON already exists.

## Edge rules

- **Serialized items:** in v1, scanning or choosing one shows "Sell serialized items from the Sales Invoice" and doesn't add it. *(This is my call. The shop is grocery/retail, and IMEI entry would slow the counter.)*
- **Service items:** can be added; no stock line, same as today.
- **Archived items:** never shown or added.
- **Empty cart:** payment buttons do nothing / show "Add an item first".
- **Leaving with a non-empty cart:** reuse the existing unsaved-changes guard.

## Where to start (build order)

0. **Module:** seed `pos_counter`, add the access check, and make the developer Modules dialog handle any module. → verify: the developer can switch POS on and off for one company, and the sidebar link appears and disappears.
1. **Engine/store groundwork:** `saveSalesVoucher` returns the voucher; add the optional `settlement_account_id` debit for QR. Unit tests in `engine.test.ts` show a QR sale balances and debits the right ledger. → verify: tests pass, the existing Sales Invoice is unchanged.
2. **Cart logic as pure functions** (`src/lib/pos.ts`): add by barcode/SKU, merge same item, qty change, VAT-inclusive → exclusive conversion, totals. Tests in `pos.test.ts`. → verify: the voucher total from `buildSalesVoucherData` equals the shelf-price total within Rs 0.01.
3. **POS page** (`src/pages/Pos.tsx`) and route `/pos` outside `AppShell`, sidebar link and shortcut. → verify: scan → cart → Cash saves a Sales voucher visible in Sales Invoices and Daybook.
4. **QR and Credit payments**, plus POS settings. → verify: a QR bill lands on the chosen ledger; a credit bill shows in Debtors Ageing.
5. **80mm receipt**, auto-print and "Reprint last bill". → verify: prints on the counter's thermal printer at the correct width.
6. **Polish:** keyboard shortcuts, error states, focus handling. → verify: a 10-item scanned cash bill needs no mouse.

## Left to the builder

- Exact component structure and styling (match the existing Tailwind/shadcn-style components in `src/components/ui`).
- Whether POS settings live in Settings or on the POS screen.
- Percentage discount, rate override, and the exact keyboard shortcuts, provided they don't collide with `AppShell`'s existing F-key shortcuts.
