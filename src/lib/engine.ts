import type {
  Account, AccountType, Voucher, VoucherLine, StockLine,
  TrialBalance, ProfitAndLoss, BalanceSheet, VatReport, StockEntry, Item
} from '@/types'
import { makeBsKey } from '@/lib/nepaliDate'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const round2 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function normalSide(type: AccountType): 'debit' | 'credit' {
  return type === 'Asset' || type === 'Expense' ? 'debit' : 'credit'
}

export function validateBalanced(lines: VoucherLine[]): { valid: boolean; total_debit: number; total_credit: number; diff: number } {
  const total_debit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0))
  const total_credit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0))
  const diff = round2(total_debit - total_credit)
  return { valid: Math.abs(diff) < 0.005, total_debit, total_credit, diff }
}

// ─── Default Chart of Accounts ────────────────────────────────────────────────

export function defaultChartOfAccounts(company_id: string): Omit<Account, 'balance'>[] {
  const base = (id: string, name: string, type: AccountType, group: string, is_system = true) => ({
    id, company_id, name, type, group, is_system, is_party: false, opening_balance: 0,
  })
  return [
    base('cash', 'Cash', 'Asset', 'Current Assets'),
    base('bank', 'Bank Account', 'Asset', 'Current Assets'),
    base('inventory', 'Stock-in-Hand', 'Asset', 'Current Assets'),
    base('vat_payable', 'VAT Payable (Output)', 'Liability', 'Duties & Taxes'),
    base('vat_receivable', 'VAT Receivable (Input)', 'Asset', 'Duties & Taxes'),
    base('sales', 'Sales Account', 'Income', 'Sales Accounts'),
    base('purchase', 'Purchase Account', 'Expense', 'Purchase Accounts'),
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

// ─── Voucher Builders ─────────────────────────────────────────────────────────

interface InvoiceParams {
  party_account_id: string | null
  is_cash: boolean
  items: { item_id: string; qty: number; rate: number }[]
  vat_rate: number
  discount?: number
  narration?: string
  date?: string
  date_bs?: string
  invoice_no?: string
}

export function buildSalesVoucherData(p: InvoiceParams) {
  const subtotal = round2(p.items.reduce((s, l) => s + l.qty * l.rate, 0))
  const discount = p.discount || 0
  const taxable = round2(subtotal - discount)
  const vat_amount = round2(taxable * (p.vat_rate / 100))
  const total = round2(taxable + vat_amount)
  const lines: Omit<VoucherLine, 'id' | 'voucher_id'>[] = [
    { account_id: p.is_cash ? 'cash' : p.party_account_id!, debit: total, credit: 0 },
    { account_id: 'sales', debit: 0, credit: taxable },
  ]
  if (vat_amount > 0) lines.push({ account_id: 'vat_payable', debit: 0, credit: vat_amount })
  const stock_lines = p.items.map(l => ({ item_id: l.item_id, qty: l.qty, rate: l.rate, direction: 'out' as const }))
  return { subtotal, discount, vat_rate: p.vat_rate, vat_amount, total, lines, stock_lines, invoice_items: p.items }
}

export function buildPurchaseVoucherData(p: InvoiceParams) {
  const subtotal = round2(p.items.reduce((s, l) => s + l.qty * l.rate, 0))
  const discount = p.discount || 0
  const taxable = round2(subtotal - discount)
  const vat_amount = round2(taxable * (p.vat_rate / 100))
  const total = round2(taxable + vat_amount)
  const lines: Omit<VoucherLine, 'id' | 'voucher_id'>[] = [
    { account_id: 'purchase', debit: taxable, credit: 0 },
  ]
  if (vat_amount > 0) lines.push({ account_id: 'vat_receivable', debit: vat_amount, credit: 0 })
  lines.push({ account_id: p.is_cash ? 'cash' : p.party_account_id!, debit: 0, credit: total })
  const stock_lines = p.items.map(l => ({ item_id: l.item_id, qty: l.qty, rate: l.rate, direction: 'in' as const }))
  return { subtotal, discount, vat_rate: p.vat_rate, vat_amount, total, lines, stock_lines, invoice_items: p.items }
}

type PaymentMode = 'cash' | 'bank'

export function buildReceiptData(party_account_id: string, amount: number, deposit_to: PaymentMode = 'cash') {
  return {
    total: amount,
    lines: [
      { account_id: deposit_to, debit: amount, credit: 0 },
      { account_id: party_account_id, debit: 0, credit: amount },
    ] as Omit<VoucherLine, 'id' | 'voucher_id'>[],
  }
}

export function buildPaymentData(party_account_id: string, amount: number, paid_from: PaymentMode = 'cash') {
  return {
    total: amount,
    lines: [
      { account_id: party_account_id, debit: amount, credit: 0 },
      { account_id: paid_from, debit: 0, credit: amount },
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
  const assets = accounts.filter(a => a.type === 'Asset' && a.id !== 'inventory')
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
  const output_vat = round2(sales.reduce((s, v) => s + (v.vat_amount || 0), 0))
  const input_vat = round2(purchases.reduce((s, v) => s + (v.vat_amount || 0), 0))
  const taxable_sales = round2(sales.reduce((s, v) => s + ((v.subtotal || 0) - (v.discount || 0)), 0))
  const taxable_purchases = round2(purchases.reduce((s, v) => s + ((v.subtotal || 0) - (v.discount || 0)), 0))
  const net_payable = round2(output_vat - input_vat)
  return { sales, purchases, output_vat, input_vat, taxable_sales, taxable_purchases, net_payable }
}
