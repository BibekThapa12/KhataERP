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
Apply `supabase-alternative-units-migration.sql` to enable main and alternative item units.

```bash
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from Supabase → Settings → API
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

## Features
- Multi-user auth (Supabase email/password), data isolated per user via Row-Level Security
- Sales & purchase invoicing with 13% VAT (NPR, Nepali digit grouping)
- Receipts, payments, journal entries
- Inventory at weighted-average cost with low-stock alerts
- Trial Balance, P&L (with closing-stock adjustment), Balance Sheet, VAT Report, Stock Summary
- Voucher cancellation with full reversal
- JSON backup export from Settings
