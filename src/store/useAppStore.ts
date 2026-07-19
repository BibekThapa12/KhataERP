import { create } from 'zustand'
import type { Account, AccountCategory, Company, Item, ItemCategory, Party, StockCondition, StockEntry, Voucher, VoucherLine, StockLine, CompanyModule, ChequePermission, ChequeBank, Cheque } from '@/types'
import {
  fetchAccounts, fetchParties, fetchItems, fetchVouchers,
  insertAccount, insertAccounts, upsertAccounts, insertParty, insertParties, insertItem,
  insertVoucher, cancelVoucher, updateCompany,
  updateVoucher, getOrCreateCompany,
  fetchAccountCategories, fetchItemCategories, insertAccountCategory, insertAccountCategories, insertItemCategory,
  updateAccountCategory, updateItemCategory, updateAccount, updateParty, updateItem, updateItemsByIds, logMasterChange,
  deleteAccount as removeAccount, deleteAccountCategory as removeAccountCategory,
  fetchCompanyModules, fetchChequePermissions, fetchChequeBanks, fetchCheques,
} from '@/lib/supabase'
import {
  applyVoucherBalanceDelta, defaultChartOfAccounts, recomputeAllBalances, recomputeAffectedBalances, recomputeStock, recomputeAffectedStock,
  buildSalesVoucherData, buildPurchaseVoucherData, buildReceiptData, buildPaymentData,
  buildReturnVoucherData, resolveSystemAccountId, round2, stockConditionQuantity, validateBalanced, type InvoiceEntryInput, type ReturnItemInput, type SystemAccountKey, type TransactionAllocation,
} from '@/lib/engine'
import { addDaysToBs, bsToAd, makeBsKey } from '@/lib/nepaliDate'
import { categoryDepth, categoryDescendantIds, subtreeHeight } from '@/lib/categoryHierarchy'
import { partyTerminology, partyTypeForCategory } from '@/lib/partyTerminology'
import { bankAccounts } from '@/lib/banks'
import { toBaseQty, toBaseRate } from '@/lib/units'
import { canonicalItemUnit, validateItemUnits } from '@/lib/itemUnits'
import { voucherNumberingPeriod, voucherNumberingScope } from '@/lib/voucherNumbers'
import { SYSTEM_ACCOUNT_DESTINATIONS, systemAccountGroupLevels } from '@/lib/systemAccountGroups'
import { accountCategoryDeletionBlockReason, ledgerDeletionBlockReason } from '@/lib/masterDeletion'
import { selectedFiscalYearStartBs } from '@/lib/reports'
import { ALL_CHEQUE_PERMISSIONS, chequeEntitlement } from '@/lib/cheques'
import { beginWriteTrace, type WritePerformanceTrace, type WriteTraceContext } from '@/lib/writePerformance'
import { publicErrorMessage, reportClientError } from '@/lib/security'
import { notifySuccess } from '@/lib/notifications'

const warnNonSensitive = (context: string) => (error: unknown) => { reportClientError(error, context) }

const valuationMethod = (company?: Company | null) => company?.inventory_valuation_method || 'weighted_average'

// Auth initialization, token events, and realtime notifications can arrive
// together. Share the active request so one company never performs the same
// full hydration more than once concurrently.
const companyDataLoadPromises = new Map<string, Promise<void>>()

async function measuredWrite<T>(context: WriteTraceContext, task: (trace: WritePerformanceTrace) => Promise<T>): Promise<T> {
  const trace = beginWriteTrace(context)
  try {
    const result = await task(trace)
    trace.finish(true)
    return result
  } catch (error) {
    trace.finish(false, error)
    throw error
  }
}

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
  companyModules: CompanyModule[]
  chequePermissions: ChequePermission[]
  chequeBanks: ChequeBank[]
  cheques: Cheque[]
  loading: boolean
  dataReady: boolean
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
  refreshChequeData: () => Promise<void>

  addParty: (data: { name: string; type: 'customer' | 'supplier'; phone?: string; pan_vat?: string; address?: string; default_credit_days?: number; opening_balance?: number }) => Promise<Party>
  addItem: (data: { name: string; unit: string; alternate_unit?: string | null; alternate_conversion?: number | null; sell_rate?: number; opening_qty?: number; opening_rate?: number; reorder_level?: number; category_id?: string; sku?: string; barcode?: string; vat_applicable?: boolean }) => Promise<Item>
  addAccount: (data: { name: string; type: Account['type']; group: string; category_id?: string; opening_balance?: number; address?: string | null; contact_no?: string | null; pan_no?: string | null; credit_days?: number | null; bank_account_no?: string | null; bank_branch?: string | null }) => Promise<Account>
  addAccountCategory: (data: { name: string; account_type: Account['type']; parent_category_id?: string | null }) => Promise<void>
  alterAccountCategory: (id: string, updates: Partial<AccountCategory>) => Promise<void>
  deleteAccountCategory: (id: string) => Promise<void>
  addItemCategory: (data: { name: string; parent_category_id?: string | null }) => Promise<void>
  alterItemCategory: (id: string, updates: Partial<ItemCategory>) => Promise<void>
  alterAccount: (id: string, updates: Partial<Account>) => Promise<void>
  deleteAccount: (id: string) => Promise<void>
  alterParty: (id: string, updates: Partial<Party>) => Promise<void>
  alterItem: (id: string, updates: Partial<Item>) => Promise<void>

  saveSalesVoucher: (params: InvoiceSaveParams) => Promise<void>
  savePurchaseVoucher: (params: InvoiceSaveParams) => Promise<void>
  saveReceipt: (params: { allocations: TransactionAllocation[]; deposit_to_account_id: string; narration?: string; date_bs: string }) => Promise<Voucher>
  savePayment: (params: { allocations: TransactionAllocation[]; paid_from_account_id: string; narration?: string; date_bs: string }) => Promise<void>
  saveJournal: (params: { lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]; narration?: string; date_bs: string }) => Promise<void>
  saveStockAdjustment: (params: { item_id: string; qty_delta: number; rate: number; narration?: string; date_bs: string; stock_condition: StockCondition; transfer_to?: 'damaged' | 'expired' }) => Promise<void>
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
  original_voucher_id?: string
  party_account_id?: string | null
  vat_rate?: number
  items: ReturnItemInput[]
  settlement_mode: 'party' | 'cash' | 'bank'
  settlement_account_id?: string
  restock_items: boolean
  stock_condition: StockCondition
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

function affectedItemIds(...vouchers: Array<Voucher | undefined>) {
  return new Set(vouchers.flatMap(voucher => [
    ...(voucher?.stock_lines || []).map(line => line.item_id),
    ...(voucher?.invoice_items || []).map(item => item.item_id),
  ]))
}

function recomputeVoucherEffects(
  state: Pick<AppState, 'accounts' | 'items' | 'stock'>,
  vouchers: Voucher[],
  company: Company,
  previousVoucher: Voucher | undefined,
  nextVoucher: Voucher,
) {
  return {
    accounts: applyVoucherBalanceDelta(state.accounts, previousVoucher, nextVoucher),
    stock: recomputeAffectedStock(state.items, state.stock, vouchers, affectedItemIds(previousVoucher, nextVoucher), valuationMethod(company)),
  }
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
  const keys: SystemAccountKey[] = ['cash', 'bank', 'inventory', 'vat_payable', 'vat_receivable', 'sales', 'purchase', 'sales_return', 'purchase_return', 'capital', 'retained_earnings', 'discount_allowed', 'rent', 'salary', 'electricity']
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
  const keys: SystemAccountKey[] = ['cash', 'bank', 'inventory', 'vat_payable', 'vat_receivable', 'sales', 'purchase', 'sales_return', 'purchase_return', 'capital', 'retained_earnings', 'discount_allowed', 'rent', 'salary', 'electricity']
  const key = accountId.startsWith(`${companyId}:`) ? accountId.slice(companyId.length + 1) : accountId
  return keys.includes(key as SystemAccountKey) ? key as SystemAccountKey : null
}

function validateReturnRequest(company: Company, parties: Party[], items: Item[], vouchers: Voucher[], params: ReturnSaveParams, editingId?: string) {
  const original = params.original_voucher_id ? vouchers.find(voucher => voucher.id === params.original_voucher_id) : undefined
  const expectedType = params.type === 'Sales Return' ? 'Sales' : 'Purchase'
  const expectedPartyType = params.type === 'Sales Return' ? 'customer' : 'supplier'
  if (params.original_voucher_id && (!original || original.type !== expectedType || original.cancelled)) throw new Error(`Select an active ${expectedType.toLowerCase()} voucher`)
  if (original) {
    const editingReturn = editingId ? vouchers.find(voucher => voucher.id === editingId) : undefined
    if (editingReturn?.original_voucher_id !== original.id) {
      const fiscalStart = selectedFiscalYearStartBs(company)
      const fiscalEndKey = makeBsKey(`${Number(fiscalStart.slice(0, 4)) + 1}-${fiscalStart.slice(5)}`)
      const originalKey = original.date_bs_key || makeBsKey(original.date_bs)
      if (originalKey < makeBsKey(fiscalStart) || originalKey >= fiscalEndKey) throw new Error('Returns can only be linked to bills from the current fiscal year')
    }
    if (params.party_account_id && original.party_account_id && params.party_account_id !== original.party_account_id) throw new Error('The selected bill belongs to a different party')
  } else {
    const party = parties.find(entry => entry.account_id === params.party_account_id && entry.type === expectedPartyType && !entry.is_archived)
    if (!party) throw new Error(`Select an active ${partyTerminology(expectedPartyType).singular}`)
  }
  if (!params.return_reason.trim()) throw new Error('Enter a return reason')
  const partyAccountId = original?.party_account_id || params.party_account_id
  if (params.settlement_mode === 'party' && !partyAccountId) throw new Error('A cash invoice cannot be adjusted through a party ledger')
  if (!params.items.length || params.items.some(item => !item.item_id || item.qty <= 0 || item.rate <= 0)) throw new Error('Enter at least one item with a positive quantity and rate')

  if (original) {
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
  }

  if (params.type === 'Purchase Return') {
    const requestedByItem = new Map<string, number>()
    for (const item of params.items) requestedByItem.set(item.item_id, (requestedByItem.get(item.item_id) || 0) + toBaseQty(item.qty, item.conversion_factor || 1))
    const editing = editingId ? vouchers.find(voucher => voucher.id === editingId) : undefined
    for (const [itemId, qty] of requestedByItem) {
      const currentReturnQty = editing?.stock_lines?.filter(line => line.item_id === itemId && line.direction === 'out' && (line.stock_condition || 'saleable') === params.stock_condition).reduce((sum, line) => sum + line.qty, 0) || 0
      const available = stockConditionQuantity(items, vouchers, itemId, params.stock_condition) + currentReturnQty
      if (qty > available + 0.0001) throw new Error(`Not enough stock to return ${qty}; only ${available} is available`)
    }
  }
  return original
}

export const useAppStore = create<AppState>((set, get) => ({
  userId: null,
  setUserId: (id) => set(state => state.userId === id ? state : {
    userId: id,
    company: null,
    accounts: [],
    rawAccounts: [],
    accountCategories: [],
    parties: [],
    items: [],
    itemCategories: [],
    stock: [],
    vouchers: [],
    companyModules: [],
    chequePermissions: [],
    chequeBanks: [],
    cheques: [],
    dataReady: false,
    error: null,
  }),
  company: null,
  accounts: [],
  rawAccounts: [],
  accountCategories: [],
  parties: [],
  items: [],
  itemCategories: [],
  stock: [],
  vouchers: [],
  companyModules: [],
  chequePermissions: [],
  chequeBanks: [],
  cheques: [],
  loading: false,
  dataReady: false,
  error: null,

  // ─── Derived ────────────────────────────────────────────────────────────────
  getAccount: (id) => get().accounts.find(a => a.id === id),
  getParty: (id) => get().parties.find(p => p.id === id),
  getPartyByAccountId: (accountId) => get().parties.find(p => p.account_id === accountId),
  getItem: (id) => get().items.find(i => i.id === id),
  getStockEntry: (itemId) => {
    const total = get().stock.find(entry => entry.id === itemId) ?? { id: itemId, name: '', unit: '', qty: 0, avg_cost: 0, value: 0 }
    const qty = stockConditionQuantity(get().items, get().vouchers, itemId, 'saleable')
    return { ...total, qty, value: round2(qty * total.avg_cost) }
  },
  partyAccounts: (type) =>
    get().parties.filter(p => p.type === type && !p.is_archived).map(p => ({
      ...p,
      account: get().accounts.find(a => a.id === p.account_id),
    })),
  closingStockValue: () => get().stock.reduce((s, e) => s + e.value, 0),

  // ─── Load All ───────────────────────────────────────────────────────────────
  loadAll: (userId) => {
    const pending = companyDataLoadPromises.get(userId)
    if (pending) return pending

    const request = (async () => {
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
      for (const ready of systemAccountGroupLevels()) {
        const changed = ready.filter(spec => {
          const parentId = spec.parent_key ? groupByKey.get(spec.parent_key)?.id || null : null
          const existing = accountCategories.find(entry => entry.name === spec.name && entry.account_type === spec.account_type)
          return !existing || existing.parent_category_id !== parentId || !existing.is_system || existing.is_archived
        })
        const saved = await insertAccountCategories(changed.map(spec => ({
          company_id: company.id,
          name: spec.name,
          account_type: spec.account_type,
          parent_category_id: spec.parent_key ? groupByKey.get(spec.parent_key)?.id || null : null,
          is_system: true,
          is_archived: false,
        })))
        for (const category of saved) {
          const existingIndex = accountCategories.findIndex(entry => entry.id === category.id)
          if (existingIndex >= 0) accountCategories[existingIndex] = category
          else accountCategories.push(category)
        }
        for (const spec of ready) {
          const category = accountCategories.find(entry => entry.name === spec.name && entry.account_type === spec.account_type)
          if (!category) throw new Error(`Could not initialize system account group ${spec.name}`)
          groupByKey.set(spec.key, category)
        }
      }

      const dirtyAccountIds = new Set<string>()
      const applyAccountRepairs = (account: Account, updates: Partial<Account>) => {
        if (!Object.keys(updates).length) return
        Object.assign(account, updates)
        dirtyAccountIds.add(account.id)
      }

      const legacyBank = accountCategories.find(category => category.name === 'Bank' && category.account_type === 'Asset')
      const bankCategory = groupByKey.get('bank-accounts')!
      if (legacyBank && legacyBank.id !== bankCategory.id) {
        const affected = rawAccounts.filter(entry => entry.category_id === legacyBank.id)
        for (const account of affected) applyAccountRepairs(account, { category_id: bankCategory.id, group: bankCategory.name })
      }

      const legacyIncome = accountCategories.find(category => category.name === 'Income' && category.account_type === 'Income')
      const incomesCategory = groupByKey.get('incomes')!
      if (legacyIncome && legacyIncome.id !== incomesCategory.id) {
        const affected = rawAccounts.filter(entry => entry.category_id === legacyIncome.id)
        for (const account of affected) applyAccountRepairs(account, { category_id: incomesCategory.id, group: incomesCategory.name })
      }

      const legacyTax = accountCategories.find(category => category.name === 'Duties & Taxes (Liabilities)' && category.account_type === 'Liability')
      const taxCategory = groupByKey.get('duties-taxes')!
      if (legacyTax && legacyTax.id !== taxCategory.id) {
        const affected = rawAccounts.filter(entry => entry.category_id === legacyTax.id)
        for (const account of affected) applyAccountRepairs(account, { category_id: taxCategory.id, group: taxCategory.name })
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
        applyAccountRepairs(account, repairs)
      }

      const missingLegacyGroups = [...new Map(rawAccounts
        .filter(account => !account.category_id && account.group && !accountCategories.some(category => category.name === account.group && category.account_type === account.type))
        .map(account => [`${account.type}:${account.group}`, { company_id: company.id, name: account.group, account_type: account.type, parent_category_id: null, is_system: false, is_archived: false }])).values()]
      const createdLegacyGroups = await insertAccountCategories(missingLegacyGroups)
      accountCategories.push(...createdLegacyGroups.filter(category => !accountCategories.some(existing => existing.id === category.id)))

      for (const account of rawAccounts) {
        if (account.category_id) continue
        const category = accountCategories.find(item => item.name === account.group && item.account_type === account.type)
        if (!category) continue
        applyAccountRepairs(account, { category_id: category.id })
      }

      const missingPartyRows = rawAccounts.flatMap(account => {
        if (parties.some(party => party.account_id === account.id)) return []
        const category = accountCategories.find(entry => entry.id === account.category_id)
        const partyType = partyTypeForCategory(category)
        if (partyType && !account.is_party) applyAccountRepairs(account, { is_party: true })
        return partyType ? [{ company_id: company.id, name: account.name, type: partyType, account_id: account.id, is_archived: !!account.is_archived }] : []
      })

      for (const party of parties) {
        const account = rawAccounts.find(entry => entry.id === party.account_id)
        const terminology = partyTerminology(party.type)
        const category = accountCategories.find(entry => entry.name === terminology.category && entry.account_type === terminology.accountType)
        if (!account || !category) continue
        if (account.category_id === category.id && account.group === terminology.category && account.type === terminology.accountType && account.is_party) continue
        const repairs = { category_id: category.id, group: terminology.category, type: terminology.accountType, is_party: true }
        applyAccountRepairs(account, repairs)
      }
      await upsertAccounts(rawAccounts.filter(account => dirtyAccountIds.has(account.id)))
      parties.push(...await insertParties(missingPartyRows))

      let generalItemCategory = itemCategories.find(category => category.name === 'General')
      if (!generalItemCategory) {
        generalItemCategory = await insertItemCategory({ company_id: company.id, name: 'General', is_archived: false })
        itemCategories.push(generalItemCategory)
      }
      const uncategorizedItems = items.filter(item => !item.category_id)
      await updateItemsByIds(uncategorizedItems.map(item => item.id), { category_id: generalItemCategory.id })
      for (const item of uncategorizedItems) item.category_id = generalItemCategory.id

      const accounts = recomputeAllBalances(rawAccounts, vouchers)
      const stock = recomputeStock(items, vouchers, valuationMethod(company))
      // Core accounting data is complete at this point. Render it immediately;
      // optional paid-module data must not hold the dashboard loading state.
      set({ company, rawAccounts, accountCategories, accounts, parties, items, itemCategories, stock, vouchers, userId, loading: false, dataReady: true })

      let companyModules: CompanyModule[] = [], chequePermissions: ChequePermission[] = [], chequeBanks: ChequeBank[] = [], cheques: Cheque[] = []
      try {
        companyModules = await fetchCompanyModules(company.id)
        const entitlement = companyModules.find(entry => entry.module?.key === 'cheque_management')
        if (chequeEntitlement(entitlement).canRead) {
          const loaded = await Promise.all([fetchChequePermissions(company.id), fetchChequeBanks(company.id), fetchCheques(company.id)])
          chequePermissions = loaded[0].length ? loaded[0] : ALL_CHEQUE_PERMISSIONS
          chequeBanks = loaded[1]; cheques = loaded[2]
        }
        // Ignore a late response when the authenticated company changed.
        if (get().company?.id === company.id) set({ companyModules, chequePermissions, chequeBanks, cheques })
      } catch (moduleError) { warnNonSensitive('Optional module data unavailable')(moduleError) }
    } catch (e: unknown) {
      set({ error: publicErrorMessage(e, 'loading company data'), loading: false })
    }
    })()

    const trackedRequest = request.finally(() => {
      if (companyDataLoadPromises.get(userId) === trackedRequest) {
        companyDataLoadPromises.delete(userId)
      }
    })
    companyDataLoadPromises.set(userId, trackedRequest)
    return trackedRequest
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
    notifySuccess('Company settings saved')
  },
  refreshChequeData: async () => {
    const company=get().company; if(!company) return
    const [chequeBanks,cheques]=await Promise.all([fetchChequeBanks(company.id),fetchCheques(company.id)])
    set({chequeBanks,cheques})
  },

  // ─── Masters ────────────────────────────────────────────────────────────────
  addParty: async ({ name, type, phone, pan_vat, address, default_credit_days = 0, opening_balance = 0 }) => {
    const { company, rawAccounts, vouchers } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_party', companyId: company.id, recordType: 'Party', lineItems: 0 }, async trace => {
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
      address: address || null,
      contact_no: phone || null,
      pan_no: pan_vat || null,
      credit_days: default_credit_days,
      bank_account_no: null,
      bank_branch: null,
    }
    await trace.measure('party_ledger_insert', () => insertAccount(newAccount), { category: 'network_database', query: true, dbFunction: 'postgrest:accounts.insert' })
    const newParty = await trace.measure('party_master_insert', () => insertParty({ company_id: company.id, name, type, phone, pan_vat, address, default_credit_days, account_id: accountId, is_archived: false }), { category: 'network_database', query: true, dbFunction: 'postgrest:parties.insert' })
    const nextState = trace.sync('affected_ledger_recompute', () => {
      const updatedRawAccounts = [...rawAccounts, { ...newAccount, balance: 0 }]
      return { rawAccounts: updatedRawAccounts, accounts: recomputeAffectedBalances(updatedRawAccounts, get().accounts, vouchers, [accountId]), parties: [...get().parties, newParty] }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess('Party created', name)
    return newParty
    })
  },

  addItem: async (data) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_item', companyId: company.id, recordType: 'Item', lineItems: 0 }, async trace => {
    const unit = canonicalItemUnit(data.unit) || data.unit.trim()
    const alternateUnit = data.alternate_unit ? canonicalItemUnit(data.alternate_unit) || data.alternate_unit.trim() : null
    const unitError = validateItemUnits(unit, alternateUnit)
    if (unitError) throw new Error(unitError)
    if (alternateUnit && Number(data.alternate_conversion || 0) <= 1) throw new Error('Alternative units per main unit must be greater than 1.')
    const generalCategory = get().itemCategories.find(category => category.name === 'General' && !category.is_archived)
    const newItem = await trace.measure('item_insert', () => insertItem({ company_id: company.id, sell_rate: 0, opening_qty: 0, opening_rate: 0, category_id: generalCategory?.id, vat_applicable: true, is_archived: false, ...data, unit, alternate_unit: alternateUnit, alternate_conversion: alternateUnit ? data.alternate_conversion : null }), { category: 'network_database', query: true, dbFunction: 'postgrest:items.insert' })
    const nextState = trace.sync('client_stock_recompute', () => {
      const items = [...get().items, newItem]
      return { items, stock: recomputeAffectedStock(items, get().stock, get().vouchers, [newItem.id], valuationMethod(company)) }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess('Item created', newItem.name)
    return newItem
    })
  },

  addAccount: async ({ name, type, group, category_id, opening_balance = 0, address = null, contact_no = null, pan_no = null, credit_days = null, bank_account_no = null, bank_branch = null }) => {
    const { company, rawAccounts, vouchers } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_account', companyId: company.id, recordType: 'Account', lineItems: 0 }, async trace => {
    const category = get().accountCategories.find(entry => entry.id === category_id)
    const partyType = partyTypeForCategory(category)
    const newAcc = { id: crypto.randomUUID(), company_id: company.id, name, type, group, category_id, is_system: false, is_party: !!partyType, is_archived: false, opening_balance, address, contact_no, pan_no, credit_days, bank_account_no, bank_branch }
    await trace.measure('account_insert', () => insertAccount(newAcc), { category: 'network_database', query: true, dbFunction: 'postgrest:accounts.insert' })
    const newParty = partyType ? await trace.measure('linked_party_insert', () => insertParty({ company_id: company.id, name, type: partyType, phone: contact_no, pan_vat: pan_no, address, default_credit_days: credit_days || 0, account_id: newAcc.id, is_archived: false }), { category: 'network_database', query: true, dbFunction: 'postgrest:parties.insert' }) : null
    const updatedRaw = [...rawAccounts, { ...newAcc, balance: 0 }]
    const accounts = recomputeAffectedBalances(updatedRaw, get().accounts, vouchers, [newAcc.id])
    set({ rawAccounts: updatedRaw, accounts, parties: newParty ? [...get().parties, newParty] : get().parties })
    notifySuccess('Ledger created', name)
    return { ...newAcc, balance: 0 }
    })
  },

  addAccountCategory: async ({ name, account_type, parent_category_id = null }) => {
    const company = get().company
    if (!company) throw new Error('No company')
    if (!parent_category_id) throw new Error('Select a parent account group')
    const parent = parent_category_id ? get().accountCategories.find(category => category.id === parent_category_id) : undefined
    if (!parent) throw new Error('Parent account group not found')
    if (parent && parent.account_type !== account_type) throw new Error('Parent category must use the same account type')
    if (parent && categoryDepth(get().accountCategories, parent.id) >= 3) throw new Error('Category hierarchy cannot exceed three levels')
    const category = await insertAccountCategory({ company_id: company.id, name, account_type, parent_category_id, is_system: false, is_archived: false })
    set({ accountCategories: [...get().accountCategories, category].sort((a, b) => a.name.localeCompare(b.name)) })
    logMasterChange(company.id, 'account_category', category.id, 'create', {}, category).catch(warnNonSensitive('Could not record account category audit'))
    notifySuccess('Account group created', category.name)
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
    set({ accountCategories, rawAccounts, accounts: recomputeAffectedBalances(rawAccounts, get().accounts, get().vouchers, []) })
    logMasterChange(company.id, 'account_category', id, 'update', existing, updates as Record<string, unknown>).catch(warnNonSensitive('Could not record account category audit'))
    notifySuccess(updates.is_archived === true ? 'Account group archived' : updates.is_archived === false ? 'Account group restored' : 'Account group updated', updates.name || existing.name)
  },

  deleteAccountCategory: async (id) => {
    const company = get().company
    const existing = get().accountCategories.find(category => category.id === id)
    if (!company || !existing) throw new Error('Category not found')
    const blocked = accountCategoryDeletionBlockReason(existing, get().accountCategories, get().rawAccounts)
    if (blocked) throw new Error(blocked)
    await removeAccountCategory(id)
    set({ accountCategories: get().accountCategories.filter(category => category.id !== id) })
    logMasterChange(company.id, 'account_category', id, 'delete', existing, {}).catch(warnNonSensitive('Could not record account category audit'))
    notifySuccess('Account group deleted', existing.name)
  },

  addItemCategory: async ({ name, parent_category_id = null }) => {
    const company = get().company
    if (!company) throw new Error('No company')
    const parent = parent_category_id ? get().itemCategories.find(category => category.id === parent_category_id) : undefined
    if (parent && categoryDepth(get().itemCategories, parent.id) >= 3) throw new Error('Category hierarchy cannot exceed three levels')
    const category = await insertItemCategory({ company_id: company.id, name, parent_category_id, is_archived: false })
    set({ itemCategories: [...get().itemCategories, category].sort((a, b) => a.name.localeCompare(b.name)) })
    logMasterChange(company.id, 'item_category', category.id, 'create', {}, category).catch(warnNonSensitive('Could not record item category audit'))
    notifySuccess('Item category created', category.name)
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
    logMasterChange(company.id, 'item_category', id, 'update', existing, updates as Record<string, unknown>).catch(warnNonSensitive('Could not record item category audit'))
    notifySuccess(updates.is_archived === true ? 'Item category archived' : updates.is_archived === false ? 'Item category restored' : 'Item category updated', updates.name || existing.name)
  },

  alterAccount: async (id, updates) => {
    const company = get().company
    const existing = get().rawAccounts.find(account => account.id === id)
    if (!company || !existing) throw new Error('Ledger not found')
    return measuredWrite({ operation: 'update_account', companyId: company.id, recordType: 'Account', lineItems: 0 }, async trace => {
    const used = get().vouchers.some(voucher => voucher.lines?.some(line => line.account_id === id))
    if ((existing.is_system || used) && updates.type && updates.type !== existing.type) throw new Error('The account type of a system or used ledger cannot be changed')
    const categoryId = updates.category_id || existing.category_id
    const category = get().accountCategories.find(entry => entry.id === categoryId)
    const partyType = partyTypeForCategory(category)
    const existingParty = get().parties.find(party => party.account_id === id)
    const effectiveUpdates = partyType
      ? { ...updates, category_id: category!.id, group: category!.name, type: category!.account_type, is_party: true }
      : updates
    await trace.measure('account_update', () => updateAccount(id, effectiveUpdates), { category: 'network_database', query: true, dbFunction: 'postgrest:accounts.update' })
    const partyDetails = {
      name: effectiveUpdates.name || existing.name,
      type: partyType,
      phone: effectiveUpdates.contact_no === undefined ? existing.contact_no || null : effectiveUpdates.contact_no,
      pan_vat: effectiveUpdates.pan_no === undefined ? existing.pan_no || null : effectiveUpdates.pan_no,
      address: effectiveUpdates.address === undefined ? existing.address || null : effectiveUpdates.address,
      default_credit_days: effectiveUpdates.credit_days === undefined ? existing.credit_days || 0 : effectiveUpdates.credit_days || 0,
    }
    const newParty = partyType && !existingParty ? await trace.measure('linked_party_insert', () => insertParty({ company_id: company.id, ...partyDetails, type: partyType, account_id: id, is_archived: !!effectiveUpdates.is_archived }), { category: 'network_database', query: true, dbFunction: 'postgrest:parties.insert' }) : null
    if (partyType && existingParty) {
      await trace.measure('linked_party_update', () => updateParty(existingParty.id, partyDetails), { category: 'network_database', query: true, dbFunction: 'postgrest:parties.update' })
    }
    const rawAccounts = get().rawAccounts.map(account => account.id === id ? { ...account, ...effectiveUpdates } : account)
    const parties = newParty
      ? [...get().parties, newParty]
      : partyType && existingParty
        ? get().parties.map(item => item.id === existingParty.id ? { ...item, ...partyDetails, type: partyType } : item)
        : get().parties
    set({ rawAccounts, accounts: recomputeAffectedBalances(rawAccounts, get().accounts, get().vouchers, [id]), parties })
    logMasterChange(company.id, 'account', id, effectiveUpdates.is_archived !== undefined ? 'archive_status' : 'update', existing, effectiveUpdates as Record<string, unknown>).catch(warnNonSensitive('Could not record account audit'))
    notifySuccess(effectiveUpdates.is_archived === true ? 'Ledger archived' : effectiveUpdates.is_archived === false ? 'Ledger restored' : 'Ledger updated', effectiveUpdates.name || existing.name)
    })
  },

  deleteAccount: async (id) => {
    const company = get().company
    const existing = get().rawAccounts.find(account => account.id === id)
    if (!company || !existing) throw new Error('Ledger not found')
    const current = get().accounts.find(account => account.id === id) || existing
    const blocked = ledgerDeletionBlockReason(current, get().vouchers)
    if (blocked) throw new Error(blocked)
    await removeAccount(id)
    const rawAccounts = get().rawAccounts.filter(account => account.id !== id)
    set({
      rawAccounts,
      accounts: get().accounts.filter(account => account.id !== id),
      parties: get().parties.filter(party => party.account_id !== id),
    })
    logMasterChange(company.id, 'account', id, 'delete', existing, {}).catch(warnNonSensitive('Could not record account audit'))
    notifySuccess('Ledger deleted', existing.name)
  },

  alterParty: async (id, updates) => {
    const company = get().company
    const party = get().parties.find(item => item.id === id)
    if (!company || !party) throw new Error('Party not found')
    return measuredWrite({ operation: 'update_party', companyId: company.id, recordType: 'Party', lineItems: 0 }, async trace => {
    if (updates.default_credit_days !== undefined && (!Number.isInteger(updates.default_credit_days) || updates.default_credit_days < 0)) throw new Error('Default Credit Days must be a whole number of 0 or more')
    const nextType = updates.type || party.type
    const terminology = partyTerminology(nextType)
    const categoryName = terminology.category
    const accountType = terminology.accountType
    const category = get().accountCategories.find(item => item.name === categoryName && item.account_type === accountType)
    const accountUpdates: Partial<Account> = {
      name: updates.name || party.name,
      type: accountType,
      group: categoryName,
      category_id: category?.id,
      is_archived: updates.is_archived,
      address: updates.address === undefined ? undefined : updates.address || null,
      contact_no: updates.phone === undefined ? undefined : updates.phone || null,
      pan_no: updates.pan_vat === undefined ? undefined : updates.pan_vat || null,
      credit_days: updates.default_credit_days === undefined ? undefined : updates.default_credit_days,
    }
    await trace.measure('party_master_update', () => updateParty(id, updates), { category: 'network_database', query: true, dbFunction: 'postgrest:parties.update' })
    await trace.measure('party_ledger_update', () => updateAccount(party.account_id, accountUpdates), { category: 'network_database', query: true, dbFunction: 'postgrest:accounts.update' })
    const parties = get().parties.map(item => item.id === id ? { ...item, ...updates } : item)
    const rawAccounts = get().rawAccounts.map(account => account.id === party.account_id ? { ...account, ...accountUpdates } : account)
    set({ parties, rawAccounts, accounts: recomputeAffectedBalances(rawAccounts, get().accounts, get().vouchers, [party.account_id]) })
    logMasterChange(company.id, 'party', id, 'update', party, updates as Record<string, unknown>).catch(warnNonSensitive('Could not record party audit'))
    notifySuccess(updates.is_archived === true ? 'Party archived' : updates.is_archived === false ? 'Party restored' : 'Party updated', updates.name || party.name)
    })
  },

  alterItem: async (id, updates) => {
    const company = get().company
    const existing = get().items.find(item => item.id === id)
    if (!company || !existing) throw new Error('Item not found')
    return measuredWrite({ operation: 'update_item', companyId: company.id, recordType: 'Item', lineItems: 0 }, async trace => {
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
    await trace.measure('item_update', () => updateItem(id, normalizedUpdates), { category: 'network_database', query: true, dbFunction: 'postgrest:items.update' })
    const items = get().items.map(item => item.id === id ? { ...item, ...normalizedUpdates } : item)
    set({ items, stock: recomputeAffectedStock(items, get().stock, get().vouchers, [id], valuationMethod(company)) })
    logMasterChange(company.id, 'item', id, normalizedUpdates.is_archived !== undefined ? 'archive_status' : 'update', existing, normalizedUpdates as Record<string, unknown>).catch(warnNonSensitive('Could not record item audit'))
    notifySuccess(normalizedUpdates.is_archived === true ? 'Item archived' : normalizedUpdates.is_archived === false ? 'Item restored' : 'Item updated', normalizedUpdates.name || existing.name)
    })
  },

  // ─── Sales ──────────────────────────────────────────────────────────────────
  saveSalesVoucher: async (params) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_sales_invoice', companyId: company.id, recordType: 'Sales', lineItems: params.items.length }, async trace => {
    const { effectiveParams, data } = trace.sync('validation_and_payload', () => {
      const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
      const data = buildSalesVoucherData(effectiveParams)
      if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Lines do not balance')
      return { effectiveParams, data }
    })
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const creditFields = invoiceCreditFields(effectiveParams.date_bs, effectiveParams.credit_days, effectiveParams.is_cash)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Sales', numbering_period: voucherNumberingPeriod(company, effectiveParams.date_bs), ...dateFields, ...creditFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
      numbering: voucherNumberingScope(company, 'Sales', effectiveParams.date_bs),
      trace,
    })
    const nextState = trace.sync('client_balance_and_stock_recompute', () => {
      const vouchers = [newVoucher, ...get().vouchers]
      return { vouchers, ...recomputeVoucherEffects(get(), vouchers, company, undefined, newVoucher) }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess('Sales invoice saved', newVoucher.invoice_no)
    })
  },

  // ─── Purchase ───────────────────────────────────────────────────────────────
  savePurchaseVoucher: async (params) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_purchase_invoice', companyId: company.id, recordType: 'Purchase', lineItems: params.items.length }, async trace => {
    const { effectiveParams, data } = trace.sync('validation_and_payload', () => {
      const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
      return { effectiveParams, data: buildPurchaseVoucherData(effectiveParams) }
    })
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const creditFields = invoiceCreditFields(effectiveParams.date_bs, effectiveParams.credit_days, effectiveParams.is_cash)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Purchase', numbering_period: voucherNumberingPeriod(company, effectiveParams.date_bs), ...dateFields, ...creditFields, narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
      numbering: voucherNumberingScope(company, 'Purchase', effectiveParams.date_bs),
      trace,
    })
    const nextState = trace.sync('client_balance_and_stock_recompute', () => {
      const vouchers = [newVoucher, ...get().vouchers]
      return { vouchers, ...recomputeVoucherEffects(get(), vouchers, company, undefined, newVoucher) }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess('Purchase invoice saved', newVoucher.invoice_no)
    })
  },

  // ─── Receipt ────────────────────────────────────────────────────────────────
  saveReceipt: async ({ allocations, deposit_to_account_id, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_receipt', companyId: company.id, recordType: 'Receipt', lineItems: allocations.length }, async trace => {
    const { isCash, validAllocations, data } = trace.sync('validation_and_payload', () => {
      const { isCash } = validateMoneyAccount(deposit_to_account_id, company, get().rawAccounts, get().accountCategories)
      const validAllocations = validateAllocations(allocations, deposit_to_account_id, company, get().rawAccounts, get().accountCategories)
      const data = buildReceiptData(validAllocations, deposit_to_account_id)
      if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Receipt lines do not balance')
      return { isCash, validAllocations, data }
    })
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Receipt', numbering_period: voucherNumberingPeriod(company, date_bs), ...dateFields, narration, party_account_id: singlePartyAccountId(validAllocations, get().parties), settlement_account_id: deposit_to_account_id, is_cash: isCash, total: data.total, cancelled: false },
      lines: data.lines,
      settlements: settlementRows(validAllocations),
      numbering: voucherNumberingScope(company, 'Receipt', date_bs),
      trace,
    })
    const nextState = trace.sync('client_balance_recompute', () => {
      const vouchers = [newVoucher, ...get().vouchers]
      return { vouchers, accounts: applyVoucherBalanceDelta(get().accounts, undefined, newVoucher) }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess('Receipt saved', newVoucher.invoice_no)
    return newVoucher
    })
  },

  // ─── Payment ────────────────────────────────────────────────────────────────
  savePayment: async ({ allocations, paid_from_account_id, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_payment', companyId: company.id, recordType: 'Payment', lineItems: allocations.length }, async trace => {
    const { isCash, validAllocations, data } = trace.sync('validation_and_payload', () => {
      const { isCash } = validateMoneyAccount(paid_from_account_id, company, get().rawAccounts, get().accountCategories)
      const validAllocations = validateAllocations(allocations, paid_from_account_id, company, get().rawAccounts, get().accountCategories)
      const data = buildPaymentData(validAllocations, paid_from_account_id)
      if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Payment lines do not balance')
      return { isCash, validAllocations, data }
    })
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Payment', numbering_period: voucherNumberingPeriod(company, date_bs), ...dateFields, narration, party_account_id: singlePartyAccountId(validAllocations, get().parties), settlement_account_id: paid_from_account_id, is_cash: isCash, total: data.total, cancelled: false },
      lines: data.lines,
      settlements: settlementRows(validAllocations),
      numbering: voucherNumberingScope(company, 'Payment', date_bs),
      trace,
    })
    const nextState = trace.sync('client_balance_recompute', () => {
      const vouchers = [newVoucher, ...get().vouchers]
      return { vouchers, accounts: applyVoucherBalanceDelta(get().accounts, undefined, newVoucher) }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess('Payment saved', newVoucher.invoice_no)
    })
  },

  // ─── Journal ────────────────────────────────────────────────────────────────
  saveJournal: async ({ lines, narration, date_bs }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_journal', companyId: company.id, recordType: 'Journal', lineItems: lines.length }, async trace => {
    const total = trace.sync('validation_and_payload', () => {
      if (!validateBalanced(lines as VoucherLine[]).valid) throw new Error('Journal lines do not balance')
      return lines.reduce((sum, line) => sum + (line.debit || 0), 0)
    })
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Journal', numbering_period: voucherNumberingPeriod(company, date_bs), ...dateFields, narration, is_cash: false, total, cancelled: false },
      lines,
      numbering: voucherNumberingScope(company, 'Journal', date_bs),
      trace,
    })
    const nextState = trace.sync('client_balance_recompute', () => {
      const vouchers = [newVoucher, ...get().vouchers]
      return { vouchers, accounts: applyVoucherBalanceDelta(get().accounts, undefined, newVoucher) }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess('Journal voucher saved', newVoucher.invoice_no)
    })
  },

  saveReturnVoucher: async (params) => {
    const { company, vouchers } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: params.type === 'Sales Return' ? 'create_credit_note' : 'create_debit_note', companyId: company.id, recordType: params.type, lineItems: params.items.length }, async trace => {
    const { original, partyAccountId, data } = trace.sync('validation_and_payload', () => {
    const original = validateReturnRequest(company, get().parties, get().items, vouchers, params)
    if (params.settlement_mode !== 'party') {
      if (!params.settlement_account_id) throw new Error('Select a settlement account')
      validateMoneyAccount(params.settlement_account_id, company, get().rawAccounts, get().accountCategories)
    }
    const partyAccountId = original?.party_account_id || params.party_account_id || null
    const data = buildReturnVoucherData({ ...params, original, party_account_id: partyAccountId, system_accounts: systemAccountsFor(company, get().rawAccounts) })
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Return voucher lines do not balance')
    return { original, partyAccountId, data }
    })
    const dateFields = voucherDateFields(params.date_bs)
    const newVoucher = await insertVoucher({
      voucher: {
        company_id: company.id, type: params.type, numbering_period: voucherNumberingPeriod(company, params.date_bs), ...dateFields,
        original_voucher_id: original?.id || null, return_reason: params.return_reason.trim(), narration: params.return_reason.trim(),
        settlement_mode: params.settlement_mode, settlement_account_id: params.settlement_mode === 'party' ? partyAccountId : params.settlement_account_id, restock_items: params.type === 'Sales Return' ? params.restock_items : false,
        party_account_id: partyAccountId, is_cash: params.settlement_mode === 'cash',
        subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount,
        total: data.total, cancelled: false,
      },
      lines: data.lines,
      stock_lines: data.stock_lines,
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
      numbering: voucherNumberingScope(company, params.type, params.date_bs),
      audit: { eventType: 'return_created', metadata: { type: params.type, original_voucher_id: original?.id || null } },
      trace,
    })
    const nextState = trace.sync('client_balance_and_stock_recompute', () => {
      const nextVouchers = [newVoucher, ...vouchers]
      return { vouchers: nextVouchers, ...recomputeVoucherEffects(get(), nextVouchers, company, undefined, newVoucher) }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess(params.type === 'Sales Return' ? 'Sales return saved' : 'Purchase return saved', newVoucher.invoice_no)
    })
  },

  // ─── Cancel ─────────────────────────────────────────────────────────────────
  updateSalesVoucher: async (id, params) => {
    const existing = get().vouchers.find(v => v.id === id)
    const company = get().company
    if (!existing) throw new Error('Voucher not found')
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'update_sales_invoice', companyId: company.id, recordType: 'Sales', lineItems: params.items.length }, async trace => {
    if (get().vouchers.some(voucher => !voucher.cancelled && voucher.original_voucher_id === id)) throw new Error('This invoice has an active return and can no longer be edited')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildSalesVoucherData(effectiveParams)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Lines do not balance')
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const creditFields = invoiceCreditFields(effectiveParams.date_bs, effectiveParams.credit_days, effectiveParams.is_cash)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, ...creditFields, numbering_period: voucherNumberingPeriod(company, effectiveParams.date_bs), narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, false),
      trace,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const { accounts, stock } = recomputeVoucherEffects(get(), vouchers, company, existing, updated)
    set({ vouchers, accounts, stock })
    notifySuccess('Sales invoice updated', updated.invoice_no)
    })
  },

  updatePurchaseVoucher: async (id, params) => {
    const existing = get().vouchers.find(v => v.id === id)
    const company = get().company
    if (!existing) throw new Error('Voucher not found')
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'update_purchase_invoice', companyId: company.id, recordType: 'Purchase', lineItems: params.items.length }, async trace => {
    if (get().vouchers.some(voucher => !voucher.cancelled && voucher.original_voucher_id === id)) throw new Error('This bill has an active return and can no longer be edited')
    const effectiveParams = { ...params, vat_rate: company.vat_enabled === false ? 0 : params.vat_rate, system_accounts: systemAccountsFor(company, get().rawAccounts) }
    const data = buildPurchaseVoucherData(effectiveParams)
    const dateFields = voucherDateFields(effectiveParams.date_bs)
    const creditFields = invoiceCreditFields(effectiveParams.date_bs, effectiveParams.credit_days, effectiveParams.is_cash)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, ...creditFields, numbering_period: voucherNumberingPeriod(company, effectiveParams.date_bs), narration: effectiveParams.narration, party_account_id: effectiveParams.is_cash ? undefined : (effectiveParams.party_account_id ?? undefined), is_cash: effectiveParams.is_cash, subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total, cancelled: false },
      lines: data.lines as Omit<VoucherLine, 'id' | 'voucher_id'>[],
      stock_lines: data.stock_lines as Omit<StockLine, 'id' | 'voucher_id'>[],
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, false),
      trace,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const { accounts, stock } = recomputeVoucherEffects(get(), vouchers, company, existing, updated)
    set({ vouchers, accounts, stock })
    notifySuccess('Purchase invoice updated', updated.invoice_no)
    })
  },

  updateReceipt: async (id, { allocations, deposit_to_account_id, narration, date_bs }) => {
    const existing = get().vouchers.find(v => v.id === id)
    if (!existing) throw new Error('Voucher not found')
    const company = get().company
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'update_receipt', companyId: company.id, recordType: 'Receipt', lineItems: allocations.length }, async trace => {
    const { isCash } = validateMoneyAccount(deposit_to_account_id, company, get().rawAccounts, get().accountCategories, true)
    const validAllocations = validateAllocations(allocations, deposit_to_account_id, company, get().rawAccounts, get().accountCategories, true)
    const data = buildReceiptData(validAllocations, deposit_to_account_id)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Receipt lines do not balance')
    const dateFields = voucherDateFields(date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, numbering_period: voucherNumberingPeriod(company, date_bs), narration, party_account_id: singlePartyAccountId(validAllocations, get().parties), settlement_account_id: deposit_to_account_id, is_cash: isCash, total: data.total, cancelled: false },
      lines: data.lines,
      settlements: settlementRows(validAllocations),
      trace,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = applyVoucherBalanceDelta(get().accounts, existing, updated)
    set({ vouchers, accounts })
    notifySuccess('Receipt updated', updated.invoice_no)
    })
  },

  saveStockAdjustment: async ({ item_id, qty_delta, rate, narration, date_bs, stock_condition, transfer_to }) => {
    const { company } = get()
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'create_stock_adjustment', companyId: company.id, recordType: 'Stock Adjustment', lineItems: transfer_to ? 2 : 1 }, async trace => {
    trace.sync('validation_and_payload', () => {
    if (!item_id) throw new Error('Select an item')
    if (!qty_delta) throw new Error('Enter a quantity adjustment')
    const quantity = Math.abs(qty_delta)
    const sourceCondition: StockCondition = transfer_to ? 'saleable' : stock_condition
    if (transfer_to && transfer_to === sourceCondition) throw new Error('Select a different destination for the transfer')
    if ((transfer_to || qty_delta < 0) && quantity > stockConditionQuantity(get().items, get().vouchers, item_id, sourceCondition) + 0.0001) throw new Error(`Only ${stockConditionQuantity(get().items, get().vouchers, item_id, sourceCondition)} units are available in ${sourceCondition} stock`)
    })
    const quantity = Math.abs(qty_delta)
    const dateFields = voucherDateFields(date_bs)
    const newVoucher = await insertVoucher({
      voucher: { company_id: company.id, type: 'Stock Adjustment', numbering_period: voucherNumberingPeriod(company, date_bs), ...dateFields, narration: narration || (transfer_to ? `Transfer from saleable to ${transfer_to} stock` : undefined), is_cash: false, total: transfer_to ? 0 : Math.abs(qty_delta * rate), cancelled: false },
      lines: [],
      stock_lines: transfer_to
        ? [
            { item_id, qty: quantity, rate, direction: 'out', stock_condition: 'saleable', is_transfer: true },
            { item_id, qty: quantity, rate, direction: 'in', stock_condition: transfer_to, is_transfer: true },
          ]
        : [{ item_id, qty: quantity, rate, direction: qty_delta > 0 ? 'in' : 'out', stock_condition, is_transfer: false }],
      numbering: voucherNumberingScope(company, 'Stock Adjustment', date_bs),
      audit: { eventType: 'stock_adjustment', metadata: { item_id, qty_delta, rate, stock_condition, transfer_to } },
      trace,
    })
    const nextState = trace.sync('client_stock_recompute', () => {
      const vouchers = [newVoucher, ...get().vouchers]
      return { vouchers, stock: recomputeAffectedStock(get().items, get().stock, vouchers, affectedItemIds(newVoucher), valuationMethod(company)) }
    }, { category: 'cache' })
    trace.sync('zustand_state_update', () => set(nextState), { category: 'cache' })
    notifySuccess(transfer_to ? 'Stock transferred' : 'Stock adjustment saved', newVoucher.invoice_no)
    })
  },

  updatePayment: async (id, { allocations, paid_from_account_id, narration, date_bs }) => {
    const existing = get().vouchers.find(v => v.id === id)
    if (!existing) throw new Error('Voucher not found')
    const company = get().company
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'update_payment', companyId: company.id, recordType: 'Payment', lineItems: allocations.length }, async trace => {
    const { isCash } = validateMoneyAccount(paid_from_account_id, company, get().rawAccounts, get().accountCategories, true)
    const validAllocations = validateAllocations(allocations, paid_from_account_id, company, get().rawAccounts, get().accountCategories, true)
    const data = buildPaymentData(validAllocations, paid_from_account_id)
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Payment lines do not balance')
    const dateFields = voucherDateFields(date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, numbering_period: voucherNumberingPeriod(company, date_bs), narration, party_account_id: singlePartyAccountId(validAllocations, get().parties), settlement_account_id: paid_from_account_id, is_cash: isCash, total: data.total, cancelled: false },
      lines: data.lines,
      settlements: settlementRows(validAllocations),
      trace,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = applyVoucherBalanceDelta(get().accounts, existing, updated)
    set({ vouchers, accounts })
    notifySuccess('Payment updated', updated.invoice_no)
    })
  },

  updateJournal: async (id, { lines, narration, date_bs }) => {
    const existing = get().vouchers.find(v => v.id === id)
    if (!existing) throw new Error('Voucher not found')
    const company = get().company
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'update_journal', companyId: company.id, recordType: 'Journal', lineItems: lines.length }, async trace => {
    if (!validateBalanced(lines as VoucherLine[]).valid) throw new Error('Journal lines do not balance')
    const total = lines.reduce((s, l) => s + (l.debit || 0), 0)
    const dateFields = voucherDateFields(date_bs)
    const updated = await updateVoucher({
      id,
      voucher: { ...dateFields, numbering_period: voucherNumberingPeriod(company, date_bs), narration, is_cash: false, total, cancelled: false },
      lines,
      trace,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    const accounts = applyVoucherBalanceDelta(get().accounts, existing, updated)
    set({ vouchers, accounts })
    notifySuccess('Journal voucher updated', updated.invoice_no)
    })
  },

  updateReturnVoucher: async (id, params) => {
    const existing = get().vouchers.find(voucher => voucher.id === id)
    const company = get().company
    if (!existing || (existing.type !== 'Sales Return' && existing.type !== 'Purchase Return')) throw new Error('Return voucher not found')
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: params.type === 'Sales Return' ? 'update_credit_note' : 'update_debit_note', companyId: company.id, recordType: params.type, lineItems: params.items.length }, async trace => {
    const original = validateReturnRequest(company, get().parties, get().items, get().vouchers, params, id)
    if (params.settlement_mode !== 'party') {
      if (!params.settlement_account_id) throw new Error('Select a settlement account')
      validateMoneyAccount(params.settlement_account_id, company, get().rawAccounts, get().accountCategories, true)
    }
    const partyAccountId = original?.party_account_id || params.party_account_id || null
    const data = buildReturnVoucherData({ ...params, original, party_account_id: partyAccountId, system_accounts: systemAccountsFor(company, get().rawAccounts) })
    if (!validateBalanced(data.lines as VoucherLine[]).valid) throw new Error('Return voucher lines do not balance')
    const updated = await updateVoucher({
      id,
      voucher: {
        ...voucherDateFields(params.date_bs), numbering_period: voucherNumberingPeriod(company, params.date_bs), original_voucher_id: original?.id || null,
        return_reason: params.return_reason.trim(), narration: params.return_reason.trim(),
        settlement_mode: params.settlement_mode, settlement_account_id: params.settlement_mode === 'party' ? partyAccountId : params.settlement_account_id, restock_items: params.type === 'Sales Return' ? params.restock_items : false,
        party_account_id: partyAccountId, is_cash: params.settlement_mode === 'cash',
        subtotal: data.subtotal, discount: data.discount, vat_rate: data.vat_rate, vat_amount: data.vat_amount, total: data.total,
      },
      lines: data.lines,
      stock_lines: data.stock_lines,
      invoice_items: invoiceItemSnapshots(data.invoice_items, get().items, get().stock, true),
      trace,
    })
    const vouchers = replaceVoucherInState(get().vouchers, { ...existing, ...updated })
    set({ vouchers, ...recomputeVoucherEffects(get(), vouchers, company, existing, updated) })
    notifySuccess(params.type === 'Sales Return' ? 'Sales return updated' : 'Purchase return updated', updated.invoice_no)
    })
  },

  cancelV: async (id) => {
    if (get().vouchers.some(voucher => !voucher.cancelled && voucher.original_voucher_id === id)) throw new Error('Cancel linked return vouchers before cancelling the original invoice')
    const company = get().company
    if (!company) throw new Error('No company')
    return measuredWrite({ operation: 'cancel_voucher', companyId: company.id, recordType: 'Voucher', lineItems: 0 }, async trace => {
    await cancelVoucher(id, trace)
    const existing = get().vouchers.find(voucher => voucher.id === id)
    const cancelled = existing ? { ...existing, cancelled: true } : undefined
    const vouchers = get().vouchers.map(v => v.id === id ? cancelled! : v)
    const accounts = applyVoucherBalanceDelta(get().accounts, existing, cancelled)
    const stock = recomputeAffectedStock(get().items, get().stock, vouchers, affectedItemIds(existing), valuationMethod(company))
    set({ vouchers, accounts, stock })
    notifySuccess('Voucher cancelled', existing?.invoice_no)
    })
  },

}))
