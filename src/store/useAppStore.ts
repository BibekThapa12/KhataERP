import { create } from 'zustand'
import type { Account, Company, Item, Party, StockEntry, Voucher, VoucherLine, StockLine } from '@/types'
import {
  fetchAccounts, fetchParties, fetchItems, fetchVouchers,
  insertAccount, insertAccounts, insertParty, insertItem,
  insertVoucher, cancelVoucher, updateCompany, updateItem, updateParty,
  updateVoucher, getNextSeq, getNextVoucherNo, getOrCreateCompany, logAppEvent,
} from '@/lib/supabase'
import {
  defaultChartOfAccounts, recomputeAllBalances, recomputeStock,
  buildSalesVoucherData, buildPurchaseVoucherData, buildReceiptData, buildPaymentData,
  resolveSystemAccountId, validateBalanced, type SystemAccountKey,
} from '@/lib/engine'
import { bsToAd, makeBsKey } from '@/lib/nepaliDate'

interface AppState {
  // Auth
  userId: string | null
  setUserId: (id: string | null) => void

  // Data
  company: Company | null
  accounts: Account[]      // with computed balances
  rawAccounts: Account[]   // opening balances only (for recompute)
  parties: Party[]
  items: Item[]
  stock: StockEntry[]
  vouchers: Voucher[]
  loading: boolean
  error: string | null

  // Derived helpers
  getAccount: (id: string) => Account | undefined
  getParty: (id: string) => Party | undefined
  getPartyByAccountId: (accountId: string) => Party | undefined
  getItem: (id: string) => Item | undefined
  getStockEntry: (itemId: string) => StockEntry
  partyAccounts: (type: 'customer' | 'supplier') => (Party & { account?: Account })[]
  closingStockValue: () => number

  // Actions
  loadAll: (userId: string) => Promise<void>
  saveCompany: (updates: Partial<Company>) => Promise<void>

  addParty: (data: { name: string; type: 'customer' | 'supplier'; phone?: string; pan_vat?: string; address?: string; opening_balance?: number }) => Promise<Party>
  addItem: (data: { name: string; unit: string; sell_rate?: number; opening_qty?: number; opening_rate?: number; reorder_level?: number }) => Promise<Item>
  addAccount: (data: { name: string; type: Account['type']; group: string }) => Promise<Account>

  saveSalesVoucher: (params: { party_account_id: string | null; is_cash: boolean; items: {item_id: string; qty: number; rate: number}[]; vat_rate: number; discount?: number; narration?: string; date_bs: string }) => Promise<void>
  savePurchaseVoucher: (params: { party_account_id: string | null; is_cash: boolean; items: {item_id: string; qty: number; rate: number}[]; vat_rate: number; discount?: number; narration?: string; date_bs: string }) => Promise<void>
  saveReceipt: (params: { party_account_id: string; amount: number; deposit_to: 'cash' | 'bank'; narration?: string; date_bs: string }) => Promise<void>
  savePayment: (params: { party_account_id: string; amount: number; paid_from: 'cash' | 'bank'; narration?: string; date_bs: string }) => Promise<void>
  saveJournal: (params: { lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]; narration?: string; date_bs: string }) => Promise<void>
  saveStockAdjustment: (params: { item_id: string; qty_delta: number; rate: number; narration?: string; date_bs: string }) => Promise<void>
  updateSalesVoucher: (id: string, params: { party_account_id: string | null; is_cash: boolean; items: {item_id: string; qty: number; rate: number}[]; vat_rate: number; discount?: number; narration?: string; date_bs: string }) => Promise<void>
  updatePurchaseVoucher: (id: string, params: { party_account_id: string | null; is_cash: boolean; items: {item_id: string; qty: number; rate: number}[]; vat_rate: number; discount?: number; narration?: string; date_bs: string }) => Promise<void>
  updateReceipt: (id: string, params: { party_account_id: string; amount: number; deposit_to: 'cash' | 'bank'; narration?: string; date_bs: string }) => Promise<void>
  updatePayment: (id: string, params: { party_account_id: string; amount: number; paid_from: 'cash' | 'bank'; narration?: string; date_bs: string }) => Promise<void>
  updateJournal: (id: string, params: { lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]; narration?: string; date_bs: string }) => Promise<void>
  cancelV: (id: string) => Promise<void>
}

function voucherDateFields(date_bs: string) {
  const date_ad = bsToAd(date_bs)
  return {
    date: date_ad,
    date_ad,
    date_bs,
    date_bs_key: makeBsKey(date_bs),
  }
}

function replaceVoucherInState(vouchers: Voucher[], nextVoucher: Voucher) {
  return vouchers.map(v => v.id === nextVoucher.id ? nextVoucher : v)
}

function companyPrefix(company: Company, type: 'Sales' | 'Purchase' | 'Receipt' | 'Payment') {
  if (type === 'Sales') return company.sales_prefix || 'INV-'
  if (type === 'Purchase') return company.purchase_prefix || 'PB-'
  if (type === 'Receipt') return company.receipt_prefix || 'RCPT-'
  return company.payment_prefix || 'PAY-'
}

function systemAccountsFor(company: Company, accounts: Account[]) {
  const keys: SystemAccountKey[] = ['cash', 'bank', 'inventory', 'vat_payable', 'vat_receivable', 'sales', 'purchase', 'capital', 'discount_allowed', 'rent', 'salary', 'electricity']
  return Object.fromEntries(keys.map(key => [key, resolveSystemAccountId(accounts, company.id, key)])) as Record<SystemAccountKey, string>
}

export const useAppStore = create<AppState>((set, get) => ({
  userId: null,
  setUserId: (id) => set({ userId: id }),
  company: null,
  accounts: [],
  rawAccounts: [],
  parties: [],
  items: [],
  stock: [],
  vouchers: [],
  loading: false,
  error: null,

  // ─── Derived ────────────────────────────────────────────────────────────────
  getAccount: (id) => get().accounts.find(a => a.id === id),
  getParty: (id) => get().parties.find(p => p.id === id),
  getPartyByAccountId: (accountId) => get().parties.find(p => p.account_id === accountId),
  getItem: (id) => get().items.find(i => i.id === id),
  getStockEntry: (itemId) => get().stock.find(s => s.id === itemId) ?? { id: itemId, name: '', unit: '', qty: 0, avg_cost: 0, value: 0 },
  partyAccounts: (type) =>
    get().parties.filter(p => p.type === type).map(p => ({
      ...p,
      account: get().accounts.find(a => a.id === p.account_id),
    })),
  closingStockValue: () => get().stock.reduce((s, e) => s + e.value, 0),

  // ─── Load All ───────────────────────────────────────────────────────────────
  loadAll: async (userId) => {
    set({ loading: true, error: null })
    try {
      const company = await getOrCreateCompany(userId)
      set({ company, userId })
      const [rawAccounts, parties, items, vouchers] = await Promise.all([
        fetchAccounts(company.id),
        fetchParties(company.id),
        fetchItems(company.id),
        fetchVouchers(company.id),
      ])

      // Seed default chart of accounts if none exist
      if (rawAccounts.length === 0) {
        const defaults = defaultChartOfAccounts(company.id) as Account[]
        await insertAccounts(defaults)
        rawAccounts.push(...defaults.map(a => ({ ...a, balance: 0 })))
      }

      const accounts = recomputeAllBalances(rawAccounts, vouchers)
      const stock = recomputeStock(items, vouchers)
      set({ company, rawAccounts, accounts, parties, items, stock, vouchers, userId, loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ─── Recompute after mutation ────────────────────────────────────────────────
  saveCompany: async (updates) => {
    const { company } = get()
    if (!company) return
    await updateCompany(company.id, updates)
    set({ company: { ...company, ...updates } })
  },

  // ─── Masters ────────────────────────────────────────────────────────────────
  addParty: async ({ name, type, phone, pan_vat, address, opening_balance = 0 }) => {
    const { company, rawAccounts, items, vouchers } = get()
    if (!company) throw new Error('No company')
    const accountId = crypto.randomUUID()
    const newAccount = {
      id: accountId,
      company_id: company.id,
      name,
      type: type === 'customer' ? 'Asset' as const : 'Liability' as const,
      group: type === 'customer' ? 'Sundry Debtors' : 'Sundry Creditors',
      is_system: false,
      is_party: true,
      opening_balance,
    }
    await insertAccount(newAccount)
    const newParty = await insertParty({ company_id: company.id, name, type, phone, pan_vat, address, account_id: accountId })
    const updatedRawAccounts = [...rawAccounts, { ...newAccount, balance: 0 }]
    const accounts = recomputeAllBalances(updatedRawAccounts, vouchers)
    const stock = recomputeStock(items, vouchers)
    set({ rawAccounts: updatedRawAccounts, accounts, stock, parties: [...get().parties, newParty] })
    return newParty
  },

  addItem: async (data) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const newItem = await insertItem({ company_id: company.id, sell_rate: 0, opening_qty: 0, opening_rate: 0, ...data })
    const items = [...get().items, newItem]
    const stock = recomputeStock(items, get().vouchers)
    set({ items, stock })
    return newItem
  },

  addAccount: async ({ name, type, group }) => {
    const { company, rawAccounts, vouchers } = get()
    if (!company) throw new Error('No company')
    const newAcc = { id: crypto.randomUUID(), company_id: company.id, name, type, group, is_system: false, is_party: false, opening_balance: 0 }
    await insertAccount(newAcc)
    const updatedRaw = [...rawAccounts, { ...newAcc, balance: 0 }]
    const accounts = recomputeAllBalances(updatedRaw, vouchers)
    set({ rawAccounts: updatedRaw, accounts })
    return { ...newAcc, balance: 0 }
  },

  // ─── Sales ──────────────────────────────────────────────────────────────────
  saveSalesVoucher: async (params) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildSalesVoucherData(effectiveParams)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Lines do not balance')
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Sales', companyPrefix(company, 'Sales'), company.reset_numbering_fiscal_year, company.fiscal_year_start)
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Sales', seq, invoice_no, ...dateFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: data.invoice_items,
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers)
    set({ vouchers, accounts, stock })
  },

  // ─── Purchase ───────────────────────────────────────────────────────────────
  savePurchaseVoucher: async (params) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildPurchaseVoucherData(effectiveParams)
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Purchase', companyPrefix(company, 'Purchase'), company.reset_numbering_fiscal_year, company.fiscal_year_start)
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Purchase', seq, invoice_no, ...dateFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: data.invoice_items,
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers)
    set({ vouchers, accounts, stock })
  },

  // ─── Receipt ────────────────────────────────────────────────────────────────
  saveReceipt: async ({ party_account_id, amount, deposit_to, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const data = buildReceiptData(party_account_id, amount, deposit_to, systemAccountsFor(company, get().rawAccounts))
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Receipt', companyPrefix(company, 'Receipt'), company.reset_numbering_fiscal_year, company.fiscal_year_start)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Receipt', seq, invoice_no, ...dateFields, narration, party_account_id, is_cash: deposit_to === 'cash', total: amount, cancelled: false },
      lines: data.lines,
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    set({ vouchers, accounts })
  },

  // ─── Payment ────────────────────────────────────────────────────────────────
  savePayment: async ({ party_account_id, amount, paid_from, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const data = buildPaymentData(party_account_id, amount, paid_from, systemAccountsFor(company, get().rawAccounts))
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Payment', companyPrefix(company, 'Payment'), company.reset_numbering_fiscal_year, company.fiscal_year_start)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Payment', seq, invoice_no, ...dateFields, narration, party_account_id, is_cash: paid_from === 'cash', total: amount, cancelled: false },
      lines: data.lines,
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    set({ vouchers, accounts })
  },

  // ─── Journal ────────────────────────────────────────────────────────────────
  saveJournal: async ({ lines, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    if (!validateBalanced(lines as VoucherLine[]).valid) throw new Error('Journal lines do not balance')
    const total = lines.reduce((s, l) => s + (l.debit || 0), 0)
    const seq = await getNextSeq(company.id)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Journal', seq, ...dateFields, narration, is_cash: false, total, cancelled: false },
      lines,
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    set({ vouchers, accounts })
  },

  // ─── Cancel ─────────────────────────────────────────────────────────────────
  updateSalesVoucher: async (id, params) => {
    const existing = get().vouchers.find(v => v.id === id)
    const company = get().company
    if (!existing) throw new Error('Voucher not found')
    if (!company) throw new Error('No company')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildSalesVoucherData(effectiveParams)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Lines do not balance')
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: data.invoice_items,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers)
    set({ vouchers, accounts, stock })
  },

  updatePurchaseVoucher: async (id, params) => {
    const existing = get().vouchers.find(v => v.id === id)
    const company = get().company
    if (!existing) throw new Error('Voucher not found')
    if (!company) throw new Error('No company')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildPurchaseVoucherData(effectiveParams)
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: data.invoice_items,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers)
    set({ vouchers, accounts, stock })
  },

  updateReceipt: async (id, { party_account_id, amount, deposit_to, narration, date_bs }) => {
    const existing = get().vouchers.find(v => v.id === id)
    if (!existing) throw new Error('Voucher not found')
    const company = get().company
    if (!company) throw new Error('No company')
    const data = buildReceiptData(party_account_id, amount, deposit_to, systemAccountsFor(company, get().rawAccounts))
    const dateFields = voucherDateFields(date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, narration, party_account_id, is_cash: deposit_to === 'cash', total: amount, cancelled: false },
      lines: data.lines,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    set({ vouchers, accounts })
  },

  saveStockAdjustment: async ({ item_id, qty_delta, rate, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    if (!item_id) throw new Error('Select an item')
    if (!qty_delta) throw new Error('Enter a quantity adjustment')
    const seq = await getNextSeq(company.id)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Stock Adjustment', seq, ...dateFields, narration, is_cash: false, total: Math.abs(qty_delta * rate), cancelled: false },
      lines: [],
      stock_lines: [{ item_id, qty: Math.abs(qty_delta), rate, direction: qty_delta > 0 ? 'in' : 'out' }],
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const stock = recomputeStock(get().items, vouchers)
    set({ vouchers, stock })
    logAppEvent('stock_adjustment', company.id, { item_id, qty_delta, rate })
  },

  updatePayment: async (id, { party_account_id, amount, paid_from, narration, date_bs }) => {
    const existing = get().vouchers.find(v => v.id === id)
    if (!existing) throw new Error('Voucher not found')
    const company = get().company
    if (!company) throw new Error('No company')
    const data = buildPaymentData(party_account_id, amount, paid_from, systemAccountsFor(company, get().rawAccounts))
    const dateFields = voucherDateFields(date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, narration, party_account_id, is_cash: paid_from === 'cash', total: amount, cancelled: false },
      lines: data.lines,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    set({ vouchers, accounts })
  },

  updateJournal: async (id, { lines, narration, date_bs }) => {
    const existing = get().vouchers.find(v => v.id === id)
    if (!existing) throw new Error('Voucher not found')
    if (!validateBalanced(lines as VoucherLine[]).valid) throw new Error('Journal lines do not balance')
    const total = lines.reduce((s, l) => s + (l.debit || 0), 0)
    const dateFields = voucherDateFields(date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, narration, is_cash: false, total, cancelled: false },
      lines,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    set({ vouchers, accounts })
  },

  cancelV: async (id) => {
    await cancelVoucher(id)
    const vouchers = get().vouchers.map(v => v.id === id ? { ...v, cancelled: true } : v)
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers)
    set({ vouchers, accounts, stock })
  },

}))
