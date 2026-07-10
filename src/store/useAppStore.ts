import { create } from 'zustand'
import type { Account, AccountCategory, Company, Item, ItemCategory, Party, StockEntry, Voucher, VoucherLine, StockLine } from '@/types'
import {
  fetchAccounts, fetchParties, fetchItems, fetchVouchers,
  insertAccount, insertAccounts, insertParty, insertItem,
  insertVoucher, cancelVoucher, updateCompany,
  updateVoucher, getNextSeq, getNextVoucherNo, getOrCreateCompany, logAppEvent,
  fetchAccountCategories, fetchItemCategories, insertAccountCategory, insertItemCategory,
  updateAccountCategory, updateItemCategory, updateAccount, updateParty, updateItem, logMasterChange,
} from '@/lib/supabase'
import {
  defaultChartOfAccounts, recomputeAllBalances, recomputeStock,
  buildSalesVoucherData, buildPurchaseVoucherData, buildReceiptData, buildPaymentData,
  buildReturnVoucherData, resolveSystemAccountId, validateBalanced, type ReturnItemInput, type SystemAccountKey,
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
  accountCategories: AccountCategory[]
  parties: Party[]
  items: Item[]
  itemCategories: ItemCategory[]
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
  addItem: (data: { name: string; unit: string; sell_rate?: number; opening_qty?: number; opening_rate?: number; reorder_level?: number; category_id?: string; sku?: string; barcode?: string; vat_applicable?: boolean }) => Promise<Item>
  addAccount: (data: { name: string; type: Account['type']; group: string; category_id?: string; opening_balance?: number }) => Promise<Account>
  addAccountCategory: (data: { name: string; account_type: Account['type'] }) => Promise<void>
  alterAccountCategory: (id: string, updates: Partial<AccountCategory>) => Promise<void>
  addItemCategory: (name: string) => Promise<void>
  alterItemCategory: (id: string, updates: Partial<ItemCategory>) => Promise<void>
  alterAccount: (id: string, updates: Partial<Account>) => Promise<void>
  alterParty: (id: string, updates: Partial<Party>) => Promise<void>
  alterItem: (id: string, updates: Partial<Item>) => Promise<void>

  saveSalesVoucher: (params: { party_account_id: string | null; is_cash: boolean; items: {item_id: string; qty: number; rate: number}[]; vat_rate: number; discount?: number; narration?: string; date_bs: string }) => Promise<void>
  savePurchaseVoucher: (params: { party_account_id: string | null; is_cash: boolean; items: {item_id: string; qty: number; rate: number}[]; vat_rate: number; discount?: number; narration?: string; date_bs: string }) => Promise<void>
  saveReceipt: (params: { party_account_id: string; amount: number; deposit_to: 'cash' | 'bank'; narration?: string; date_bs: string }) => Promise<void>
  savePayment: (params: { party_account_id: string; amount: number; paid_from: 'cash' | 'bank'; narration?: string; date_bs: string }) => Promise<void>
  saveJournal: (params: { lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]; narration?: string; date_bs: string }) => Promise<void>
  saveStockAdjustment: (params: { item_id: string; qty_delta: number; rate: number; narration?: string; date_bs: string }) => Promise<void>
  saveReturnVoucher: (params: ReturnSaveParams) => Promise<void>
  updateSalesVoucher: (id: string, params: { party_account_id: string | null; is_cash: boolean; items: {item_id: string; qty: number; rate: number}[]; vat_rate: number; discount?: number; narration?: string; date_bs: string }) => Promise<void>
  updatePurchaseVoucher: (id: string, params: { party_account_id: string | null; is_cash: boolean; items: {item_id: string; qty: number; rate: number}[]; vat_rate: number; discount?: number; narration?: string; date_bs: string }) => Promise<void>
  updateReceipt: (id: string, params: { party_account_id: string; amount: number; deposit_to: 'cash' | 'bank'; narration?: string; date_bs: string }) => Promise<void>
  updatePayment: (id: string, params: { party_account_id: string; amount: number; paid_from: 'cash' | 'bank'; narration?: string; date_bs: string }) => Promise<void>
  updateJournal: (id: string, params: { lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]; narration?: string; date_bs: string }) => Promise<void>
  updateReturnVoucher: (id: string, params: ReturnSaveParams) => Promise<void>
  cancelV: (id: string) => Promise<void>
}

export interface ReturnSaveParams {
  type: 'Sales Return' | 'Purchase Return'
  original_voucher_id: string
  items: ReturnItemInput[]
  settlement_mode: 'party' | 'cash' | 'bank'
  restock_items: boolean
  return_reason: string
  date_bs: string
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

function invoiceItemSnapshots(lines: { item_id: string; qty: number; rate: number }[], items: Item[], stock: StockEntry[], isSales: boolean) {
  return lines.map(line => {
    const item = items.find(entry => entry.id === line.item_id)
    return {
      ...line,
      item_name: item?.name,
      unit: item?.unit,
      cost_rate: isSales ? (stock.find(entry => entry.id === line.item_id)?.avg_cost || 0) : line.rate,
    }
  })
}

function companyPrefix(company: Company, type: 'Sales' | 'Purchase' | 'Sales Return' | 'Purchase Return' | 'Receipt' | 'Payment') {
  if (type === 'Sales') return company.sales_prefix || 'INV-'
  if (type === 'Purchase') return company.purchase_prefix || 'PB-'
  if (type === 'Receipt') return company.receipt_prefix || 'RCPT-'
  if (type === 'Sales Return') return company.sales_return_prefix || 'SR-'
  if (type === 'Purchase Return') return company.purchase_return_prefix || 'PR-'
  return company.payment_prefix || 'PAY-'
}

function systemAccountsFor(company: Company, accounts: Account[]) {
  const keys: SystemAccountKey[] = ['cash', 'bank', 'inventory', 'vat_payable', 'vat_receivable', 'sales', 'purchase', 'sales_return', 'purchase_return', 'capital', 'discount_allowed', 'rent', 'salary', 'electricity']
  return Object.fromEntries(keys.map(key => [key, resolveSystemAccountId(accounts, company.id, key)])) as Record<SystemAccountKey, string>
}

function systemAccountKeyFromId(companyId: string, accountId: string): SystemAccountKey | null {
  const keys: SystemAccountKey[] = ['cash', 'bank', 'inventory', 'vat_payable', 'vat_receivable', 'sales', 'purchase', 'sales_return', 'purchase_return', 'capital', 'discount_allowed', 'rent', 'salary', 'electricity']
  const key = accountId.startsWith(`${companyId}:`) ? accountId.slice(companyId.length + 1) : accountId
  return keys.includes(key as SystemAccountKey) ? key as SystemAccountKey : null
}

function validateReturnRequest(vouchers: Voucher[], stock: StockEntry[], params: ReturnSaveParams, editingId?: string) {
  const original = vouchers.find(voucher => voucher.id === params.original_voucher_id)
  const expectedType = params.type === 'Sales Return' ? 'Sales' : 'Purchase'
  if (!original || original.type !== expectedType || original.cancelled) throw new Error(`Select an active ${expectedType.toLowerCase()} voucher`)
  if (!params.return_reason.trim()) throw new Error('Enter a return reason')
  if (params.settlement_mode === 'party' && !original.party_account_id) throw new Error('A cash invoice cannot be adjusted through a party ledger')
  if (!params.items.length || params.items.some(item => item.qty <= 0)) throw new Error('Enter at least one return quantity')

  for (const item of params.items) {
    const source = (original.invoice_items || []).find(line => line.id === item.source_invoice_item_id)
    if (!source || source.item_id !== item.item_id) throw new Error('A selected return line no longer matches the original invoice')
    const alreadyReturned = vouchers
      .filter(voucher => voucher.id !== editingId && !voucher.cancelled && voucher.type === params.type && voucher.original_voucher_id === original.id)
      .flatMap(voucher => voucher.invoice_items || [])
      .filter(line => line.source_invoice_item_id === item.source_invoice_item_id)
      .reduce((sum, line) => sum + line.qty, 0)
    if (item.qty + alreadyReturned > source.qty + 0.0001) throw new Error(`Return quantity for ${item.item_name || item.item_id} exceeds the remaining quantity`)
  }

  if (params.type === 'Purchase Return') {
    const requestedByItem = new Map<string, number>()
    for (const item of params.items) requestedByItem.set(item.item_id, (requestedByItem.get(item.item_id) || 0) + item.qty)
    const editing = editingId ? vouchers.find(voucher => voucher.id === editingId) : undefined
    for (const [itemId, qty] of requestedByItem) {
      const currentReturnQty = editing?.stock_lines?.filter(line => line.item_id === itemId && line.direction === 'out').reduce((sum, line) => sum + line.qty, 0) || 0
      const available = (stock.find(entry => entry.id === itemId)?.qty || 0) + currentReturnQty
      if (qty > available + 0.0001) throw new Error(`Not enough stock to return ${qty}; only ${available} is available`)
    }
  }
  return original
}

export const useAppStore = create<AppState>((set, get) => ({
  userId: null,
  setUserId: (id) => set({ userId: id }),
  company: null,
  accounts: [],
  rawAccounts: [],
  accountCategories: [],
  parties: [],
  items: [],
  itemCategories: [],
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
    get().parties.filter(p => p.type === type && !p.is_archived).map(p => ({
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
      const [rawAccounts, accountCategories, parties, items, itemCategories, vouchers] = await Promise.all([
        fetchAccounts(company.id),
        fetchAccountCategories(company.id),
        fetchParties(company.id),
        fetchItems(company.id),
        fetchItemCategories(company.id),
        fetchVouchers(company.id),
      ])

      const defaults = defaultChartOfAccounts(company.id) as Account[]
      const existingDefaultKeys = new Set(
        rawAccounts
          .map(account => systemAccountKeyFromId(company.id, account.id))
          .filter((key): key is SystemAccountKey => !!key)
      )
      const missingDefaults = defaults.filter(account => {
        const key = systemAccountKeyFromId(company.id, account.id)
        return key ? !existingDefaultKeys.has(key) : false
      })

      if (missingDefaults.length) {
        await insertAccounts(missingDefaults)
        rawAccounts.push(...missingDefaults.map(a => ({ ...a, balance: 0 })))
      }

      const categorySpecs = [
        ...rawAccounts.map(account => ({ name: account.group, account_type: account.type, is_system: account.is_system })),
        { name: 'Sundry Debtors', account_type: 'Asset' as const, is_system: true },
        { name: 'Sundry Creditors', account_type: 'Liability' as const, is_system: true },
      ]
      for (const spec of categorySpecs) {
        if (accountCategories.some(category => category.name === spec.name && category.account_type === spec.account_type)) continue
        const category = await insertAccountCategory({ company_id: company.id, ...spec, is_archived: false })
        accountCategories.push(category)
      }
      for (const account of rawAccounts) {
        if (account.category_id) continue
        const category = accountCategories.find(item => item.name === account.group && item.account_type === account.type)
        if (!category) continue
        await updateAccount(account.id, { category_id: category.id })
        account.category_id = category.id
      }

      let generalItemCategory = itemCategories.find(category => category.name === 'General')
      if (!generalItemCategory) {
        generalItemCategory = await insertItemCategory({ company_id: company.id, name: 'General', is_archived: false })
        itemCategories.push(generalItemCategory)
      }
      for (const item of items) {
        if (item.category_id) continue
        await updateItem(item.id, { category_id: generalItemCategory.id })
        item.category_id = generalItemCategory.id
      }

      const accounts = recomputeAllBalances(rawAccounts, vouchers)
      const stock = recomputeStock(items, vouchers)
      set({ company, rawAccounts, accountCategories, accounts, parties, items, itemCategories, stock, vouchers, userId, loading: false })
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
    const categoryName = type === 'customer' ? 'Sundry Debtors' : 'Sundry Creditors'
    const accountType = type === 'customer' ? 'Asset' as const : 'Liability' as const
    const category = get().accountCategories.find(item => item.name === categoryName && item.account_type === accountType)
    const newAccount = {
      id: accountId,
      company_id: company.id,
      name,
      type: accountType,
      group: categoryName,
      category_id: category?.id,
      is_system: false,
      is_party: true,
      is_archived: false,
      opening_balance,
    }
    await insertAccount(newAccount)
    const newParty = await insertParty({ company_id: company.id, name, type, phone, pan_vat, address, account_id: accountId, is_archived: false })
    const updatedRawAccounts = [...rawAccounts, { ...newAccount, balance: 0 }]
    const accounts = recomputeAllBalances(updatedRawAccounts, vouchers)
    const stock = recomputeStock(items, vouchers)
    set({ rawAccounts: updatedRawAccounts, accounts, stock, parties: [...get().parties, newParty] })
    return newParty
  },

  addItem: async (data) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const generalCategory = get().itemCategories.find(category => category.name === 'General' && !category.is_archived)
    const newItem = await insertItem({ company_id: company.id, sell_rate: 0, opening_qty: 0, opening_rate: 0, category_id: generalCategory?.id, vat_applicable: true, is_archived: false, ...data })
    const items = [...get().items, newItem]
    const stock = recomputeStock(items, get().vouchers)
    set({ items, stock })
    return newItem
  },

  addAccount: async ({ name, type, group, category_id, opening_balance = 0 }) => {
    const { company, rawAccounts, vouchers } = get()
    if (!company) throw new Error('No company')
    const newAcc = { id: crypto.randomUUID(), company_id: company.id, name, type, group, category_id, is_system: false, is_party: false, is_archived: false, opening_balance }
    await insertAccount(newAcc)
    const updatedRaw = [...rawAccounts, { ...newAcc, balance: 0 }]
    const accounts = recomputeAllBalances(updatedRaw, vouchers)
    set({ rawAccounts: updatedRaw, accounts })
    return { ...newAcc, balance: 0 }
  },

  addAccountCategory: async ({ name, account_type }) => {
    const company = get().company
    if (!company) throw new Error('No company')
    const category = await insertAccountCategory({ company_id: company.id, name, account_type, is_system: false, is_archived: false })
    set({ accountCategories: [...get().accountCategories, category].sort((a, b) => a.name.localeCompare(b.name)) })
    logMasterChange(company.id, 'account_category', category.id, 'create', {}, category).catch(console.warn)
  },

  alterAccountCategory: async (id, updates) => {
    const company = get().company
    const existing = get().accountCategories.find(category => category.id === id)
    if (!company || !existing) throw new Error('Category not found')
    if (existing.is_system && updates.account_type && updates.account_type !== existing.account_type) throw new Error('System category type cannot be changed')
    if (updates.is_archived && get().rawAccounts.some(account => account.category_id === id && !account.is_archived)) throw new Error('Move or archive active ledgers before archiving this category')
    await updateAccountCategory(id, updates)
    const accountCategories = get().accountCategories.map(category => category.id === id ? { ...category, ...updates } : category)
    const rawAccounts = get().rawAccounts.map(account => account.category_id === id && updates.name ? { ...account, group: updates.name } : account)
    set({ accountCategories, rawAccounts, accounts: recomputeAllBalances(rawAccounts, get().vouchers) })
    logMasterChange(company.id, 'account_category', id, 'update', existing, updates as Record<string, unknown>).catch(console.warn)
  },

  addItemCategory: async (name) => {
    const company = get().company
    if (!company) throw new Error('No company')
    const category = await insertItemCategory({ company_id: company.id, name, is_archived: false })
    set({ itemCategories: [...get().itemCategories, category].sort((a, b) => a.name.localeCompare(b.name)) })
    logMasterChange(company.id, 'item_category', category.id, 'create', {}, category).catch(console.warn)
  },

  alterItemCategory: async (id, updates) => {
    const company = get().company
    const existing = get().itemCategories.find(category => category.id === id)
    if (!company || !existing) throw new Error('Category not found')
    if (updates.is_archived && get().items.some(item => item.category_id === id && !item.is_archived)) throw new Error('Move or archive active items before archiving this category')
    await updateItemCategory(id, updates)
    set({ itemCategories: get().itemCategories.map(category => category.id === id ? { ...category, ...updates } : category) })
    logMasterChange(company.id, 'item_category', id, 'update', existing, updates as Record<string, unknown>).catch(console.warn)
  },

  alterAccount: async (id, updates) => {
    const company = get().company
    const existing = get().rawAccounts.find(account => account.id === id)
    if (!company || !existing) throw new Error('Ledger not found')
    const used = get().vouchers.some(voucher => voucher.lines?.some(line => line.account_id === id))
    if ((existing.is_system || used) && updates.type && updates.type !== existing.type) throw new Error('The account type of a system or used ledger cannot be changed')
    await updateAccount(id, updates)
    const rawAccounts = get().rawAccounts.map(account => account.id === id ? { ...account, ...updates } : account)
    set({ rawAccounts, accounts: recomputeAllBalances(rawAccounts, get().vouchers) })
    logMasterChange(company.id, 'account', id, updates.is_archived !== undefined ? 'archive_status' : 'update', existing, updates as Record<string, unknown>).catch(console.warn)
  },

  alterParty: async (id, updates) => {
    const company = get().company
    const party = get().parties.find(item => item.id === id)
    if (!company || !party) throw new Error('Party not found')
    const nextType = updates.type || party.type
    const categoryName = nextType === 'customer' ? 'Sundry Debtors' : 'Sundry Creditors'
    const accountType = nextType === 'customer' ? 'Asset' : 'Liability'
    const category = get().accountCategories.find(item => item.name === categoryName && item.account_type === accountType)
    const accountUpdates: Partial<Account> = { name: updates.name || party.name, type: accountType, group: categoryName, category_id: category?.id, is_archived: updates.is_archived }
    await updateParty(id, updates)
    await updateAccount(party.account_id, accountUpdates)
    const parties = get().parties.map(item => item.id === id ? { ...item, ...updates } : item)
    const rawAccounts = get().rawAccounts.map(account => account.id === party.account_id ? { ...account, ...accountUpdates } : account)
    set({ parties, rawAccounts, accounts: recomputeAllBalances(rawAccounts, get().vouchers) })
    logMasterChange(company.id, 'party', id, 'update', party, updates as Record<string, unknown>).catch(console.warn)
  },

  alterItem: async (id, updates) => {
    const company = get().company
    const existing = get().items.find(item => item.id === id)
    if (!company || !existing) throw new Error('Item not found')
    await updateItem(id, updates)
    const items = get().items.map(item => item.id === id ? { ...item, ...updates } : item)
    set({ items, stock: recomputeStock(items, get().vouchers) })
    logMasterChange(company.id, 'item', id, updates.is_archived !== undefined ? 'archive_status' : 'update', existing, updates as Record<string, unknown>).catch(console.warn)
  },

  // ─── Sales ──────────────────────────────────────────────────────────────────
  saveSalesVoucher: async (params) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildSalesVoucherData(effectiveParams)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Lines do not balance')
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Sales', companyPrefix(company, 'Sales'), company.reset_numbering_fiscal_year, company.fiscal_year_start, effectiveParams.date_bs)
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Sales', seq, invoice_no, ...dateFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
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
    const invoice_no = await getNextVoucherNo(company.id, 'Purchase', companyPrefix(company, 'Purchase'), company.reset_numbering_fiscal_year, company.fiscal_year_start, effectiveParams.date_bs)
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Purchase', seq, invoice_no, ...dateFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, false),
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
    const invoice_no = await getNextVoucherNo(company.id, 'Receipt', companyPrefix(company, 'Receipt'), company.reset_numbering_fiscal_year, company.fiscal_year_start, date_bs)
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
    const invoice_no = await getNextVoucherNo(company.id, 'Payment', companyPrefix(company, 'Payment'), company.reset_numbering_fiscal_year, company.fiscal_year_start, date_bs)
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

  saveReturnVoucher: async (params) => {
    const { company, vouchers, stock } = get()
    if (!company) throw new Error('No company')
    const original = validateReturnRequest(vouchers, stock, params)
    const data = buildReturnVoucherData({ ...params, original, system_accounts: systemAccountsFor(company, get().rawAccounts) })
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Return voucher lines do not balance')
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, params.type, companyPrefix(company, params.type), company.reset_numbering_fiscal_year, company.fiscal_year_start, params.date_bs)
    const dateFields = voucherDateFields(params.date_bs)
    const newVoucher = await insertVoucher({
      voucher: {
        company_id: company.id, type: params.type, seq, invoice_no, ...dateFields,
        original_voucher_id: original.id, return_reason: params.return_reason.trim(), narration: params.return_reason.trim(),
        settlement_mode: params.settlement_mode, restock_items: params.type === 'Sales Return' ? params.restock_items : false,
        party_account_id: original.party_account_id, is_cash: params.settlement_mode === 'cash',
        subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount,
        total: data.total, cancelled: false,
      },
      lines: data.lines,
      stock_lines: data.stock_lines,
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
    })
    const nextVouchers = [newVoucher, ...vouchers]
    set({
      vouchers: nextVouchers,
      accounts: recomputeAllBalances(get().rawAccounts, nextVouchers),
      stock: recomputeStock(get().items, nextVouchers),
    })
    logAppEvent('return_created', company.id, { voucher_id: newVoucher.id, type: params.type, original_voucher_id: original.id })
  },

  // ─── Cancel ─────────────────────────────────────────────────────────────────
  updateSalesVoucher: async (id, params) => {
    const existing = get().vouchers.find(v => v.id === id)
    const company = get().company
    if (!existing) throw new Error('Voucher not found')
    if (!company) throw new Error('No company')
    if (get().vouchers.some(voucher => !voucher.cancelled && voucher.original_voucher_id === id)) throw new Error('This invoice has an active return and can no longer be edited')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildSalesVoucherData(effectiveParams)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Lines do not balance')
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, false),
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
    if (get().vouchers.some(voucher => !voucher.cancelled && voucher.original_voucher_id === id)) throw new Error('This bill has an active return and can no longer be edited')
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

  updateReturnVoucher: async (id, params) => {
    const existing = get().vouchers.find(voucher => voucher.id === id)
    const company = get().company
    if (!existing || (existing.type !== 'Sales Return' && existing.type !== 'Purchase Return')) throw new Error('Return voucher not found')
    if (!company) throw new Error('No company')
    const original = validateReturnRequest(get().vouchers, get().stock, params, id)
    const data = buildReturnVoucherData({ ...params, original, system_accounts: systemAccountsFor(company, get().rawAccounts) })
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Return voucher lines do not balance')
    const updated = await updateVoucher({
      id,
      voucher: {
        ...voucherDateFields(params.date_bs), original_voucher_id: original.id,
        return_reason: params.return_reason.trim(), narration: params.return_reason.trim(),
        settlement_mode: params.settlement_mode, restock_items: params.type === 'Sales Return' ? params.restock_items : false,
        party_account_id: original.party_account_id, is_cash: params.settlement_mode === 'cash',
        subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total,
      },
      lines: data.lines,
      stock_lines: data.stock_lines,
      invoice_items: data.invoice_items,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    set({ vouchers, accounts: recomputeAllBalances(get().rawAccounts, vouchers), stock: recomputeStock(get().items, vouchers) })
  },

  cancelV: async (id) => {
    if (get().vouchers.some(voucher => !voucher.cancelled && voucher.original_voucher_id === id)) throw new Error('Cancel linked return vouchers before cancelling the original invoice')
    await cancelVoucher(id)
    const vouchers = get().vouchers.map(v => v.id === id ? { ...v, cancelled: true } : v)
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers)
    set({ vouchers, accounts, stock })
  },

}))
