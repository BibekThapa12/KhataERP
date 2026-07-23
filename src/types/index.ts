// ─── Domain Types ────────────────────────────────────────────────────────────

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'
export type VoucherType = 'Sales' | 'Purchase' | 'Sales Return' | 'Purchase Return' | 'Receipt' | 'Payment' | 'Journal' | 'Stock Adjustment'
export type PartyType = 'customer' | 'supplier'
export type PaymentMode = 'cash' | 'bank'
export type InventoryValuationMethod = 'weighted_average' | 'fifo' | 'lifo'
export type StockCondition = 'saleable' | 'damaged' | 'expired'

export interface Account {
  id: string
  company_id: string
  name: string
  type: AccountType
  group: string
  is_system: boolean
  is_party: boolean
  opening_balance: number
  address?: string | null
  contact_no?: string | null
  pan_no?: string | null
  credit_days?: number | null
  bank_account_no?: string | null
  bank_branch?: string | null
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
  phone?: string | null
  pan_vat?: string | null
  address?: string | null
  default_credit_days?: number
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
  alternate_unit?: string | null
  alternate_conversion?: number | null
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
  stock_condition?: StockCondition
  is_transfer?: boolean
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
  entry_unit?: string
  conversion_factor?: number
  base_qty?: number
  discount_amount?: number
  taxable_amount?: number
  vat_amount?: number
  cost_rate?: number
}

export interface VoucherSettlement {
  id?: string
  company_id: string
  settlement_voucher_id: string
  invoice_voucher_id: string
  party_account_id: string
  amount: number
  created_at?: string
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
  supplier_invoice_no?: string | null
  numbering_period?: string
  credit_days?: number
  due_date_ad?: string
  due_date_bs?: string
  due_date_bs_key?: number
  narration?: string
  original_voucher_id?: string
  return_reason?: string
  settlement_mode?: 'party' | 'cash' | 'bank'
  settlement_account_id?: string
  restock_items?: boolean
  party_account_id?: string | null
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
  settlements?: VoucherSettlement[]
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
  inventory_valuation_method?: InventoryValuationMethod
  sales_prefix?: string
  purchase_prefix?: string
  receipt_prefix?: string
  payment_prefix?: string
  sales_return_prefix?: string
  purchase_return_prefix?: string
  journal_numbering_mode?: 'auto' | 'manual'
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
  fiscal_year_configured?: boolean
  created_at?: string
}

export interface AccountCategory {
  id: string
  company_id: string
  name: string
  account_type: AccountType
  parent_category_id?: string | null
  is_system: boolean
  is_archived: boolean
  created_at?: string
}

export interface ItemCategory {
  id: string
  company_id: string
  name: string
  parent_category_id?: string | null
  is_archived: boolean
  created_at?: string
}

export interface MasterChangeLog {
  id: string
  company_id?: string
  user_id?: string
  record_type: string
  record_id?: string
  action: string
  old_values: Record<string, unknown>
  new_values: Record<string, unknown>
  created_at: string
}

export type ModuleStatus = 'active' | 'trial' | 'grace_period' | 'read_only' | 'disabled'
export type ModuleBillingType = 'included' | 'monthly' | 'yearly' | 'one_time' | 'custom'
export type ModulePaymentStatus = 'paid' | 'pending' | 'overdue' | 'waived' | 'cancelled'
export interface AppModule { id:string; key:string; name:string; description?:string; default_price:number; is_active:boolean; created_at?:string }
export interface CompanyModule {
  id:string; company_id:string; module_id:string; is_enabled:boolean; status:ModuleStatus; billing_type:ModuleBillingType;
  price:number; payment_status:ModulePaymentStatus; starts_at?:string|null; expires_at?:string|null;
  settings:Record<string,unknown>; internal_notes?:string; enabled_by?:string; created_at?:string; updated_at?:string; module?:AppModule;
}
export type ChequePermission = 'cheque.view'|'cheque.create'|'cheque.edit'|'cheque.mark_cleared'|'cheque.mark_bounced'|'cheque.cancel'|'cheque.manage_banks'|'cheque.view_parties'|'cheque.view_reports'
export interface ChequeBank {
  id:string; company_id:string; ledger_account_id?:string|null; bank_name:string; branch_name?:string; account_number:string; institution_type?:string; source?:string;
  account_holder_name?:string; contact_number?:string; notes?:string; is_active:boolean; created_by?:string; updated_by?:string; created_at?:string; updated_at?:string;
}
export type ChequeStatus = 'pending'|'cleared'|'bounced'|'cancelled'
export interface Cheque {
  id:string; company_id:string; cheque_number:string; bank_id:string; account_number:string; party_ledger_id:string; amount:number;
  issue_date:string; issue_date_bs:string; issue_date_bs_key:number; due_date:string; due_date_bs:string; due_date_bs_key:number;
  notes?:string; status:ChequeStatus; cleared_at?:string; bounced_at?:string; cancelled_at?:string; status_reason?:string;
  linked_voucher_id?:string; cleared_to_account_id?:string; created_by?:string; updated_by?:string; created_at?:string; updated_at?:string;
}
export interface ChequeEvent { id:string; company_id?:string; cheque_id?:string; bank_id?:string; action:string; old_values?:Record<string,unknown>; new_values?:Record<string,unknown>; actor_id?:string; created_at:string }

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

export interface DetailedProfitLoss {
  directIncome: Account[]
  directExpenses: Account[]
  indirectIncome: Account[]
  indirectExpenses: Account[]
  openingStock: StockEntry[]
  closingStock: StockEntry[]
  openingStockValue: number
  closingStockValue: number
  grossProfit: number
  netProfit: number
  totalIncome: number
  totalExpense: number
  tradingTotal: number
  profitLossTotal: number
  debitTotal: number
  creditTotal: number
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

export interface StockLedgerMovement {
  voucher_id: string
  date_bs: string
  date_bs_key: number
  seq: number
  voucher_type: VoucherType
  voucher_no: string
  narration: string
  inward_qty: number
  inward_rate: number
  inward_value: number
  outward_qty: number
  outward_rate: number
  outward_value: number
  balance_qty: number
  balance_rate: number
  balance_value: number
}

export interface StockLedgerReport {
  opening_qty: number
  opening_rate: number
  opening_value: number
  inward_qty: number
  inward_value: number
  outward_qty: number
  outward_value: number
  closing_qty: number
  closing_rate: number
  closing_value: number
  movements: StockLedgerMovement[]
}
