import type {
  Account, AccountType, Voucher, VoucherLine,
  TrialBalance, ProfitAndLoss, BalanceSheet, VatReport, StockEntry, Item, InventoryValuationMethod, StockLedgerMovement, StockLedgerReport
} from '@/types'
import { makeBsKey } from '@/lib/nepaliDate'
import { toBaseQty, toBaseRate } from '@/lib/units'

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
    base('vat_payable', 'VAT Payable (Output)', 'Liability', 'Duties & Taxes (Liabilities)'),
    base('vat_receivable', 'VAT Receivable (Input)', 'Asset', 'Duties & Taxes (Assets)'),
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

const roundQty = (n: number) => Math.round((Number(n) + Number.EPSILON) * 10_000) / 10_000

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

interface CostLayer { qty: number; rate: number; sourceVoucherId: string }
interface InventoryState { qty: number; value: number; layers: CostLayer[] }
interface IssueCost { qty: number; value: number; rate: number }

function isPostedInventoryVoucher(voucher: Voucher) {
  const workflow = voucher as Voucher & { status?: string; posted?: boolean; deleted_at?: string | null }
  const status = workflow.status?.toLowerCase()
  return !voucher.cancelled && !workflow.deleted_at && workflow.posted !== false && status !== 'draft' && status !== 'unposted' && status !== 'deleted'
}

function replayInventory(items: Item[], vouchers: Voucher[], method: InventoryValuationMethod) {
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
  const states = new Map(items.map(item => {
    const qty = item.opening_qty || 0
    const rate = item.opening_rate || 0
    return [item.id, { qty, value: round2(qty * rate), layers: qty > 0 ? [{ qty, rate, sourceVoucherId: `opening:${item.id}` }] : [] } as InventoryState]
  }))
  const issueCosts = new Map<string, IssueCost>()
  const movements: StockLedgerMovement[] = []
  const voucherById = new Map(vouchers.map(voucher => [voucher.id, voucher]))

  const sorted = [...vouchers].sort((a, b) =>
    (a.date_bs_key || makeBsKey(a.date_bs)) - (b.date_bs_key || makeBsKey(b.date_bs)) || a.seq - b.seq
  )
  for (const voucher of sorted) {
    if (!isPostedInventoryVoucher(voucher) || !voucher.stock_lines) continue
    for (const line of voucher.stock_lines) {
      const row = summary.get(line.item_id)
      const state = states.get(line.item_id)
      if (!row || !state) continue
      let movementValue = 0
      let movementRate = 0
      if (line.direction === 'in') {
        const originalIssue = voucher.type === 'Sales Return' && voucher.original_voucher_id
          ? issueCosts.get(`${voucher.original_voucher_id}:${line.item_id}`)
          : undefined
        const rate = originalIssue?.rate ?? line.rate
        movementRate = round2(rate)
        movementValue = round2(line.qty * movementRate)
        state.qty = roundQty(state.qty + line.qty)
        state.value = round2(state.value + movementValue)
        if (line.qty > 0) state.layers.push({ qty: line.qty, rate, sourceVoucherId: voucher.id })
        row.inward_qty = round2(row.inward_qty + line.qty)
        row.inward_value = round2(row.inward_value + movementValue)
      } else {
        const original = voucher.original_voucher_id ? voucherById.get(voucher.original_voucher_id) : undefined
        const originalRate = voucher.type === 'Purchase Return'
          ? original?.stock_lines?.find(stockLine => stockLine.item_id === line.item_id && stockLine.direction === 'in')?.rate
          : undefined
        const availableQty = Math.min(line.qty, state.qty)
        if (method === 'weighted_average') {
          const issueRate = originalRate ?? (state.qty > 0 ? state.value / state.qty : 0)
          movementValue = round2(availableQty * issueRate)
          state.qty = roundQty(state.qty - availableQty)
          state.value = Math.max(0, round2(state.value - movementValue))
          if (state.qty <= 0.0001) { state.qty = 0; state.value = 0 }
        } else {
          let remaining = availableQty
          const consume = (preferredSource?: string) => {
            const indexes = state.layers.map((_, index) => index)
            if (method === 'lifo') indexes.reverse()
            for (const index of indexes) {
              const layer = state.layers[index]
              if (remaining <= 0 || !layer || (preferredSource && layer.sourceVoucherId !== preferredSource)) continue
              const used = Math.min(remaining, layer.qty)
              movementValue = round2(movementValue + used * layer.rate)
              layer.qty = roundQty(layer.qty - used)
              remaining = roundQty(remaining - used)
            }
          }
          if (voucher.type === 'Purchase Return' && voucher.original_voucher_id) consume(voucher.original_voucher_id)
          consume()
          state.layers = state.layers.filter(layer => layer.qty > 0.0001)
          state.qty = roundQty(state.layers.reduce((sum, layer) => sum + layer.qty, 0))
          state.value = round2(state.layers.reduce((sum, layer) => sum + layer.qty * layer.rate, 0))
        }
        const key = `${voucher.id}:${line.item_id}`
        const prior = issueCosts.get(key) || { qty: 0, value: 0, rate: 0 }
        const issueQty = roundQty(prior.qty + availableQty)
        const issueValue = round2(prior.value + movementValue)
        issueCosts.set(key, { qty: issueQty, value: issueValue, rate: issueQty > 0 ? round2(issueValue / issueQty) : 0 })
        movementRate = line.qty > 0 ? round2(movementValue / line.qty) : 0
        row.outward_qty = round2(row.outward_qty + line.qty)
        row.outward_value = round2(row.outward_value + movementValue)
      }
      row.closing_qty = state.qty
      row.closing_value = state.value
      row.closing_rate = state.qty > 0 ? round2(state.value / state.qty) : 0
      movements.push({
        voucher_id: voucher.id,
        date_bs: voucher.date_bs,
        date_bs_key: voucher.date_bs_key || makeBsKey(voucher.date_bs),
        seq: voucher.seq,
        voucher_type: voucher.type,
        voucher_no: voucher.invoice_no || String(voucher.seq),
        narration: voucher.narration || '',
        inward_qty: line.direction === 'in' ? line.qty : 0,
        inward_rate: line.direction === 'in' ? movementRate : 0,
        inward_value: line.direction === 'in' ? movementValue : 0,
        outward_qty: line.direction === 'out' ? line.qty : 0,
        outward_rate: line.direction === 'out' ? movementRate : 0,
        outward_value: line.direction === 'out' ? movementValue : 0,
        balance_qty: state.qty,
        balance_rate: row.closing_rate,
        balance_value: state.value,
      })
    }
  }
  return { summary: [...summary.values()], issueCosts, movements }
}

export function computeStockSummary(items: Item[], vouchers: Voucher[], method: InventoryValuationMethod = 'weighted_average'): StockSummaryMovement[] {
  return replayInventory(items, vouchers, method).summary
}

export function recomputeStock(items: Item[], vouchers: Voucher[], method: InventoryValuationMethod = 'weighted_average'): StockEntry[] {
  const summary = new Map(computeStockSummary(items, vouchers, method).map(row => [row.id, row]))
  return items.map(item => {
    const row = summary.get(item.id)
    return { id: item.id, name: item.name, unit: item.unit, qty: row?.closing_qty || 0, avg_cost: row?.closing_rate || 0, value: row?.closing_value || 0 }
  })
}

export function inventoryIssueCost(items: Item[], vouchers: Voucher[], voucherId: string, itemId: string, method: InventoryValuationMethod = 'weighted_average'): IssueCost | undefined {
  return replayInventory(items, vouchers, method).issueCosts.get(`${voucherId}:${itemId}`)
}

export function computeStockLedger(item: Item, vouchers: Voucher[], from: string, to: string, method: InventoryValuationMethod = 'weighted_average'): StockLedgerReport {
  const fromKey = makeBsKey(from)
  const toKey = makeBsKey(to)
  const initialQty = item.opening_qty || 0
  const initialRate = item.opening_rate || 0
  const initialValue = round2(initialQty * initialRate)
  const replay = replayInventory([item], vouchers.filter(voucher => (voucher.date_bs_key || makeBsKey(voucher.date_bs)) <= toKey), method)
  const itemMovements = replay.movements
  const before = itemMovements.filter(movement => movement.date_bs_key < fromKey).at(-1)
  const openingQty = before?.balance_qty ?? initialQty
  const openingValue = before?.balance_value ?? initialValue
  const openingRate = openingQty > 0 ? round2(openingValue / openingQty) : 0
  const movements = fromKey <= toKey ? itemMovements.filter(movement => movement.date_bs_key >= fromKey && movement.date_bs_key <= toKey) : []
  const inwardQty = roundQty(movements.reduce((sum, movement) => sum + movement.inward_qty, 0))
  const inwardValue = round2(movements.reduce((sum, movement) => sum + movement.inward_value, 0))
  const outwardQty = roundQty(movements.reduce((sum, movement) => sum + movement.outward_qty, 0))
  const outwardValue = round2(movements.reduce((sum, movement) => sum + movement.outward_value, 0))
  const closing = movements.at(-1)
  return {
    opening_qty: openingQty,
    opening_rate: openingRate,
    opening_value: openingValue,
    inward_qty: inwardQty,
    inward_value: inwardValue,
    outward_qty: outwardQty,
    outward_value: outwardValue,
    closing_qty: closing?.balance_qty ?? openingQty,
    closing_rate: closing?.balance_rate ?? openingRate,
    closing_value: closing?.balance_value ?? openingValue,
    movements,
  }
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
  const invoice_items = p.items.map(l => ({ ...l, conversion_factor: l.conversion_factor || 1, base_qty: toBaseQty(l.qty, l.conversion_factor || 1) }))
  const stock_lines = p.items.map(l => ({ item_id: l.item_id, qty: toBaseQty(l.qty, l.conversion_factor || 1), rate: toBaseRate(l.rate, l.conversion_factor || 1), direction: 'out' as const }))
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
  const invoice_items = p.items.map(l => ({ ...l, conversion_factor: l.conversion_factor || 1, base_qty: toBaseQty(l.qty, l.conversion_factor || 1) }))
  const stock_lines = p.items.map(l => ({ item_id: l.item_id, qty: toBaseQty(l.qty, l.conversion_factor || 1), rate: toBaseRate(l.rate, l.conversion_factor || 1), direction: 'in' as const }))
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
    ? (p.restock_items ? p.items.map(item => ({ item_id: item.item_id, qty: toBaseQty(item.qty, item.conversion_factor || 1), rate: item.cost_rate, direction: 'in' as const })) : [])
    : p.items.map(item => ({ item_id: item.item_id, qty: toBaseQty(item.qty, item.conversion_factor || 1), rate: item.cost_rate, direction: 'out' as const }))
  return { subtotal, discount, vat_rate: vatRate, vat_amount, total, lines, stock_lines, invoice_items }
}

export interface TransactionAllocation {
  account_id: string
  amount: number
  invoice_allocations?: { invoice_voucher_id: string; amount: number }[]
}

export function buildReceiptData(allocations: TransactionAllocation[], deposit_to_account_id: string) {
  const total = round2(allocations.reduce((sum, allocation) => sum + allocation.amount, 0))
  return {
    total,
    lines: [
      { account_id: deposit_to_account_id, debit: total, credit: 0 },
      ...allocations.map(allocation => ({ account_id: allocation.account_id, debit: 0, credit: round2(allocation.amount) })),
    ] as Omit<VoucherLine, 'id' | 'voucher_id'>[],
  }
}

export function buildPaymentData(allocations: TransactionAllocation[], paid_from_account_id: string) {
  const total = round2(allocations.reduce((sum, allocation) => sum + allocation.amount, 0))
  return {
    total,
    lines: [
      ...allocations.map(allocation => ({ account_id: allocation.account_id, debit: round2(allocation.amount), credit: 0 })),
      { account_id: paid_from_account_id, debit: 0, credit: total },
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
