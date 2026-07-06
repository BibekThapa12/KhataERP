// ─── Domain Types ────────────────────────────────────────────────────────────

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'
export type VoucherType = 'Sales' | 'Purchase' | 'Receipt' | 'Payment' | 'Journal'
export type PartyType = 'customer' | 'supplier'
export type PaymentMode = 'cash' | 'bank'

export interface Account {
  id: string
  company_id: string
  name: string
  type: AccountType
  group: string
  is_system: boolean
  is_party: boolean
  opening_balance: number
  balance: number // computed, not stored in DB
  created_at?: string
}

export interface Party {
  id: string
  company_id: string
  name: string
  type: PartyType
  phone?: string
  pan_vat?: string
  address?: string
  account_id: string
  created_at?: string
  // joined
  account?: Account
}

export interface Item {
  id: string
  company_id: string
  name: string
  unit: string
  sell_rate: number
  opening_qty: number
  opening_rate: number
  reorder_level?: number
  created_at?: string
  // computed
  stock_qty?: number
  avg_cost?: number
  stock_value?: number
}

export interface VoucherLine {
  id?: string
  voucher_id?: string
  account_id: string
  debit: number
  credit: number
  account?: Account
}

export interface StockLine {
  id?: string
  voucher_id?: string
  item_id: string
  qty: number
  rate: number
  direction: 'in' | 'out'
  item?: Item
}

export interface InvoiceItem {
  item_id: string
  qty: number
  rate: number
}

export interface Voucher {
  id: string
  company_id: string
  type: VoucherType
  date: string
  date_ad: string
  date_bs: string
  date_bs_key: number
  invoice_no?: string
  narration?: string
  party_account_id?: string
  is_cash: boolean
  subtotal?: number
  discount?: number
  vat_rate?: number
  vat_amount?: number
  total: number
  cancelled: boolean
  seq: number
  created_at?: string
  // joined
  lines?: VoucherLine[]
  stock_lines?: StockLine[]
  invoice_items?: InvoiceItem[]
  party?: Party
}

export interface Company {
  id: string
  user_id: string
  name: string
  address?: string
  pan_vat?: string
  phone?: string
  fiscal_year_start: string
  created_at?: string
}

// ─── Report Types ─────────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  id: string
  name: string
  type: AccountType
  debit: number
  credit: number
}

export interface TrialBalance {
  rows: TrialBalanceRow[]
  total_debit: number
  total_credit: number
  balanced: boolean
}

export interface ProfitAndLoss {
  income: Account[]
  expense: Account[]
  total_income: number
  total_expense_raw: number
  total_expense: number
  closing_stock_value: number
  net_profit: number
}

export interface BalanceSheet {
  assets: Account[]
  liabilities: Account[]
  equity: Account[]
  total_assets: number
  total_liabilities: number
  total_equity: number
  balanced: boolean
}

export interface VatReport {
  sales: Voucher[]
  purchases: Voucher[]
  output_vat: number
  input_vat: number
  taxable_sales: number
  taxable_purchases: number
  net_payable: number
}

export interface StockEntry {
  id: string
  name: string
  unit: string
  qty: number
  avg_cost: number
  value: number
}
