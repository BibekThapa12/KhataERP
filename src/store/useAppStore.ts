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
  buildReturnVoucherData, resolveSystemAccountId, round2, validateBalanced, type InvoiceEntryInput, type ReturnItemInput, type SystemAccountKey, type TransactionAllocation,
} from '@/lib/engine'
import { addDaysToBs, bsToAd, makeBsKey } from '@/lib/nepaliDate'
import { categoryDepth, categoryDescendantIds, subtreeHeight } from '@/lib/categoryHierarchy'
import { partyTerminology, partyTypeForCategory } from '@/lib/partyTerminology'
import { bankAccounts } from '@/lib/banks'
import { toBaseQty, toBaseRate } from '@/lib/units'
import { canonicalItemUnit, validateItemUnits } from '@/lib/itemUnits'
import { voucherPrefix } from '@/lib/voucherNumbers'
import { SYSTEM_ACCOUNT_DESTINATIONS, SYSTEM_ACCOUNT_GROUPS } from '@/lib/systemAccountGroups'

const valuationMethod = (company?: Company | null) => company?.inventory_valuation_method || 'weighted_average'

interface InvoiceSaveParams {
  party_account_id: string | null
  is_cash: boolean
  items: InvoiceEntryInput[]
  vat_rate: number
  credit_days: number
  discount?: number
  narration?: string
  date_bs: string
}

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

  addParty: (data: { name: string; type: 'customer' | 'supplier'; phone?: string; pan_vat?: string; address?: string; default_credit_days?: number; opening_balance?: number }) => Promise<Party>
  addItem: (data: { name: string; unit: string; alternate_unit?: string | null; alternate_conversion?: number | null; sell_rate?: number; opening_qty?: number; opening_rate?: number; reorder_level?: number; category_id?: string; sku?: string; barcode?: string; vat_applicable?: boolean }) => Promise<Item>
  addAccount: (data: { name: string; type: Account['type']; group: string; category_id?: string; opening_balance?: number }) => Promise<Account>
  addAccountCategory: (data: { name: string; account_type: Account['type']; parent_category_id?: string | null }) => Promise<void>
  alterAccountCategory: (id: string, updates: Partial<AccountCategory>) => Promise<void>
  addItemCategory: (data: { name: string; parent_category_id?: string | null }) => Promise<void>
  alterItemCategory: (id: string, updates: Partial<ItemCategory>) => Promise<void>
  alterAccount: (id: string, updates: Partial<Account>) => Promise<void>
  alterParty: (id: string, updates: Partial<Party>) => Promise<void>
  alterItem: (id: string, updates: Partial<Item>) => Promise<void>

  saveSalesVoucher: (params: InvoiceSaveParams) => Promise<void>
  savePurchaseVoucher: (params: InvoiceSaveParams) => Promise<void>
  saveReceipt: (params: { allocations: TransactionAllocation[]; deposit_to_account_id: string; narration?: string; date_bs: string }) => Promise<void>
  savePayment: (params: { allocations: TransactionAllocation[]; paid_from_account_id: string; narration?: string; date_bs: string }) => Promise<void>
  saveJournal: (params: { lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]; narration?: string; date_bs: string }) => Promise<void>
  saveStockAdjustment: (params: { item_id: string; qty_delta: number; rate: number; narration?: string; date_bs: string }) => Promise<void>
  saveReturnVoucher: (params: ReturnSaveParams) => Promise<void>
  updateSalesVoucher: (id: string, params: InvoiceSaveParams) => Promise<void>
  updatePurchaseVoucher: (id: string, params: InvoiceSaveParams) => Promise<void>
  updateReceipt: (id: string, params: { allocations: TransactionAllocation[]; deposit_to_account_id: string; narration?: string; date_bs: string }) => Promise<void>
  updatePayment: (id: string, params: { allocations: TransactionAllocation[]; paid_from_account_id: string; narration?: string; date_bs: string }) => Promise<void>
  updateJournal: (id: string, params: { lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]; narration?: string; date_bs: string }) => Promise<void>
  updateReturnVoucher: (id: string, params: ReturnSaveParams) => Promise<void>
  cancelV: (id: string) => Promise<void>
}

export interface ReturnSaveParams {
  type: 'Sales Return' | 'Purchase Return'
  original_voucher_id: string
  items: ReturnItemInput[]
  settlement_mode: 'party' | 'cash' | 'bank'
  settlement_account_id?: string
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

function invoiceItemSnapshots(lines: InvoiceEntryInput[], items: Item[], stock: StockEntry[], isSales: boolean) {
  return lines.map(line => {
    const item = items.find(entry => entry.id === line.item_id)
    return {
      ...line,
      item_name: item?.name,
      unit: line.entry_unit || item?.unit,
      entry_unit: line.entry_unit || item?.unit,
      conversion_factor: line.conversion_factor || 1,
      base_qty: toBaseQty(line.qty, line.conversion_factor || 1),
      cost_rate: line.cost_rate ?? (isSales ? (stock.find(entry => entry.id === line.item_id)?.avg_cost || 0) : toBaseRate(line.rate, line.conversion_factor || 1)),
    }
  })
}

function systemAccountsFor(company: Company, accounts: Account[]) {
  const keys: SystemAccountKey[] = ['cash', 'bank', 'inventory', 'vat_payable', 'vat_receivable', 'sales', 'purchase', 'sales_return', 'purchase_return', 'capital', 'discount_allowed', 'rent', 'salary', 'electricity']
  return Object.fromEntries(keys.map(key => [key, resolveSystemAccountId(accounts, company.id, key)])) as Record<SystemAccountKey, string>
}

function invoiceCreditFields(date_bs: string, creditDays: number, isCash: boolean) {
  if (!Number.isFinite(creditDays) || creditDays < 0 || !Number.isInteger(creditDays)) throw new Error('Credit Days must be a whole number of 0 or more')
  const credit_days = isCash ? 0 : creditDays
  const due_date_bs = addDaysToBs(date_bs, credit_days)
  return { credit_days, due_date_bs, due_date_ad: bsToAd(due_date_bs), due_date_bs_key: makeBsKey(due_date_bs) }
}

function validateMoneyAccount(accountId: string, company: Company, accounts: Account[], categories: AccountCategory[], allowArchived = false) {
  const cashId = resolveSystemAccountId(accounts, company.id, 'cash')
  const validBanks = bankAccounts(accounts, categories, allowArchived)
  if (accountId !== cashId && !validBanks.some(account => account.id === accountId)) throw new Error('Select Cash or an active bank account')
  return { isCash: accountId === cashId }
}

function validateAllocations(allocations: TransactionAllocation[], settlementId: string, company: Company, accounts: Account[], categories: AccountCategory[], allowArchived = false) {
  const valid = allocations.filter(allocation => allocation.account_id && allocation.amount > 0)
  if (!valid.length || valid.length !== allocations.length) throw new Error('Add at least one ledger with a positive amount')
  if (new Set(valid.map(allocation => allocation.account_id)).size !== valid.length) throw new Error('A ledger can appear only once')
  const moneyIds = new Set([resolveSystemAccountId(accounts, company.id, 'cash'), ...bankAccounts(accounts, categories, true).map(account => account.id)])
  for (const allocation of valid) {
    const account = accounts.find(entry => entry.id === allocation.account_id && entry.company_id === company.id)
    if (!account || (!allowArchived && account.is_archived)) throw new Error('Select active company ledgers')
    if (allocation.account_id === settlementId || moneyIds.has(allocation.account_id)) throw new Error('Cash and bank accounts cannot be allocation ledgers')
  }
  return valid
}

function singlePartyAccountId(allocations: TransactionAllocation[], parties: Party[]) {
  return allocations.length === 1 && parties.some(party => party.account_id === allocations[0].account_id) ? allocations[0].account_id : null
}

function settlementRows(allocations: TransactionAllocation[]) {
  return allocations.flatMap(allocation => (allocation.invoice_allocations || []).filter(row => row.amount > 0).map(row => ({
    invoice_voucher_id: row.invoice_voucher_id,
    party_account_id: allocation.account_id,
    amount: round2(row.amount),
  })))
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
    for (const item of params.items) requestedByItem.set(item.item_id, (requestedByItem.get(item.item_id) || 0) + toBaseQty(item.qty, item.conversion_factor || 1))
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
      const [rawAccounts, accountCategories, fetchedParties, items, itemCategories, vouchers] = await Promise.all([
        fetchAccounts(company.id),
        fetchAccountCategories(company.id),
        fetchParties(company.id),
        fetchItems(company.id),
        fetchItemCategories(company.id),
        fetchVouchers(company.id),
      ])
      const parties = [...new Map(fetchedParties.map(party => [party.account_id, party])).values()]

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

      const groupByKey = new Map<string, AccountCategory>()
      for (const spec of SYSTEM_ACCOUNT_GROUPS) {
        const parent = spec.parent_key ? groupByKey.get(spec.parent_key) : undefined
        let category = accountCategories.find(entry => entry.name === spec.name && entry.account_type === spec.account_type)
        if (!category) {
          category = await insertAccountCategory({ company_id: company.id, name: spec.name, account_type: spec.account_type, parent_category_id: parent?.id || null, is_system: true, is_archived: false })
          accountCategories.push(category)
        } else {
          const updates: Partial<AccountCategory> = {}
          if (category.parent_category_id !== (parent?.id || null)) updates.parent_category_id = parent?.id || null
          if (!category.is_system) updates.is_system = true
          if (category.is_archived) updates.is_archived = false
          if (Object.keys(updates).length) {
            await updateAccountCategory(category.id, updates)
            Object.assign(category, updates)
          }
        }
        groupByKey.set(spec.key, category)
      }

      const legacyBank = accountCategories.find(category => category.name === 'Bank' && category.account_type === 'Asset')
      const bankCategory = groupByKey.get('bank-accounts')!
      if (legacyBank && legacyBank.id !== bankCategory.id) {
        for (const account of rawAccounts.filter(entry => entry.category_id === legacyBank.id)) {
          await updateAccount(account.id, { category_id: bankCategory.id, group: bankCategory.name })
          account.category_id = bankCategory.id
          account.group = bankCategory.name
        }
      }

      const legacyIncome = accountCategories.find(category => category.name === 'Income' && category.account_type === 'Income')
      const incomesCategory = groupByKey.get('incomes')!
      if (legacyIncome && legacyIncome.id !== incomesCategory.id) {
        for (const account of rawAccounts.filter(entry => entry.category_id === legacyIncome.id)) {
          await updateAccount(account.id, { category_id: incomesCategory.id, group: incomesCategory.name })
          account.category_id = incomesCategory.id
          account.group = incomesCategory.name
        }
      }

      const legacyTax = accountCategories.find(category => category.name === 'Duties & Taxes (Liabilities)' && category.account_type === 'Liability')
      const taxCategory = groupByKey.get('duties-taxes')!
      if (legacyTax && legacyTax.id !== taxCategory.id) {
        for (const account of rawAccounts.filter(entry => entry.category_id === legacyTax.id)) {
          await updateAccount(account.id, { category_id: taxCategory.id, group: taxCategory.name })
          account.category_id = taxCategory.id
          account.group = taxCategory.name
        }
      }

      for (const account of rawAccounts) {
        const key = systemAccountKeyFromId(company.id, account.id)
        if (!key) continue
        const destination = groupByKey.get(SYSTEM_ACCOUNT_DESTINATIONS[key])
        if (!destination) continue
        const nextType = key === 'vat_receivable' ? 'Liability' as const : account.type
        const repairs: Partial<Account> = {}
        if (account.category_id !== destination.id) repairs.category_id = destination.id
        if (account.group !== destination.name) repairs.group = destination.name
        if (account.type !== nextType) {
          repairs.type = nextType
          if (key === 'vat_receivable') repairs.opening_balance = -(account.opening_balance || 0)
        }
        if (!Object.keys(repairs).length) continue
        await updateAccount(account.id, repairs)
        Object.assign(account, repairs)
      }

      for (const account of rawAccounts) {
        if (account.category_id || !account.group) continue
        let category = accountCategories.find(item => item.name === account.group && item.account_type === account.type)
        if (!category) {
          category = await insertAccountCategory({ company_id: company.id, name: account.group, account_type: account.type, is_system: false, is_archived: false })
          accountCategories.push(category)
        }
      }
      for (const account of rawAccounts) {
        if (account.category_id) continue
        const category = accountCategories.find(item => item.name === account.group && item.account_type === account.type)
        if (!category) continue
        await updateAccount(account.id, { category_id: category.id })
        account.category_id = category.id
      }
      for (const account of rawAccounts) {
        if (parties.some(party => party.account_id === account.id)) continue
        const category = accountCategories.find(entry => entry.id === account.category_id)
        const partyType = partyTypeForCategory(category)
        if (!partyType) continue
        const party = await insertParty({ company_id: company.id, name: account.name, type: partyType, account_id: account.id, is_archived: !!account.is_archived })
        parties.push(party)
      }
      for (const party of parties) {
        const account = rawAccounts.find(entry => entry.id === party.account_id)
        const terminology = partyTerminology(party.type)
        const category = accountCategories.find(entry => entry.name === terminology.category && entry.account_type === terminology.accountType)
        if (!account || !category) continue
        if (account.category_id === category.id && account.group === terminology.category && account.type === terminology.accountType && account.is_party) continue
        const repairs = { category_id: category.id, group: terminology.category, type: terminology.accountType, is_party: true }
        await updateAccount(account.id, repairs)
        Object.assign(account, repairs)
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
      const stock = recomputeStock(items, vouchers, valuationMethod(company))
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
    const nextCompany = { ...company, ...updates }
    const stock = updates.inventory_valuation_method
      ? recomputeStock(get().items, get().vouchers, valuationMethod(nextCompany))
      : get().stock
    set({ company: nextCompany, stock })
  },

  // ─── Masters ────────────────────────────────────────────────────────────────
  addParty: async ({ name, type, phone, pan_vat, address, default_credit_days = 0, opening_balance = 0 }) => {
    const { company, rawAccounts, items, vouchers } = get()
    if (!company) throw new Error('No company')
    const accountId = crypto.randomUUID()
    const terminology = partyTerminology(type)
    const categoryName = terminology.category
    const accountType = terminology.accountType
    const category = get().accountCategories.find(item => item.name === categoryName && item.account_type === accountType)
    if (!Number.isInteger(default_credit_days) || default_credit_days < 0) throw new Error('Default Credit Days must be a whole number of 0 or more')
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
    const newParty = await insertParty({ company_id: company.id, name, type, phone, pan_vat, address, default_credit_days, account_id: accountId, is_archived: false })
    const updatedRawAccounts = [...rawAccounts, { ...newAccount, balance: 0 }]
    const accounts = recomputeAllBalances(updatedRawAccounts, vouchers)
    const stock = recomputeStock(items, vouchers, valuationMethod(company))
    set({ rawAccounts: updatedRawAccounts, accounts, stock, parties: [...get().parties, newParty] })
    return newParty
  },

  addItem: async (data) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const unit = canonicalItemUnit(data.unit) || data.unit.trim()
    const alternateUnit = data.alternate_unit ? canonicalItemUnit(data.alternate_unit) || data.alternate_unit.trim() : null
    const unitError = validateItemUnits(unit, alternateUnit)
    if (unitError) throw new Error(unitError)
    if (alternateUnit && Number(data.alternate_conversion || 0) <= 1) throw new Error('Alternative units per main unit must be greater than 1.')
    const generalCategory = get().itemCategories.find(category => category.name === 'General' && !category.is_archived)
    const newItem = await insertItem({ company_id: company.id, sell_rate: 0, opening_qty: 0, opening_rate: 0, category_id: generalCategory?.id, vat_applicable: true, is_archived: false, ...data, unit, alternate_unit: alternateUnit, alternate_conversion: alternateUnit ? data.alternate_conversion : null })
    const items = [...get().items, newItem]
    const stock = recomputeStock(items, get().vouchers, valuationMethod(company))
    set({ items, stock })
    return newItem
  },

  addAccount: async ({ name, type, group, category_id, opening_balance = 0 }) => {
    const { company, rawAccounts, vouchers } = get()
    if (!company) throw new Error('No company')
    const category = get().accountCategories.find(entry => entry.id === category_id)
    const partyType = partyTypeForCategory(category)
    const newAcc = { id: crypto.randomUUID(), company_id: company.id, name, type, group, category_id, is_system: false, is_party: !!partyType, is_archived: false, opening_balance }
    await insertAccount(newAcc)
    const newParty = partyType ? await insertParty({ company_id: company.id, name, type: partyType, account_id: newAcc.id, is_archived: false }) : null
    const updatedRaw = [...rawAccounts, { ...newAcc, balance: 0 }]
    const accounts = recomputeAllBalances(updatedRaw, vouchers)
    set({ rawAccounts: updatedRaw, accounts, parties: newParty ? [...get().parties, newParty] : get().parties })
    return { ...newAcc, balance: 0 }
  },

  addAccountCategory: async ({ name, account_type, parent_category_id = null }) => {
    const company = get().company
    if (!company) throw new Error('No company')
    const parent = parent_category_id ? get().accountCategories.find(category => category.id === parent_category_id) : undefined
    if (parent && parent.account_type !== account_type) throw new Error('Parent category must use the same account type')
    if (parent && categoryDepth(get().accountCategories, parent.id) >= 3) throw new Error('Category hierarchy cannot exceed three levels')
    const category = await insertAccountCategory({ company_id: company.id, name, account_type, parent_category_id, is_system: false, is_archived: false })
    set({ accountCategories: [...get().accountCategories, category].sort((a, b) => a.name.localeCompare(b.name)) })
    logMasterChange(company.id, 'account_category', category.id, 'create', {}, category).catch(console.warn)
  },

  alterAccountCategory: async (id, updates) => {
    const company = get().company
    const existing = get().accountCategories.find(category => category.id === id)
    if (!company || !existing) throw new Error('Category not found')
    if (existing.is_system) throw new Error('System account groups cannot be changed')
    const descendants = categoryDescendantIds(get().accountCategories, id)
    if (updates.is_archived && get().rawAccounts.some(account => (account.category_id === id || descendants.has(account.category_id || '')) && !account.is_archived)) throw new Error('Move or archive active ledgers in this category tree first')
    if (updates.is_archived && get().accountCategories.some(category => descendants.has(category.id) && !category.is_archived)) throw new Error('Archive child categories first')
    if (updates.account_type && updates.account_type !== existing.account_type && (descendants.size || get().rawAccounts.some(account => account.category_id === id))) throw new Error('Cannot change the type of a category with children or ledgers')
    if (updates.parent_category_id) {
      if (updates.parent_category_id === id || descendants.has(updates.parent_category_id)) throw new Error('A category cannot be moved into itself or its descendants')
      const parent = get().accountCategories.find(category => category.id === updates.parent_category_id)
      if (!parent || parent.account_type !== (updates.account_type || existing.account_type)) throw new Error('Parent category must use the same account type')
      if (categoryDepth(get().accountCategories, parent.id) + subtreeHeight(get().accountCategories, id) > 3) throw new Error('Category hierarchy cannot exceed three levels')
    }
    await updateAccountCategory(id, updates)
    const accountCategories = get().accountCategories.map(category => category.id === id ? { ...category, ...updates } : category)
    const rawAccounts = get().rawAccounts.map(account => account.category_id === id && updates.name ? { ...account, group: updates.name } : account)
    set({ accountCategories, rawAccounts, accounts: recomputeAllBalances(rawAccounts, get().vouchers) })
    logMasterChange(company.id, 'account_category', id, 'update', existing, updates as Record<string, unknown>).catch(console.warn)
  },

  addItemCategory: async ({ name, parent_category_id = null }) => {
    const company = get().company
    if (!company) throw new Error('No company')
    const parent = parent_category_id ? get().itemCategories.find(category => category.id === parent_category_id) : undefined
    if (parent && categoryDepth(get().itemCategories, parent.id) >= 3) throw new Error('Category hierarchy cannot exceed three levels')
    const category = await insertItemCategory({ company_id: company.id, name, parent_category_id, is_archived: false })
    set({ itemCategories: [...get().itemCategories, category].sort((a, b) => a.name.localeCompare(b.name)) })
    logMasterChange(company.id, 'item_category', category.id, 'create', {}, category).catch(console.warn)
  },

  alterItemCategory: async (id, updates) => {
    const company = get().company
    const existing = get().itemCategories.find(category => category.id === id)
    if (!company || !existing) throw new Error('Category not found')
    const descendants = categoryDescendantIds(get().itemCategories, id)
    if (updates.is_archived && get().items.some(item => (item.category_id === id || descendants.has(item.category_id || '')) && !item.is_archived)) throw new Error('Move or archive active items in this category tree first')
    if (updates.is_archived && get().itemCategories.some(category => descendants.has(category.id) && !category.is_archived)) throw new Error('Archive child categories first')
    if (updates.parent_category_id) {
      if (updates.parent_category_id === id || descendants.has(updates.parent_category_id)) throw new Error('A category cannot be moved into itself or its descendants')
      const parent = get().itemCategories.find(category => category.id === updates.parent_category_id)
      if (!parent) throw new Error('Parent category not found')
      if (categoryDepth(get().itemCategories, parent.id) + subtreeHeight(get().itemCategories, id) > 3) throw new Error('Category hierarchy cannot exceed three levels')
    }
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
    const categoryId = updates.category_id || existing.category_id
    const category = get().accountCategories.find(entry => entry.id === categoryId)
    const partyType = partyTypeForCategory(category)
    const existingParty = get().parties.find(party => party.account_id === id)
    const effectiveUpdates = partyType ? { ...updates, category_id: category!.id, group: category!.name, type: category!.account_type, is_party: true } : updates
    await updateAccount(id, effectiveUpdates)
    const newParty = partyType && !existingParty ? await insertParty({ company_id: company.id, name: effectiveUpdates.name || existing.name, type: partyType, account_id: id, is_archived: !!effectiveUpdates.is_archived }) : null
    const rawAccounts = get().rawAccounts.map(account => account.id === id ? { ...account, ...effectiveUpdates } : account)
    set({ rawAccounts, accounts: recomputeAllBalances(rawAccounts, get().vouchers), parties: newParty ? [...get().parties, newParty] : get().parties })
    logMasterChange(company.id, 'account', id, effectiveUpdates.is_archived !== undefined ? 'archive_status' : 'update', existing, effectiveUpdates as Record<string, unknown>).catch(console.warn)
  },

  alterParty: async (id, updates) => {
    const company = get().company
    const party = get().parties.find(item => item.id === id)
    if (!company || !party) throw new Error('Party not found')
    if (updates.default_credit_days !== undefined && (!Number.isInteger(updates.default_credit_days) || updates.default_credit_days < 0)) throw new Error('Default Credit Days must be a whole number of 0 or more')
    const nextType = updates.type || party.type
    const terminology = partyTerminology(nextType)
    const categoryName = terminology.category
    const accountType = terminology.accountType
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
    const normalizedUpdates = { ...updates }
    const unitFieldsChanged = updates.unit !== undefined || updates.alternate_unit !== undefined || updates.alternate_conversion !== undefined
    if (typeof updates.unit === 'string') normalizedUpdates.unit = canonicalItemUnit(updates.unit) || updates.unit.trim()
    if (typeof updates.alternate_unit === 'string') normalizedUpdates.alternate_unit = canonicalItemUnit(updates.alternate_unit) || updates.alternate_unit.trim()
    const effectiveUnit = normalizedUpdates.unit || existing.unit
    const effectiveAlternate = normalizedUpdates.alternate_unit === undefined ? existing.alternate_unit : normalizedUpdates.alternate_unit
    const effectiveConversion = normalizedUpdates.alternate_conversion === undefined ? existing.alternate_conversion : normalizedUpdates.alternate_conversion
    if (unitFieldsChanged) {
      const unitError = validateItemUnits(effectiveUnit, effectiveAlternate, [existing.unit, existing.alternate_unit || ''])
      if (unitError) throw new Error(unitError)
      if (effectiveAlternate && Number(effectiveConversion || 0) <= 1) throw new Error('Alternative units per main unit must be greater than 1.')
      if (!effectiveAlternate) normalizedUpdates.alternate_conversion = null
    }
    await updateItem(id, normalizedUpdates)
    const items = get().items.map(item => item.id === id ? { ...item, ...normalizedUpdates } : item)
    set({ items, stock: recomputeStock(items, get().vouchers, valuationMethod(company)) })
    logMasterChange(company.id, 'item', id, normalizedUpdates.is_archived !== undefined ? 'archive_status' : 'update', existing, normalizedUpdates as Record<string, unknown>).catch(console.warn)
  },

  // ─── Sales ──────────────────────────────────────────────────────────────────
  saveSalesVoucher: async (params) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildSalesVoucherData(effectiveParams)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Lines do not balance')
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Sales', voucherPrefix(company, 'Sales'), company.reset_numbering_fiscal_year, company.fiscal_year_start, effectiveParams.date_bs)
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const creditFields = invoiceCreditFields(effectiveParams.date_bs, effectiveParams.credit_days, effectiveParams.is_cash)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Sales', seq, invoice_no, ...dateFields, ...creditFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers, valuationMethod(company))
    set({ vouchers, accounts, stock })
  },

  // ─── Purchase ───────────────────────────────────────────────────────────────
  savePurchaseVoucher: async (params) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildPurchaseVoucherData(effectiveParams)
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Purchase', voucherPrefix(company, 'Purchase'), company.reset_numbering_fiscal_year, company.fiscal_year_start, effectiveParams.date_bs)
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const creditFields = invoiceCreditFields(effectiveParams.date_bs, effectiveParams.credit_days, effectiveParams.is_cash)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Purchase', seq, invoice_no, ...dateFields, ...creditFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers, valuationMethod(company))
    set({ vouchers, accounts, stock })
  },

  // ─── Receipt ────────────────────────────────────────────────────────────────
  saveReceipt: async ({ allocations, deposit_to_account_id, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const { isCash } = validateMoneyAccount(deposit_to_account_id, company, get().rawAccounts, get().accountCategories)
    const validAllocations = validateAllocations(allocations, deposit_to_account_id, company, get().rawAccounts, get().accountCategories)
    const data = buildReceiptData(validAllocations, deposit_to_account_id)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Receipt lines do not balance')
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Receipt', voucherPrefix(company, 'Receipt'), company.reset_numbering_fiscal_year, company.fiscal_year_start, date_bs)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Receipt', seq, invoice_no, ...dateFields, narration, party_account_id: singlePartyAccountId(validAllocations, get().parties), settlement_account_id: deposit_to_account_id, is_cash: isCash, total: data.total, cancelled: false },
      lines: data.lines,
      settlements: settlementRows(validAllocations),
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    set({ vouchers, accounts })
  },

  // ─── Payment ────────────────────────────────────────────────────────────────
  savePayment: async ({ allocations, paid_from_account_id, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    const { isCash } = validateMoneyAccount(paid_from_account_id, company, get().rawAccounts, get().accountCategories)
    const validAllocations = validateAllocations(allocations, paid_from_account_id, company, get().rawAccounts, get().accountCategories)
    const data = buildPaymentData(validAllocations, paid_from_account_id)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Payment lines do not balance')
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, 'Payment', voucherPrefix(company, 'Payment'), company.reset_numbering_fiscal_year, company.fiscal_year_start, date_bs)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Payment', seq, invoice_no, ...dateFields, narration, party_account_id: singlePartyAccountId(validAllocations, get().parties), settlement_account_id: paid_from_account_id, is_cash: isCash, total: data.total, cancelled: false },
      lines: data.lines,
      settlements: settlementRows(validAllocations),
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
    const invoice_no = await getNextVoucherNo(company.id, 'Journal', voucherPrefix(company, 'Journal'), company.reset_numbering_fiscal_year, company.fiscal_year_start, date_bs)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Journal', seq, invoice_no, ...dateFields, narration, is_cash: false, total, cancelled: false },
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
    if (params.settlement_mode !== 'party') {
      if (!params.settlement_account_id) throw new Error('Select a settlement account')
      validateMoneyAccount(params.settlement_account_id, company, get().rawAccounts, get().accountCategories)
    }
    const data = buildReturnVoucherData({ ...params, original, system_accounts: systemAccountsFor(company, get().rawAccounts) })
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Return voucher lines do not balance')
    const seq = await getNextSeq(company.id)
    const invoice_no = await getNextVoucherNo(company.id, params.type, voucherPrefix(company, params.type), company.reset_numbering_fiscal_year, company.fiscal_year_start, params.date_bs)
    const dateFields = voucherDateFields(params.date_bs)
    const newVoucher = await insertVoucher({
      voucher: {
        company_id: company.id, type: params.type, seq, invoice_no, ...dateFields,
        original_voucher_id: original.id, return_reason: params.return_reason.trim(), narration: params.return_reason.trim(),
        settlement_mode: params.settlement_mode, settlement_account_id: params.settlement_mode === 'party' ? original.party_account_id : params.settlement_account_id, restock_items: params.type === 'Sales Return' ? params.restock_items : false,
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
      stock: recomputeStock(get().items, nextVouchers, valuationMethod(company)),
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
    const creditFields = invoiceCreditFields(effectiveParams.date_bs, effectiveParams.credit_days, effectiveParams.is_cash)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, ...creditFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, false),
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers, valuationMethod(company))
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
    const creditFields = invoiceCreditFields(effectiveParams.date_bs, effectiveParams.credit_days, effectiveParams.is_cash)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, ...creditFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, false),
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers, valuationMethod(company))
    set({ vouchers, accounts, stock })
  },

  updateReceipt: async (id, { allocations, deposit_to_account_id, narration, date_bs }) => {
    const existing = get().vouchers.find(v => v.id === id)
    if (!existing) throw new Error('Voucher not found')
    const company = get().company
    if (!company) throw new Error('No company')
    const { isCash } = validateMoneyAccount(deposit_to_account_id, company, get().rawAccounts, get().accountCategories, true)
    const validAllocations = validateAllocations(allocations, deposit_to_account_id, company, get().rawAccounts, get().accountCategories, true)
    const data = buildReceiptData(validAllocations, deposit_to_account_id)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Receipt lines do not balance')
    const dateFields = voucherDateFields(date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, narration, party_account_id: singlePartyAccountId(validAllocations, get().parties), settlement_account_id: deposit_to_account_id, is_cash: isCash, total: data.total, cancelled: false },
      lines: data.lines,
      settlements: settlementRows(validAllocations),
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
    const invoice_no = await getNextVoucherNo(company.id, 'Stock Adjustment', voucherPrefix(company, 'Stock Adjustment'), company.reset_numbering_fiscal_year, company.fiscal_year_start, date_bs)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Stock Adjustment', seq, invoice_no, ...dateFields, narration, is_cash: false, total: Math.abs(qty_delta * rate), cancelled: false },
      lines: [],
      stock_lines: [{ item_id, qty: Math.abs(qty_delta), rate, direction: qty_delta > 0 ? 'in' : 'out' }],
    })
    const vouchers = [newVoucher, ...get().vouchers]
    const stock = recomputeStock(get().items, vouchers, valuationMethod(company))
    set({ vouchers, stock })
    logAppEvent('stock_adjustment', company.id, { item_id, qty_delta, rate })
  },

  updatePayment: async (id, { allocations, paid_from_account_id, narration, date_bs }) => {
    const existing = get().vouchers.find(v => v.id === id)
    if (!existing) throw new Error('Voucher not found')
    const company = get().company
    if (!company) throw new Error('No company')
    const { isCash } = validateMoneyAccount(paid_from_account_id, company, get().rawAccounts, get().accountCategories, true)
    const validAllocations = validateAllocations(allocations, paid_from_account_id, company, get().rawAccounts, get().accountCategories, true)
    const data = buildPaymentData(validAllocations, paid_from_account_id)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Payment lines do not balance')
    const dateFields = voucherDateFields(date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, narration, party_account_id: singlePartyAccountId(validAllocations, get().parties), settlement_account_id: paid_from_account_id, is_cash: isCash, total: data.total, cancelled: false },
      lines: data.lines,
      settlements: settlementRows(validAllocations),
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
    if (params.settlement_mode !== 'party') {
      if (!params.settlement_account_id) throw new Error('Select a settlement account')
      validateMoneyAccount(params.settlement_account_id, company, get().rawAccounts, get().accountCategories, true)
    }
    const data = buildReturnVoucherData({ ...params, original, system_accounts: systemAccountsFor(company, get().rawAccounts) })
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Return voucher lines do not balance')
    const updated = await updateVoucher({
      id,
      voucher: {
        ...voucherDateFields(params.date_bs), original_voucher_id: original.id,
        return_reason: params.return_reason.trim(), narration: params.return_reason.trim(),
        settlement_mode: params.settlement_mode, settlement_account_id: params.settlement_mode === 'party' ? original.party_account_id : params.settlement_account_id, restock_items: params.type === 'Sales Return' ? params.restock_items : false,
        party_account_id: original.party_account_id, is_cash: params.settlement_mode === 'cash',
        subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total,
      },
      lines: data.lines,
      stock_lines: data.stock_lines,
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    set({ vouchers, accounts: recomputeAllBalances(get().rawAccounts, vouchers), stock: recomputeStock(get().items, vouchers, valuationMethod(company)) })
  },

  cancelV: async (id) => {
    if (get().vouchers.some(voucher => !voucher.cancelled && voucher.original_voucher_id === id)) throw new Error('Cancel linked return vouchers before cancelling the original invoice')
    await cancelVoucher(id)
    const vouchers = get().vouchers.map(v => v.id === id ? { ...v, cancelled: true } : v)
    const accounts = recomputeAllBalances(get().rawAccounts, vouchers)
    const stock = recomputeStock(get().items, vouchers, valuationMethod(get().company))
    set({ vouchers, accounts, stock })
  },

}))
