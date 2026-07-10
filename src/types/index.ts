// ─── Domain Types ────────────────────────────────────────────────────────────

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'
export type VoucherType = 'Sales' | 'Purchase' | 'Sales Return' | 'Purchase Return' | 'Receipt' | 'Payment' | 'Journal' | 'Stock Adjustment'
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
  category_id?: string
  is_archived?: boolean
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
  is_archived?: boolean
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
  reorder_level?: number | null
  category_id?: string
  sku?: string
  barcode?: string
  vat_applicable?: boolean
  is_archived?: boolean
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
  id?: string
  voucher_id?: string
  item_id: string
  qty: number
  rate: number
  source_invoice_item_id?: string
  item_name?: string
  unit?: string
  discount_amount?: number
  taxable_amount?: number
  vat_amount?: number
  cost_rate?: number
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
  original_voucher_id?: string
  return_reason?: string
  settlement_mode?: 'party' | 'cash' | 'bank'
  restock_items?: boolean
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
  owner_email?: string
  name: string
  address?: string
  pan_vat?: string
  phone?: string
  vat_enabled?: boolean
  sales_prefix?: string
  purchase_prefix?: string
  receipt_prefix?: string
  payment_prefix?: string
  sales_return_prefix?: string
  purchase_return_prefix?: string
  reset_numbering_fiscal_year?: boolean
  print_format?: 'A5' | 'A4'
  invoice_terms?: string
  payment_qr_text?: string
  logo_url?: string
  plan_status?: 'free' | 'trial' | 'paid' | 'expired'
  trial_ends_at?: string
  support_status?: 'normal' | 'needs_help' | 'blocked'
  developer_notes?: string
  suspended?: boolean
  fiscal_year_start: string
  created_at?: string
}

export interface AccountCategory {
  id: string
  company_id: string
  name: string
  account_type: AccountType
  parent_category_id?: string
  is_system: boolean
  is_archived: boolean
  created_at?: string
}

export interface ItemCategory {
  id: string
  company_id: string
  name: string
  parent_category_id?: string
  is_archived: boolean
  created_at?: string
}

export interface MasterChangeLog {
  id: string
  company_id: string
  user_id?: string
  record_type: string
  record_id: string
  action: string
  old_values: Record<string, unknown>
  new_values: Record<string, unknown>
  created_at: string
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
  sales_returns: Voucher[]
  purchase_returns: Voucher[]
  output_vat: number
  input_vat: number
  sales_return_vat: number
  purchase_return_vat: number
  taxable_sales: number
  taxable_purchases: number
  taxable_sales_returns: number
  taxable_purchase_returns: number
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
