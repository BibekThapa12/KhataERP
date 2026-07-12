import type {
  Account, AccountType, Voucher, VoucherLine,
  TrialBalance, ProfitAndLoss, BalanceSheet, VatReport, StockEntry, Item
} from '@/types'
import { makeBsKey } from '@/lib/nepaliDate'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const round2 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100

const round4 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

export function normalSide(type: AccountType): 'debit' | 'credit' {
  return type === 'Asset' || type === 'Expense' ? 'debit' : 'credit'
}

export function validateBalanced(lines: VoucherLine[]): { valid: boolean; total_debit: number; total_credit: number; diff: number } {
  const total_debit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0))
  const total_credit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0))
  const diff = round2(total_debit - total_credit)
  return { valid: Math.abs(diff) < 0.005, total_debit, total_credit, diff }
}

export type SystemAccountKey =
  | 'cash'
  | 'bank'
  | 'inventory'
  | 'vat_payable'
  | 'vat_receivable'
  | 'sales'
  | 'purchase'
  | 'sales_return'
  | 'purchase_return'
  | 'capital'
  | 'discount_allowed'
  | 'rent'
  | 'salary'
  | 'electricity'

export function systemAccountId(company_id: string, key: SystemAccountKey) {
  return `${company_id}:${key}`
}

export function resolveSystemAccountId(accounts: Account[], company_id: string, key: SystemAccountKey) {
  const scoped = systemAccountId(company_id, key)
  if (accounts.some(a => a.id === scoped)) return scoped
  if (accounts.some(a => a.company_id === company_id && a.id === key)) return key
  return scoped
}

// ─── Default Chart of Accounts ────────────────────────────────────────────────

export function defaultChartOfAccounts(company_id: string): Omit<Account, 'balance'>[] {
  const base = (key: SystemAccountKey, name: string, type: AccountType, group: string, is_system = true) => ({
    id: systemAccountId(company_id, key), company_id, name, type, group, is_system, is_party: false, opening_balance: 0,
  })
  return [
    base('cash', 'Cash', 'Asset', 'Current Assets'),
    base('bank', 'Bank Account', 'Asset', 'Current Assets'),
    base('inventory', 'Stock-in-Hand', 'Asset', 'Current Assets'),
    base('vat_payable', 'VAT Payable (Output)', 'Liability', 'Duties & Taxes'),
    base('vat_receivable', 'VAT Receivable (Input)', 'Asset', 'Duties & Taxes'),
    base('sales', 'Sales Account', 'Income', 'Sales Accounts'),
    base('purchase', 'Purchase Account', 'Expense', 'Purchase Accounts'),
    base('sales_return', 'Sales Return Account', 'Income', 'Sales Accounts'),
    base('purchase_return', 'Purchase Return Account', 'Expense', 'Purchase Accounts'),
    base('capital', "Owner's Capital", 'Equity', 'Capital Account'),
    base('discount_allowed', 'Discount Allowed', 'Expense', 'Indirect Expenses', false),
    base('rent', 'Rent Expense', 'Expense', 'Indirect Expenses', false),
    base('salary', 'Salary Expense', 'Expense', 'Indirect Expenses', false),
    base('electricity', 'Electricity Expense', 'Expense', 'Indirect Expenses', false),
  ]
}

// ─── Balance Computation (pure, from voucher list) ────────────────────────────

export function recomputeAllBalances(accounts: Account[], vouchers: Voucher[]): Account[] {
  const byId = new Map(accounts.map(a => [a.id, { ...a, balance: a.opening_balance || 0 }]))
  const sorted = [...vouchers].sort((a, b) =>
    (a.date_bs_key || makeBsKey(a.date_bs)) - (b.date_bs_key || makeBsKey(b.date_bs)) || a.seq - b.seq
  )
  for (const v of sorted) {
    if (v.cancelled || !v.lines) continue
    for (const line of v.lines) {
      const acc = byId.get(line.account_id)
      if (!acc) continue
      const side = normalSide(acc.type)
      const delta = side === 'debit'
        ? (line.debit || 0) - (line.credit || 0)
        : (line.credit || 0) - (line.debit || 0)
      acc.balance = round2(acc.balance + delta)
    }
  }
  return Array.from(byId.values())
}

export function recomputeStock(items: Item[], vouchers: Voucher[]): StockEntry[] {
  const stock = new Map(items.map(i => [i.id, {
    id: i.id, name: i.name, unit: i.unit,
    qty: i.opening_qty || 0,
    avg_cost: i.opening_rate || 0,
    value: round2((i.opening_qty || 0) * (i.opening_rate || 0)),
  }]))
  const sorted = [...vouchers].sort((a, b) =>
    (a.date_bs_key || makeBsKey(a.date_bs)) - (b.date_bs_key || makeBsKey(b.date_bs)) || a.seq - b.seq
  )
  for (const v of sorted) {
    if (v.cancelled || !v.stock_lines) continue
    for (const sl of v.stock_lines) {
      const s = stock.get(sl.item_id)
      if (!s) continue
      if (sl.direction === 'in') {
        const newQty = round2(s.qty + sl.qty)
        const newValue = round2(s.value + sl.qty * sl.rate)
        s.qty = newQty
        s.value = newValue
        s.avg_cost = newQty > 0 ? round2(newValue / newQty) : 0
      } else {
        s.qty = round2(s.qty - sl.qty)
        s.value = round2(s.value - sl.qty * s.avg_cost)
        if (s.qty <= 0.0001) { s.qty = 0; s.value = 0 }
      }
    }
  }
  return Array.from(stock.values())
}

export interface StockSummaryMovement {
  id: string
  opening_qty: number
  opening_value: number
  inward_qty: number
  inward_value: number
  outward_qty: number
  outward_value: number
  closing_qty: number
  closing_rate: number
  closing_value: number
}

/** Replays active stock movements chronologically so outward value uses the
 * weighted-average cost that applied at the time of each movement. */
export function computeStockSummary(items: Item[], vouchers: Voucher[]): StockSummaryMovement[] {
  const summary = new Map(items.map(item => {
    const openingQty = item.opening_qty || 0
    const openingValue = round2(openingQty * (item.opening_rate || 0))
    return [item.id, {
      id: item.id,
      opening_qty: openingQty,
      opening_value: openingValue,
      inward_qty: 0,
      inward_value: 0,
      outward_qty: 0,
      outward_value: 0,
      closing_qty: openingQty,
      closing_rate: item.opening_rate || 0,
      closing_value: openingValue,
    }]
  }))

  const sorted = [...vouchers].sort((a, b) =>
    (a.date_bs_key || makeBsKey(a.date_bs)) - (b.date_bs_key || makeBsKey(b.date_bs)) || a.seq - b.seq
  )
  for (const voucher of sorted) {
    if (voucher.cancelled || !voucher.stock_lines) continue
    for (const line of voucher.stock_lines) {
      const row = summary.get(line.item_id)
      if (!row) continue
      if (line.direction === 'in') {
        const movementValue = round2(line.qty * line.rate)
        row.inward_qty = round2(row.inward_qty + line.qty)
        row.inward_value = round2(row.inward_value + movementValue)
        row.closing_qty = round2(row.closing_qty + line.qty)
        row.closing_value = round2(row.closing_value + movementValue)
        row.closing_rate = row.closing_qty > 0 ? round2(row.closing_value / row.closing_qty) : 0
      } else {
        const movementValue = round2(line.qty * row.closing_rate)
        row.outward_qty = round2(row.outward_qty + line.qty)
        row.outward_value = round2(row.outward_value + movementValue)
        row.closing_qty = round2(row.closing_qty - line.qty)
        row.closing_value = round2(row.closing_value - movementValue)
        if (row.closing_qty <= 0.0001) {
          row.closing_qty = 0
          row.closing_value = 0
          row.closing_rate = 0
        }
      }
    }
  }
  return [...summary.values()]
}

// ─── Voucher Builders ─────────────────────────────────────────────────────────

export interface InvoiceEntryInput {
  item_id: string
  qty: number
  rate: number
  entry_unit?: string
  conversion_factor?: number
  cost_rate?: number
}

interface InvoiceParams {
  party_account_id: string | null
  is_cash: boolean
  items: InvoiceEntryInput[]
  vat_rate: number
  discount?: number
  narration?: string
  date?: string
  date_bs?: string
  invoice_no?: string
  system_accounts?: Partial<Record<SystemAccountKey, string>>
}

const sys = (accounts: InvoiceParams['system_accounts'], key: SystemAccountKey) => accounts?.[key] || key

export function buildSalesVoucherData(p: InvoiceParams) {
  const subtotal = round2(p.items.reduce((s, l) => s + l.qty * l.rate, 0))
  const discount = p.discount || 0
  const taxable = round2(subtotal - discount)
  const vat_amount = round2(taxable * (p.vat_rate / 100))
  const total = round2(taxable + vat_amount)
  const lines: Omit<VoucherLine, 'id' | 'voucher_id'>[] = [
    { account_id: p.is_cash ? sys(p.system_accounts, 'cash') : p.party_account_id!, debit: total, credit: 0 },
    { account_id: sys(p.system_accounts, 'sales'), debit: 0, credit: taxable },
  ]
  if (vat_amount > 0) lines.push({ account_id: sys(p.system_accounts, 'vat_payable'), debit: 0, credit: vat_amount })
  const invoice_items = p.items.map(l => ({ ...l, conversion_factor: l.conversion_factor || 1, base_qty: round4(l.qty * (l.conversion_factor || 1)) }))
  const stock_lines = p.items.map(l => ({ item_id: l.item_id, qty: round4(l.qty * (l.conversion_factor || 1)), rate: round2(l.rate / (l.conversion_factor || 1)), direction: 'out' as const }))
  return { subtotal, discount, vat_rate: p.vat_rate, vat_amount, total, lines, stock_lines, invoice_items }
}

export function buildPurchaseVoucherData(p: InvoiceParams) {
  const subtotal = round2(p.items.reduce((s, l) => s + l.qty * l.rate, 0))
  const discount = p.discount || 0
  const taxable = round2(subtotal - discount)
  const vat_amount = round2(taxable * (p.vat_rate / 100))
  const total = round2(taxable + vat_amount)
  const lines: Omit<VoucherLine, 'id' | 'voucher_id'>[] = [
    { account_id: sys(p.system_accounts, 'purchase'), debit: taxable, credit: 0 },
  ]
  if (vat_amount > 0) lines.push({ account_id: sys(p.system_accounts, 'vat_receivable'), debit: vat_amount, credit: 0 })
  lines.push({ account_id: p.is_cash ? sys(p.system_accounts, 'cash') : p.party_account_id!, debit: 0, credit: total })
  const invoice_items = p.items.map(l => ({ ...l, conversion_factor: l.conversion_factor || 1, base_qty: round4(l.qty * (l.conversion_factor || 1)) }))
  const stock_lines = p.items.map(l => ({ item_id: l.item_id, qty: round4(l.qty * (l.conversion_factor || 1)), rate: round2(l.rate / (l.conversion_factor || 1)), direction: 'in' as const }))
  return { subtotal, discount, vat_rate: p.vat_rate, vat_amount, total, lines, stock_lines, invoice_items }
}

export interface ReturnItemInput {
  id?: string
  source_invoice_item_id: string
  item_id: string
  item_name?: string
  unit?: string
  qty: number
  rate: number
  cost_rate: number
  entry_unit?: string
  conversion_factor?: number
  base_qty?: number
}

export interface ReturnVoucherParams {
  type: 'Sales Return' | 'Purchase Return'
  original: Voucher
  items: ReturnItemInput[]
  settlement_mode: 'party' | 'cash' | 'bank'
  settlement_account_id?: string
  restock_items: boolean
  system_accounts?: Partial<Record<SystemAccountKey, string>>
}

export function buildReturnVoucherData(p: ReturnVoucherParams) {
  const subtotal = round2(p.items.reduce((sum, item) => sum + item.qty * item.rate, 0))
  const originalSubtotal = p.original.subtotal || (p.original.invoice_items || []).reduce((sum, item) => sum + item.qty * item.rate, 0)
  const originalDiscount = p.original.discount || 0
  const vatRate = p.original.vat_rate || 0
  let invoice_items = p.items.map(item => {
    const gross = round2(item.qty * item.rate)
    const discount_amount = originalSubtotal > 0 ? round2(originalDiscount * gross / originalSubtotal) : 0
    const taxable_amount = round2(gross - discount_amount)
    const vat_amount = round2(taxable_amount * vatRate / 100)
    return { ...item, discount_amount, taxable_amount, vat_amount }
  })
  const fullOriginalReturn = (p.original.invoice_items || []).length === invoice_items.length &&
    (p.original.invoice_items || []).every(source => {
      const returned = invoice_items.find(item => item.source_invoice_item_id === source.id)
      return returned && Math.abs(returned.qty - source.qty) < 0.0001
    })
  if (fullOriginalReturn && invoice_items.length) {
    const allocatedDiscount = round2(invoice_items.reduce((sum, item) => sum + item.discount_amount, 0))
    const residualDiscount = round2(originalDiscount - allocatedDiscount)
    invoice_items = invoice_items.map((item, index) => index === invoice_items.length - 1
      ? { ...item, discount_amount: round2(item.discount_amount + residualDiscount), taxable_amount: round2(item.taxable_amount - residualDiscount) }
      : item)
  }
  const discount = round2(invoice_items.reduce((sum, item) => sum + item.discount_amount, 0))
  const taxable = round2(invoice_items.reduce((sum, item) => sum + item.taxable_amount, 0))
  const vat_amount = round2(taxable * vatRate / 100)
  if (invoice_items.length) {
    const allocatedVat = round2(invoice_items.reduce((sum, item) => sum + item.vat_amount, 0))
    const residualVat = round2(vat_amount - allocatedVat)
    invoice_items = invoice_items.map((item, index) => index === invoice_items.length - 1 ? { ...item, vat_amount: round2(item.vat_amount + residualVat) } : item)
  }
  const total = round2(taxable + vat_amount)
  const settlementAccount = p.settlement_mode === 'party'
    ? p.original.party_account_id!
    : p.settlement_account_id || sys(p.system_accounts, p.settlement_mode)
  const isSalesReturn = p.type === 'Sales Return'
  const lines: Omit<VoucherLine, 'id' | 'voucher_id'>[] = isSalesReturn
    ? [
        { account_id: sys(p.system_accounts, 'sales_return'), debit: taxable, credit: 0 },
        ...(vat_amount ? [{ account_id: sys(p.system_accounts, 'vat_payable'), debit: vat_amount, credit: 0 }] : []),
        { account_id: settlementAccount, debit: 0, credit: total },
      ]
    : [
        { account_id: settlementAccount, debit: total, credit: 0 },
        { account_id: sys(p.system_accounts, 'purchase_return'), debit: 0, credit: taxable },
        ...(vat_amount ? [{ account_id: sys(p.system_accounts, 'vat_receivable'), debit: 0, credit: vat_amount }] : []),
      ]
  const stock_lines = isSalesReturn
    ? (p.restock_items ? p.items.map(item => ({ item_id: item.item_id, qty: round4(item.qty * (item.conversion_factor || 1)), rate: item.cost_rate, direction: 'in' as const })) : [])
    : p.items.map(item => ({ item_id: item.item_id, qty: round4(item.qty * (item.conversion_factor || 1)), rate: item.cost_rate, direction: 'out' as const }))
  return { subtotal, discount, vat_rate: vatRate, vat_amount, total, lines, stock_lines, invoice_items }
}

export function buildReceiptData(party_account_id: string, amount: number, deposit_to_account_id: string) {
  return {
    total: amount,
    lines: [
      { account_id: deposit_to_account_id, debit: amount, credit: 0 },
      { account_id: party_account_id, debit: 0, credit: amount },
    ] as Omit<VoucherLine, 'id' | 'voucher_id'>[],
  }
}

export function buildPaymentData(party_account_id: string, amount: number, paid_from_account_id: string) {
  return {
    total: amount,
    lines: [
      { account_id: party_account_id, debit: amount, credit: 0 },
      { account_id: paid_from_account_id, debit: 0, credit: amount },
    ] as Omit<VoucherLine, 'id' | 'voucher_id'>[],
  }
}


// ─── Reports ──────────────────────────────────────────────────────────────────

export function computeTrialBalance(accounts: Account[]): TrialBalance {
  const rows = accounts
    .map(a => {
      const side = normalSide(a.type)
      const bal = a.balance || 0
      const debit = (side === 'debit' ? bal > 0 : bal < 0) ? Math.abs(bal) : 0
      const credit = (side === 'credit' ? bal > 0 : bal < 0) ? Math.abs(bal) : 0
      return { id: a.id, name: a.name, type: a.type, debit: round2(debit), credit: round2(credit) }
    })
    .filter(r => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.name.localeCompare(b.name))
  const total_debit = round2(rows.reduce((s, r) => s + r.debit, 0))
  const total_credit = round2(rows.reduce((s, r) => s + r.credit, 0))
  return { rows, total_debit, total_credit, balanced: Math.abs(total_debit - total_credit) < 0.01 }
}

export function computeProfitAndLoss(accounts: Account[], closing_stock_value = 0): ProfitAndLoss {
  const income = accounts.filter(a => a.type === 'Income')
  const expense = accounts.filter(a => a.type === 'Expense')
  const total_income = round2(income.reduce((s, a) => s + (a.balance || 0), 0))
  const total_expense_raw = round2(expense.reduce((s, a) => s + (a.balance || 0), 0))
  const total_expense = round2(total_expense_raw - closing_stock_value)
  const net_profit = round2(total_income - total_expense)
  return { income, expense, total_income, total_expense_raw, total_expense, closing_stock_value, net_profit }
}

export function computeBalanceSheet(accounts: Account[], net_profit: number, closing_stock_value = 0): BalanceSheet {
  const assets = accounts.filter(a => a.type === 'Asset' && a.id !== 'inventory' && !a.id.endsWith(':inventory'))
  const liabilities = accounts.filter(a => a.type === 'Liability')
  const equity = accounts.filter(a => a.type === 'Equity')
  const total_assets_base = round2(assets.reduce((s, a) => s + (a.balance || 0), 0))
  const total_assets = round2(total_assets_base + closing_stock_value)
  const total_liabilities = round2(liabilities.reduce((s, a) => s + (a.balance || 0), 0))
  const total_equity_base = round2(equity.reduce((s, a) => s + (a.balance || 0), 0))
  const total_equity = round2(total_equity_base + net_profit)
  const assets_for_display = closing_stock_value !== 0
    ? [...assets, { id: 'inventory', name: 'Stock-in-Hand (Closing)', type: 'Asset' as AccountType, group: 'Current Assets', is_system: true, is_party: false, opening_balance: 0, balance: closing_stock_value, company_id: '' }]
    : assets
  return { assets: assets_for_display, liabilities, equity, total_assets, total_liabilities, total_equity, balanced: Math.abs(total_assets - (total_liabilities + total_equity)) < 0.01 }
}

export function computeVatReport(vouchers: Voucher[], from_date: string, to_date: string): VatReport {
  const fromKey = makeBsKey(from_date)
  const toKey = makeBsKey(to_date)
  const in_range = vouchers.filter(v => {
    const key = v.date_bs_key || makeBsKey(v.date_bs)
    return !v.cancelled && key >= fromKey && key <= toKey
  })
  const sales = in_range.filter(v => v.type === 'Sales')
  const purchases = in_range.filter(v => v.type === 'Purchase')
  const sales_returns = in_range.filter(v => v.type === 'Sales Return')
  const purchase_returns = in_range.filter(v => v.type === 'Purchase Return')
  const sales_return_vat = round2(sales_returns.reduce((s, v) => s + (v.vat_amount || 0), 0))
  const purchase_return_vat = round2(purchase_returns.reduce((s, v) => s + (v.vat_amount || 0), 0))
  const taxable_sales_returns = round2(sales_returns.reduce((s, v) => s + ((v.subtotal || 0) - (v.discount || 0)), 0))
  const taxable_purchase_returns = round2(purchase_returns.reduce((s, v) => s + ((v.subtotal || 0) - (v.discount || 0)), 0))
  const output_vat = round2(sales.reduce((s, v) => s + (v.vat_amount || 0), 0) - sales_return_vat)
  const input_vat = round2(purchases.reduce((s, v) => s + (v.vat_amount || 0), 0) - purchase_return_vat)
  const taxable_sales = round2(sales.reduce((s, v) => s + ((v.subtotal || 0) - (v.discount || 0)), 0) - taxable_sales_returns)
  const taxable_purchases = round2(purchases.reduce((s, v) => s + ((v.subtotal || 0) - (v.discount || 0)), 0) - taxable_purchase_returns)
  const net_payable = round2(output_vat - input_vat)
  return { sales, purchases, sales_returns, purchase_returns, output_vat, input_vat, sales_return_vat, purchase_return_vat, taxable_sales, taxable_purchases, taxable_sales_returns, taxable_purchase_returns, net_payable }
}
