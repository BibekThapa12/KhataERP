# KhataERP

**Double-entry accounting, billing and inventory for small businesses in Nepal.**

KhataERP replaces the paper khata and the spreadsheet next to it. Billing staff enter invoices quickly from the keyboard, and every entry posts balanced ledger lines and stock movements behind the scenes. Owners and accountants get Bikram Sambat dates, NPR formatting, VAT and PAN details, and the reports a Nepali business actually files.

It is a React web app on a Supabase (PostgreSQL) backend. Accounting rules are enforced in the database itself, not only in the browser.

---

## Features

**Billing and vouchers**
- Sales, Purchase, Sales Return and Purchase Return invoices with 13% VAT, discounts and credit days
- Receipts, Payments, Journal, Contra, Income, Expense and Stock Adjustment vouchers
- Drafts that never touch the books until they are completed
- Cancellation that reverses every effect and keeps the voucher in history
- Fiscal-year voucher numbering with custom prefixes
- A4 and A5 invoice printing, with an optional payment QR
- Keyboard shortcuts for daily entry: F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9 Purchase, F2 calculator

**Inventory**
- Main and alternate units (for example, case and pieces)
- Weighted Average, FIFO or LIFO valuation
- Saleable, damaged and expired stock conditions
- Serial and IMEI tracking for serialized items
- Slab pricing rules by quantity
- Low-stock alerts, Stock Summary and Stock Ledger

**Parties, banks and cheques**
- Customers and suppliers as Sundry Debtors and Creditors, with PAN/VAT and credit terms
- Multiple bank accounts, Nepal bank list and Cash and Bank Book
- Debtors and creditors ageing

**Reports**
- Day Book, ledger and group statements, transaction registers
- Trial Balance, Profit and Loss, Balance Sheet and Cash Flow
- VAT report for VAT-registered companies, hidden for internal-bookkeeping companies

**Optional modules** (switched on per company by the administrator)
- **Cheque Management:** received and issued cheques, clearing, bouncing and bank linkage
- **POS Counter:** a full-screen retail counter with barcode scanning, VAT-inclusive shelf prices, cash, QR and credit payment, and 80mm thermal receipts

**Data and administration**
- Import masters and opening data from Excel templates
- Company backup and restore, plus an optional Windows agent that syncs cloud backups to a local drive
- Developer dashboard for companies, licenses, modules, backups and diagnostics

---

## Built with

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, React Router |
| Backend | Supabase: PostgreSQL, Auth, Row-Level Security, Edge Functions |
| Testing | Vitest, plus a check that keeps SQL migration copies in sync |
| Hosting | Any static host (the project ships a `vercel.json`) |

---

## Getting started

You need Node.js 20.19 or newer and a free [Supabase](https://supabase.com) project.

### 1. Set up the database

**New Supabase project:** open the SQL Editor, paste the contents of [`supabase/bootstrap.sql`](supabase/bootstrap.sql), and run it once. It contains the base schema and every migration in the right order, so you don't run the individual files afterwards.

**Existing project:** apply the files in [`supabase/migrations/`](supabase/migrations) that are newer than your last applied one, in filename order.

### 2. Configure the app

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Supabase → Settings → API**. Use the public anon key only. See [Security](#security) below.

### 3. Run it

```bash
npm install
npm run dev
```

The app opens at http://localhost:5173. Sign up, create your company, and start entering vouchers.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite and the migration sync check |
| `npm run lint` | Lint the code with oxlint |

---

## Project structure

```text
src/
  pages/          Screens: vouchers, masters, reports, settings, POS
  components/     Forms, tables, layout and shared UI
  lib/            Accounting engine, reports, pricing, dates and validation
  store/          Application state (Zustand)
supabase/
  bootstrap.sql   Complete install for a new database, run once
  migrations/     Database migrations, applied in filename order
  standalone/     Earlier one-off scripts, the full schema and the security audit
  functions/      Edge Functions (scheduled backups)
  tests/          SQL tests
windows-backup-agent/  Optional Windows task that syncs backups to a local drive
docs/             Security, data-flow and setup notes
```

---

## Deployment

```bash
npm run build
```

Deploy the `dist/` folder to Vercel, Netlify, Cloudflare Pages or any static host, and set the same `VITE_*` variables there.

For password reset to work, add your recovery URLs in **Supabase → Authentication → URL Configuration → Redirect URLs**:

```text
https://your-domain.example/reset-password
http://localhost:5173/reset-password
```

Before going live, work through the launch checklist in [docs/production-security-audit.md](docs/production-security-audit.md).

---

## Security

- **Only public values go in the frontend.** Every `VITE_*` variable is bundled into the browser, so it holds just the Supabase URL, the anon key and the optional hCaptcha site key. Never put a service-role key, database password or any other secret there or in this repository.
- **Each company's data is isolated** by Row-Level Security policies on every table. After applying migrations, run [`supabase-security-audit.sql`](supabase/standalone/supabase-security-audit.sql) to confirm the deployed database.
- **The server checks the accounting.** Invoice totals, return limits, voucher numbering and protected company fields are validated in PostgreSQL, so a modified browser can't post unbalanced or tampered entries.
- **If a secret is ever exposed,** rotate it immediately. Deleting it from the latest commit is not enough.

More detail: [personal-data flow](docs/personal-data-flow.md) · [critical-path security audit](docs/critical-path-security-audit.md)

---

## Backups

Administrators can export and restore a company backup from Settings. For scheduled cloud backups that sync to a local Windows drive, follow [docs/automated-backup-setup.md](docs/automated-backup-setup.md) and the [Windows backup agent guide](windows-backup-agent/README.md).

---

## License

KhataERP is proprietary software. The code is visible here for viewing only; it may not be used, copied, modified, deployed or redistributed without written permission. See [LICENSE](LICENSE) for the full terms. For licensing or a subscription, contact [Bibek Thapa](https://github.com/BibekThapa12).

---

Built by [Bibek Thapa](https://github.com/BibekThapa12) for businesses in Nepal.
