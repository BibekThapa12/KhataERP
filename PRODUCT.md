# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

KhataERP serves business owners, accountants, and operational or billing staff at small retail and trading businesses in Nepal.

- Business owners need a dependable view of cash, stock, receivables, payables, profit, and financial position.
- Accountants need correct double-entry records, traceable vouchers, fiscal-period controls, VAT reporting, and formal financial reports.
- Billing and operational staff need fast, keyboard-efficient entry for invoices, receipts, payments, returns, stock movements, and cheques without needing to understand every accounting entry behind them.

## Product Purpose

KhataERP provides one system for the daily commercial and accounting work of a Nepali retail or trading business. It connects billing, purchases, inventory, parties, banking and cheque workflows, ledgers, statutory details, and financial reporting while keeping the resulting accounting entries internally consistent.

Success means users can record routine work quickly, retrieve complete historical records, understand the current state of the business, and produce reliable vouchers and reports without maintaining disconnected books or spreadsheets.

## Positioning

KhataERP is a Nepal-first, double-entry accounting ERP. Its distinguishing mechanism is the integration of Bikram Sambat dates, NPR formatting, PAN/VAT workflows, Nepal-oriented accounting terminology, inventory, cheque management, voucher entry, and financial reporting within the same company-scoped accounting model.

## Operating Context

- Users work within an active company and fiscal period, entering Sales, Purchase, Sales Return, Purchase Return, Receipt, Payment, Journal, Contra, Income, Expense, and Stock Adjustment vouchers.
- Sales and Purchase workflows include parties, items, primary and alternate stock units, drafts, VAT, discounts, pricing rules, printing, and returns.
- Users manage customers, suppliers, ledgers, account categories, item categories, inventory, banks, and incoming and outgoing cheques.
- Reports include Day Book, ledger and group statements, transaction registers, Cash and Bank books, Stock Summary, Stock Ledger, receivables and payables, VAT, Trial Balance, Profit and Loss, Balance Sheet, and Cash Flow.
- Printed vouchers and reports are operational records and must remain usable across supported paper sizes.
- The application supports multi-user company access, permission-controlled cheque operations, read-only company states, and developer-administrator diagnostics.

## Capabilities and Constraints

- Double-entry accounting, voucher numbering, balances, stock movements, settlements, VAT, pricing, and report totals must remain internally consistent.
- Historical vouchers and their saved pricing, quantities, tax values, numbering, ledger effects, and print output must not change retroactively unless a user explicitly edits or cancels the relevant record through an authorized workflow.
- Company data must remain isolated through authenticated membership, Row-Level Security, company-scoped reads, and server-side validation.
- The application uses Bikram Sambat dates for user-facing accounting workflows while retaining the required Gregorian representations internally.
- Currency values use NPR conventions and Nepali digit grouping where applicable.
- The product supports VAT-enabled companies and internal-bookkeeping companies without VAT fields or reports.
- Drafts must not affect posted accounting or stock until completion.
- Cancellation preserves history and reverses active accounting effects rather than silently deleting completed transactions.
- Existing keyboard shortcuts and fast sequential data-entry behavior are product requirements, particularly for voucher entry.
- Reports and vouchers must support printing; supported exports must retain the same accounting meaning as their on-screen source.
- The application is a responsive web product. Desktop is the primary high-volume accounting environment, while mobile and narrow-screen access must remain functional.
- The current implementation is React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, React Router, and Supabase PostgreSQL/Auth/RLS.

## Brand Commitments

- Product name: KhataERP, with "Khata ERP" used where the interface separates the wordmark.
- The product is explicitly positioned as "ERP for Nepal."
- Accounting terminology should remain accurate while routine entry flows should stay understandable to non-accountant operational staff.
- The established navy brand identity and existing product functionality are durable commitments unless the user explicitly requests a redesign or rebrand.

## Evidence on Hand

- Product overview, setup, feature, deployment, and security documentation: `README.md`.
- Existing production interface and navigation: `src/App.tsx`, `src/components/layout/AppShell.tsx`, and `src/pages/`.
- Accounting, stock, pricing, settlement, reporting, and voucher behavior: `src/lib/engine.ts`, `src/lib/reports.ts`, `src/lib/managementReports.ts`, and related tests.
- Database integrity, company isolation, atomic posting, and migration history: `supabase/migrations/`, `db migration files/supabase-schema.sql`, and `supabase-complete-staging-bootstrap.sql`.
- Existing print layouts and export behavior: `src/components/reports/`, `src/components/tables/VoucherTable.tsx`, and report pages under `src/pages/reports/`.
- No testimonials, market-share claims, customer counts, or independently verified business-performance claims are established in the repository; future work must not invent them.

## Product Principles

1. **Accounting truth before convenience.** Every shortcut and workflow improvement must preserve balanced entries, correct stock, complete history, and authoritative server validation.
2. **Fast for daily operators.** Common entries should be efficient for billing staff and accountants through predictable focus, keyboard shortcuts, inline creation, and clear recovery from errors.
3. **Nepal-native by default.** Dates, currency, VAT/PAN concepts, fiscal periods, terminology, and printed records should fit the actual operating environment of Nepali businesses.
4. **One source of business reality.** Lists, dashboards, ledgers, stock, outstandings, reports, prints, and exports should reflect the same committed records.
5. **Safe evolution.** New capabilities must preserve tenant isolation, historical records, existing accounting behavior, and compatibility with established workflows.

## Accessibility & Inclusion

- Core workflows must be usable by keyboard, including reliable focus order, visible focus states, selector navigation, shortcuts, dialogs, and Escape behavior.
- Interactive controls require accessible names, appropriate semantic roles, and readable feedback for errors and disabled states.
- Responsive layouts must remain usable on mobile and narrow screens without obscuring controls or accounting tables.
- The interface must support both experienced accountants and operational staff who may not know advanced accounting terminology; labels and error messages should be specific and actionable.
