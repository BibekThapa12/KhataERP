import type { Account, AccountCategory, AccountType, Company, Party, Voucher } from '@/types'
import { buildCategoryTree, type CategoryTreeNode } from '@/lib/categoryHierarchy'
import { normalSide, round2 } from '@/lib/engine'
import { adToBs, firstOfCurrentBsMonth, makeBsKey, todayBs } from '@/lib/nepaliDate'

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

const sortVouchers = (left: Voucher, right: Voucher) =>
  voucherKey(left) - voucherKey(right) || left.seq - right.seq

function voucherNumber(voucher: Voucher) {
  return voucher.invoice_no || String(voucher.seq)
}

function accountDisplayName(accountId: string, accountMap: Map<string, Account>, partyMap: Map<string, Party>) {
  return partyMap.get(accountId)?.name || accountMap.get(accountId)?.name || accountId
}

function voucherParticulars(voucher: Voucher, accountMap: Map<string, Account>, partyMap: Map<string, Party>) {
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
