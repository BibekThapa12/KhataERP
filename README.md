# Khata ERP — Full-Stack

A full-stack double-entry accounting ERP for small retail/trading businesses in Nepal.
React + TypeScript + Tailwind + shadcn/ui frontend, Supabase backend.

## Stack
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v3, shadcn/ui, Zustand, React Router
- **Backend:** Supabase (PostgreSQL + Auth + Row-Level Security)

## Quick Setup

### 1. Create a Supabase project at supabase.com

### 2. Run the schema
SQL Editor → paste `supabase-schema.sql` → Run.

### 3. Set environment variables
Apply `supabase-integrity-migration.sql` after the base schema to enable database-level numbering and journal-balance guards.
Apply `supabase-fiscal-voucher-numbering-migration.sql` to allow voucher prefixes and numbers to restart independently in each fiscal year.
Apply `supabase-stock-condition-migration.sql` to track saleable, damaged, and expired stock and condition transfers.
Apply `supabase-alternative-units-migration.sql` to enable main and alternative item units.
Apply `supabase-category-hierarchy-migration.sql` to seed editable account roots and enforce three-level account and item category trees.
Apply `supabase-sundry-parties-migration.sql` afterwards to migrate party ledgers into Sundry Debtors and Sundry Creditors.
Apply `supabase-multiple-bank-accounts-migration.sql` to add the Bank category and exact settlement-account tracking.
Apply `supabase-system-account-groups-migration.sql` afterwards to seed and protect the canonical account-group hierarchy, consolidate VAT, and enable Bank OD accounts.
Apply `supabase-retained-earnings-ledger-migration.sql` to create the protected Retained Earnings ledger under Reserves & Surplus.
Apply `supabase-single-company-per-user-migration.sql` to safely remove unused signup duplicates and enforce one company per login account.
Apply `supabase-credit-days-migration.sql` to add party credit defaults and invoice due-date snapshots.
Apply `supabase-inventory-valuation-migration.sql` to enable company-wide Weighted Average, FIFO, or LIFO stock valuation.
Apply `supabase-production-security-migration.sql` before launch so operational error details remain developer-only.
Apply `supabase-critical-security-hardening-migration.sql` last to enforce protected company fields, suspension at the database boundary, server-calculated voucher integrity, return limits, cheque/receipt linkage, and restricted internal function execution.

```bash
cp .env.example .env.local
# Fill in the Supabase public values and VITE_HCAPTCHA_SITE_KEY.
```

### 4. Run locally
```bash
npm install
npm run dev        # http://localhost:5173
```

### 5. Deploy
```bash
npm run build      # output in dist/ — deploy to Vercel, Netlify, Cloudflare Pages, etc.
```

## Security and secrets

- Only `VITE_SUPABASE_URL`, the public Supabase anon/publishable key, and the public hCaptcha site key belong in the frontend environment. Every `VITE_*` value is embedded in the browser bundle and is public.
- Never place a Supabase service-role/secret key, database connection string, Stripe secret key, OAuth client secret, JWT signing secret, or third-party private API key in this repository or in a `VITE_*` variable.
- Keep local and deployment credentials in `.env.local` or the hosting provider's encrypted environment settings. Environment files are ignored by Git; `.env.example` contains placeholders only.
- All application tables defined by the supplied SQL files have Row Level Security enabled and tenant-scoped policies. After applying migrations, verify the deployed database with `supabase-security-audit.sql` before exposing the anon key publicly.
- If a real secret was ever committed, pasted into an issue/build log, or included in a deployed client bundle, removing it from the latest commit is insufficient. Rotate/revoke it immediately and then purge it from Git history where required.
- The personal-data flow and retention audit is in [docs/personal-data-flow.md](docs/personal-data-flow.md). Apply `supabase-personal-data-protection-migration.sql` to minimize historical audit payloads and enable Settings -> Delete my account.
- The production pass/fail review and mandatory Supabase/Vercel launch checks are in [docs/production-security-audit.md](docs/production-security-audit.md).
- The authentication, authorization, accounting-tampering, paid-module, input, XSS, and upload review is in [docs/critical-path-security-audit.md](docs/critical-path-security-audit.md).

## Features
- Multi-user auth (Supabase email/password), data isolated per user via Row-Level Security
- Sales & purchase invoicing with 13% VAT (NPR, Nepali digit grouping)
- Receipts, payments, journal entries
- Inventory at weighted-average cost with low-stock alerts
- Trial Balance, P&L (with closing-stock adjustment), Balance Sheet, VAT Report, Stock Summary
- Voucher cancellation with full reversal
- JSON backup export from Settings

Made with love ❤
