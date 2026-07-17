import type { Account, AccountCategory, AccountType, Company, DetailedProfitLoss, Party, StockEntry, Voucher } from '@/types'
import { buildCategoryTree, categoryPath, type CategoryTreeNode } from '@/lib/categoryHierarchy'
import { normalSide, resolveSystemAccountId, round2 } from '@/lib/engine'
import { bankAccounts, signedBankBalance } from '@/lib/banks'
import { adToBs, firstOfCurrentBsMonth, makeBsKey, todayBs } from '@/lib/nepaliDate'
import { legacySettlementAccountId } from '@/lib/banks'

export interface DaybookRow {
  voucher: Voucher
  date_bs: string
  date_bs_key: number
  voucher_type: Voucher['type']
  voucher_no: string
  particulars: string
  narration: string
  debit: number
  credit: number
  total: number
  cancelled: boolean
}

export interface LedgerRow {
  voucher: Voucher
  date_bs: string
  date_bs_key: number
  voucher_type: Voucher['type']
  voucher_no: string
  particulars: string
  narration: string
  debit: number
  credit: number
  running_balance: number
  cancelled: boolean
}

export interface LedgerReport {
  account: Account | null
  opening_balance: number
  rows: LedgerRow[]
  total_debit: number
  total_credit: number
  closing_balance: number
}

export type CashFlowActivity = 'operating' | 'investing' | 'financing'

export interface CashFlowRow {
  voucher: Voucher
  activity: CashFlowActivity
  account_id: string
  account_name: string
  cash_accounts: string
  amount: number
}

export interface CashFlowSection {
  activity: CashFlowActivity
  label: string
  rows: CashFlowRow[]
  inflow: number
  outflow: number
  net: number
}

export interface CashFlowReport {
  cash_accounts: Account[]
  opening_balance: number
  sections: CashFlowSection[]
  total_inflow: number
  total_outflow: number
  net_change: number
  closing_balance: number
}

export interface AccountReportGroup {
  key: string
  name: string
  type: AccountType
  accounts: Account[]
  balance: number
  debit: number
  credit: number
}

export interface AccountReportTreeNode {
  key: string
  name: string
  type: AccountType
  depth: number
  path: string
  directAccounts: Account[]
  children: AccountReportTreeNode[]
  balance: number
  debit: number
  credit: number
  totalCount: number
}

const DIRECT_INCOME_GROUPS = new Set(['sales accounts', 'direct income', 'direct incomes'])
const DIRECT_EXPENSE_GROUPS = new Set(['purchase accounts', 'direct expense', 'direct expenses', 'cost of sales', 'cost of goods sold'])

function accountCategoryNames(account: Account, categories: AccountCategory[]) {
  const byId = new Map(categories.map(category => [category.id, category]))
  const names = [account.group]
  const seen = new Set<string>()
  let current = account.category_id ? byId.get(account.category_id) : undefined
  while (current && !seen.has(current.id)) {
    names.push(current.name)
    seen.add(current.id)
    current = current.parent_category_id ? byId.get(current.parent_category_id) : undefined
  }
  return names.map(name => name.trim().toLocaleLowerCase()).filter(Boolean)
}

export function computeDetailedProfitLoss(
  companyId: string,
  accounts: Account[],
  categories: AccountCategory[],
  openingStock: StockEntry[],
  closingStock: StockEntry[],
): DetailedProfitLoss {
  const salesIds = new Set([
    resolveSystemAccountId(accounts, companyId, 'sales'),
    resolveSystemAccountId(accounts, companyId, 'sales_return'),
  ])
  const purchaseIds = new Set([
    resolveSystemAccountId(accounts, companyId, 'purchase'),
    resolveSystemAccountId(accounts, companyId, 'purchase_return'),
  ])
  const income = accounts.filter(account => account.type === 'Income' && Math.abs(account.balance || 0) >= 0.005)
  const expenses = accounts.filter(account => account.type === 'Expense' && Math.abs(account.balance || 0) >= 0.005)
  const directIncome = income.filter(account => salesIds.has(account.id) || accountCategoryNames(account, categories).some(name => DIRECT_INCOME_GROUPS.has(name)))
  const directExpenses = expenses.filter(account => purchaseIds.has(account.id) || accountCategoryNames(account, categories).some(name => DIRECT_EXPENSE_GROUPS.has(name)))
  const directIncomeIds = new Set(directIncome.map(account => account.id))
  const directExpenseIds = new Set(directExpenses.map(account => account.id))
  const indirectIncome = income.filter(account => !directIncomeIds.has(account.id))
  const indirectExpenses = expenses.filter(account => !directExpenseIds.has(account.id))
  const sumAccounts = (entries: Account[]) => round2(entries.reduce((sum, account) => sum + (account.balance || 0), 0))
  const openingStockValue = round2(openingStock.reduce((sum, entry) => sum + entry.value, 0))
  const closingStockValue = round2(closingStock.reduce((sum, entry) => sum + entry.value, 0))
  const directIncomeTotal = sumAccounts(directIncome)
  const directExpenseTotal = sumAccounts(directExpenses)
  const indirectIncomeTotal = sumAccounts(indirectIncome)
  const indirectExpenseTotal = sumAccounts(indirectExpenses)
  const grossProfit = round2(directIncomeTotal + closingStockValue - openingStockValue - directExpenseTotal)
  const netProfit = round2(grossProfit + indirectIncomeTotal - indirectExpenseTotal)
  const tradingTotal = round2(Math.max(openingStockValue + directExpenseTotal, directIncomeTotal + closingStockValue))
  const profitLossTotal = round2(Math.max(indirectExpenseTotal + Math.max(-grossProfit, 0), indirectIncomeTotal + Math.max(grossProfit, 0)))
  const statementTotal = round2(tradingTotal + profitLossTotal)
  return {
    directIncome, directExpenses, indirectIncome, indirectExpenses, openingStock, closingStock,
    openingStockValue, closingStockValue, grossProfit, netProfit,
    totalIncome: round2(directIncomeTotal + indirectIncomeTotal),
    totalExpense: round2(directExpenseTotal + indirectExpenseTotal),
    tradingTotal, profitLossTotal, debitTotal: statementTotal, creditTotal: statementTotal,
  }
}

export function buildAccountReportTree(accounts: Account[], categories: AccountCategory[]): AccountReportTreeNode[] {
  const activeCategories = categories.filter(category => !category.is_archived)
  const categorized = new Set(activeCategories.map(category => category.id))
  const convert = (node: CategoryTreeNode<AccountCategory, Account>): AccountReportTreeNode => {
    const children = node.children.map(convert).filter(child => child.totalCount > 0)
    const direct = groupReportAccounts(node.directRecords)
    return {
      key: node.category.id, name: node.category.name, type: node.category.account_type, depth: node.depth, path: node.path,
      directAccounts: node.directRecords.sort((a, b) => a.name.localeCompare(b.name)), children,
      balance: round2(direct.reduce((sum, group) => sum + group.balance, 0) + children.reduce((sum, child) => sum + child.balance, 0)),
      debit: round2(direct.reduce((sum, group) => sum + group.debit, 0) + children.reduce((sum, child) => sum + child.debit, 0)),
      credit: round2(direct.reduce((sum, group) => sum + group.credit, 0) + children.reduce((sum, child) => sum + child.credit, 0)),
      totalCount: node.directCount + children.reduce((sum, child) => sum + child.totalCount, 0),
    }
  }
  const roots = buildCategoryTree(activeCategories, accounts).map(convert).filter(node => node.totalCount > 0)
  const uncategorized = accounts.filter(account => !account.category_id || !categorized.has(account.category_id))
  for (const type of ['Asset','Liability','Equity','Income','Expense'] as AccountType[]) {
    const entries = uncategorized.filter(account => account.type === type)
    if (!entries.length) continue
    const [totals] = groupReportAccounts(entries.map(account => ({ ...account, group: `Uncategorized ${type}` })))
    roots.push({ key: `uncategorized:${type}`, name: `Uncategorized ${type}`, type, depth: 1, path: `Uncategorized ${type}`, directAccounts: entries, children: [], balance: totals.balance, debit: totals.debit, credit: totals.credit, totalCount: entries.length })
  }
  return roots.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
}

export function groupReportAccounts(accounts: Account[]): AccountReportGroup[] {
  const groups = new Map<string, AccountReportGroup>()
  for (const account of accounts) {
    const name = account.group?.trim() || 'Ungrouped'
    const key = `${account.type}:${account.category_id || name.toLocaleLowerCase()}`
    const group = groups.get(key) || { key, name, type: account.type, accounts: [], balance: 0, debit: 0, credit: 0 }
    const balance = round2(account.balance || 0)
    const side = normalSide(account.type)
    group.accounts.push(account)
    group.balance = round2(group.balance + balance)
    if ((side === 'debit' && balance > 0) || (side === 'credit' && balance < 0)) group.debit = round2(group.debit + Math.abs(balance))
    if ((side === 'credit' && balance > 0) || (side === 'debit' && balance < 0)) group.credit = round2(group.credit + Math.abs(balance))
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(group => ({ ...group, accounts: group.accounts.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
}

const voucherKey = (voucher: Voucher) => voucher.date_bs_key || makeBsKey(voucher.date_bs)

export function fiscalYearStartBs(company: Company | null) {
  const current = todayBs()
  const monthDay = company?.fiscal_year_start
    ? adToBs(company.fiscal_year_start).slice(5)
    : firstOfCurrentBsMonth().slice(5)
  const thisYear = `${current.slice(0, 4)}-${monthDay}`
  return makeBsKey(current) >= makeBsKey(thisYear)
    ? thisYear
    : `${Number(current.slice(0, 4)) - 1}-${monthDay}`
}

export function vouchersInFiscalYear(vouchers: Voucher[], fiscalStart: string) {
  const startKey = makeBsKey(fiscalStart)
  const nextStartKey = makeBsKey(`${Number(fiscalStart.slice(0, 4)) + 1}-${fiscalStart.slice(5)}`)
  return vouchers.filter(voucher => {
    const key = voucherKey(voucher)
    return key >= startKey && key < nextStartKey
  })
}

const sortVouchers = (left: Voucher, right: Voucher) =>
  voucherKey(left) - voucherKey(right) || left.seq - right.seq

function voucherNumber(voucher: Voucher) {
  return voucher.invoice_no || String(voucher.seq)
}

function accountDisplayName(accountId: string, accountMap: Map<string, Account>, partyMap: Map<string, Party>) {
  return partyMap.get(accountId)?.name || accountMap.get(accountId)?.name || accountId
}

function voucherParticulars(voucher: Voucher, accountMap: Map<string, Account>, partyMap: Map<string, Party>) {
  if (voucher.type === 'Receipt' || voucher.type === 'Payment') {
    const settlementId = legacySettlementAccountId(voucher)
    const names = [...new Set((voucher.lines || []).filter(line => line.account_id !== settlementId).map(line => accountDisplayName(line.account_id, accountMap, partyMap)))]
    if (names.length) return names.join(', ')
  }
  if (voucher.party_account_id) {
    return accountDisplayName(voucher.party_account_id, accountMap, partyMap)
  }
  const names = [...new Set((voucher.lines || []).map(line => accountDisplayName(line.account_id, accountMap, partyMap)))]
  return names.join(', ') || (voucher.is_cash ? 'Cash' : '-')
}

export function getDaybookRows(vouchers: Voucher[], accounts: Account[], parties: Party[]): DaybookRow[] {
  const accountMap = new Map(accounts.map(account => [account.id, account]))
  const partyMap = new Map(parties.map(party => [party.account_id, party]))

  return [...vouchers].sort(sortVouchers).map(voucher => ({
    voucher,
    date_bs: voucher.date_bs,
    date_bs_key: voucherKey(voucher),
    voucher_type: voucher.type,
    voucher_no: voucherNumber(voucher),
    particulars: voucherParticulars(voucher, accountMap, partyMap),
    narration: voucher.narration || '',
    debit: round2((voucher.lines || []).reduce((sum, line) => sum + (line.debit || 0), 0)),
    credit: round2((voucher.lines || []).reduce((sum, line) => sum + (line.credit || 0), 0)),
    total: round2(voucher.total || 0),
    cancelled: voucher.cancelled,
  }))
}

export function getLedgerRows(
  accountId: string,
  accounts: Account[],
  vouchers: Voucher[],
  fromDate: string,
  toDate: string,
  includeCancelled = false,
): LedgerReport {
  const account = accounts.find(item => item.id === accountId) || null
  if (!account) {
    return { account: null, opening_balance: 0, rows: [], total_debit: 0, total_credit: 0, closing_balance: 0 }
  }

  const fromKey = makeBsKey(fromDate)
  const toKey = makeBsKey(toDate)
  const accountMap = new Map(accounts.map(item => [item.id, item]))
  const side = normalSide(account.type)
  const movement = (debit: number, credit: number) => side === 'debit' ? debit - credit : credit - debit
  let openingBalance = account.opening_balance || 0

  for (const voucher of vouchers) {
    if (voucher.cancelled || voucherKey(voucher) >= fromKey) continue
    for (const line of voucher.lines || []) {
      if (line.account_id === accountId) openingBalance = round2(openingBalance + movement(line.debit || 0, line.credit || 0))
    }
  }

  let runningBalance = round2(openingBalance)
  const rows: LedgerRow[] = []
  for (const voucher of [...vouchers].sort(sortVouchers)) {
    const key = voucherKey(voucher)
    if (key < fromKey || key > toKey || (voucher.cancelled && !includeCancelled)) continue
    const lines = (voucher.lines || []).filter(line => line.account_id === accountId)
    if (!lines.length) continue

    const debit = round2(lines.reduce((sum, line) => sum + (line.debit || 0), 0))
    const credit = round2(lines.reduce((sum, line) => sum + (line.credit || 0), 0))
    if (!voucher.cancelled) runningBalance = round2(runningBalance + movement(debit, credit))
    const contraNames = [...new Set((voucher.lines || [])
      .filter(line => line.account_id !== accountId)
      .map(line => accountMap.get(line.account_id)?.name || line.account_id))]

    rows.push({
      voucher,
      date_bs: voucher.date_bs,
      date_bs_key: key,
      voucher_type: voucher.type,
      voucher_no: voucherNumber(voucher),
      particulars: contraNames.join(', ') || voucher.type,
      narration: voucher.narration || '',
      debit,
      credit,
      running_balance: runningBalance,
      cancelled: voucher.cancelled,
    })
  }

  return {
    account,
    opening_balance: round2(openingBalance),
    rows,
    total_debit: round2(rows.filter(row => !row.cancelled).reduce((sum, row) => sum + row.debit, 0)),
    total_credit: round2(rows.filter(row => !row.cancelled).reduce((sum, row) => sum + row.credit, 0)),
    closing_balance: round2(runningBalance),
  }
}

export function formatLedgerBalance(balance: number, account: Account | null) {
  if (!account || Math.abs(balance) < 0.005) return '0.00'
  const naturalSide = normalSide(account.type)
  const suffix = balance >= 0
    ? (naturalSide === 'debit' ? 'Dr' : 'Cr')
    : (naturalSide === 'debit' ? 'Cr' : 'Dr')
  return `${Math.abs(balance).toLocaleString('en-NP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${suffix}`
}

const CASH_FLOW_LABELS: Record<CashFlowActivity, string> = {
  operating: 'Operating Activities',
  investing: 'Investing Activities',
  financing: 'Financing Activities',
}

export function classifyCashFlowAccount(account: Account, categories: AccountCategory[]): CashFlowActivity {
  if (account.is_party || account.type === 'Income' || account.type === 'Expense') return 'operating'
  if (account.type === 'Equity') return 'financing'

  const classificationText = `${categoryPath(categories, account.category_id)} ${account.group} ${account.name}`.toLowerCase()
  if (account.type === 'Asset' && /fixed asset|property|plant|equipment|furniture|vehicle|land|building|investment/.test(classificationText)) {
    return 'investing'
  }
  if (account.type === 'Liability' && /loan|borrow|mortgage|finance/.test(classificationText)) {
    return 'financing'
  }
  return 'operating'
}

export function computeCashFlow(
  companyId: string,
  accounts: Account[],
  categories: AccountCategory[],
  vouchers: Voucher[],
  fromDate: string,
  toDate: string,
): CashFlowReport {
  const cashId = resolveSystemAccountId(accounts, companyId, 'cash')
  const defaultBankId = resolveSystemAccountId(accounts, companyId, 'bank')
  const cashAccountIds = new Set([
    cashId,
    defaultBankId,
    ...bankAccounts(accounts, categories, true).map(account => account.id),
  ])
  const cashAccounts = accounts.filter(account => cashAccountIds.has(account.id))
  const accountMap = new Map(accounts.map(account => [account.id, account]))
  const fromKey = makeBsKey(fromDate)
  const toKey = makeBsKey(toDate)
  let openingBalance = round2(cashAccounts.reduce((sum, account) => sum + (account.id === cashId ? (account.opening_balance || 0) : signedBankBalance(account, account.opening_balance || 0)), 0))
  const rows: CashFlowRow[] = []

  for (const voucher of [...vouchers].sort(sortVouchers)) {
    if (voucher.cancelled) continue
    const key = voucherKey(voucher)
    const cashLines = (voucher.lines || []).filter(line => cashAccountIds.has(line.account_id))
    const cashMovement = round2(cashLines.reduce((sum, line) => sum + (line.debit || 0) - (line.credit || 0), 0))
    if (key < fromKey) {
      openingBalance = round2(openingBalance + cashMovement)
      continue
    }
    if (key > toKey || Math.abs(cashMovement) < 0.005) continue

    const candidates = (voucher.lines || []).flatMap(line => {
      if (cashAccountIds.has(line.account_id)) return []
      const account = accountMap.get(line.account_id)
      const amount = cashMovement > 0 ? (line.credit || 0) : (line.debit || 0)
      return account && amount > 0 ? [{ account, amount }] : []
    })
    const candidateTotal = candidates.reduce((sum, candidate) => sum + candidate.amount, 0)
    if (candidateTotal <= 0) continue

    const signedTotal = cashMovement
    let allocated = 0
    candidates.forEach((candidate, index) => {
      const amount = index === candidates.length - 1
        ? round2(signedTotal - allocated)
        : round2(signedTotal * candidate.amount / candidateTotal)
      allocated = round2(allocated + amount)
      rows.push({
        voucher,
        activity: classifyCashFlowAccount(candidate.account, categories),
        account_id: candidate.account.id,
        account_name: candidate.account.name,
        cash_accounts: [...new Set(cashLines.map(line => accountMap.get(line.account_id)?.name || line.account_id))].join(', '),
        amount,
      })
    })
  }

  const sections = (['operating', 'investing', 'financing'] as CashFlowActivity[]).map(activity => {
    const sectionRows = rows.filter(row => row.activity === activity)
    const inflow = round2(sectionRows.reduce((sum, row) => sum + Math.max(row.amount, 0), 0))
    const outflow = round2(sectionRows.reduce((sum, row) => sum + Math.max(-row.amount, 0), 0))
    return { activity, label: CASH_FLOW_LABELS[activity], rows: sectionRows, inflow, outflow, net: round2(inflow - outflow) }
  })
  const totalInflow = round2(sections.reduce((sum, section) => sum + section.inflow, 0))
  const totalOutflow = round2(sections.reduce((sum, section) => sum + section.outflow, 0))
  const netChange = round2(totalInflow - totalOutflow)

  return {
    cash_accounts: cashAccounts,
    opening_balance: openingBalance,
    sections,
    total_inflow: totalInflow,
    total_outflow: totalOutflow,
    net_change: netChange,
    closing_balance: round2(openingBalance + netChange),
  }
}
