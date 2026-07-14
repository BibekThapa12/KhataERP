import type { Account, AccountCategory, Party, Voucher } from '@/types'
import { bankAccounts } from '@/lib/banks'
import { categoryDescendantIds } from '@/lib/categoryHierarchy'
import { normalSide, resolveSystemAccountId, round2 } from '@/lib/engine'
import { addDaysToBs, bsToAd, makeBsKey } from '@/lib/nepaliDate'
import { getLedgerRows, type LedgerRow } from '@/lib/reports'

const keyOf = (voucher: Voucher) => voucher.date_bs_key || makeBsKey(voucher.date_bs)
const activeThrough = (vouchers: Voucher[], asOf: string) => vouchers.filter(voucher => !voucher.cancelled && keyOf(voucher) <= makeBsKey(asOf))
const sortChronologically = (a: Voucher, b: Voucher) => keyOf(a) - keyOf(b) || a.seq - b.seq

export type ReportTarget = { mode: 'ledger'; accountId: string } | { mode: 'group'; categoryId: string }

export interface GroupSummaryRow {
  account: Account
  opening: number
  debit: number
  credit: number
  closing: number
}

export interface GroupTransactionRow extends LedgerRow {
  account: Account
  group_running_balance: number
}

export function categoryAccountIds(categoryId: string, categories: AccountCategory[], accounts: Account[]) {
  const ids = categoryDescendantIds(categories, categoryId)
  ids.add(categoryId)
  return new Set(accounts.filter(account => account.category_id && ids.has(account.category_id)).map(account => account.id))
}

export function getGroupReport(categoryId: string, categories: AccountCategory[], accounts: Account[], vouchers: Voucher[], from: string, to: string, includeCancelled = false) {
  const category = categories.find(entry => entry.id === categoryId) || null
  const ids = categoryAccountIds(categoryId, categories, accounts)
  const summary: GroupSummaryRow[] = accounts.filter(account => ids.has(account.id)).map(account => {
    const report = getLedgerRows(account.id, accounts, vouchers, from, to, includeCancelled)
    return { account, opening: report.opening_balance, debit: report.total_debit, credit: report.total_credit, closing: report.closing_balance }
  }).sort((a, b) => a.account.name.localeCompare(b.account.name))
  const side = category ? normalSide(category.account_type) : 'debit'
  const movement = (debit: number, credit: number) => side === 'debit' ? debit - credit : credit - debit
  const opening = round2(summary.reduce((sum, row) => sum + row.opening, 0))
  let running = opening
  const transactions: GroupTransactionRow[] = summary.flatMap(row => getLedgerRows(row.account.id, accounts, vouchers, from, to, includeCancelled).rows.map(entry => ({ ...entry, account: row.account, group_running_balance: 0 })))
    .sort((a, b) => a.date_bs_key - b.date_bs_key || a.voucher.seq - b.voucher.seq || a.account.name.localeCompare(b.account.name))
    .map(row => {
      if (!row.cancelled) running = round2(running + movement(row.debit, row.credit))
      return { ...row, group_running_balance: running }
    })
  return {
    category,
    summary,
    transactions,
    opening,
    total_debit: round2(summary.reduce((sum, row) => sum + row.debit, 0)),
    total_credit: round2(summary.reduce((sum, row) => sum + row.credit, 0)),
    closing: round2(running),
  }
}

export type OutstandingKind = 'receivable' | 'payable'
export type AgingBucket = 'Not Due' | '1-30' | '31-60' | '61-90' | '90+'
export const agingBuckets: AgingBucket[] = ['Not Due', '1-30', '31-60', '61-90', '90+']
export type DueDateSource = 'due-date' | 'invoice-date' | 'invalid'
export type OutstandingStatus = 'Not Due' | 'Due Today' | 'Overdue'

export interface OutstandingDocument {
  voucher: Voucher
  party: Party
  original_amount: number
  returns: number
  settled: number
  outstanding: number
  due_date_bs: string
  age_days: number
  bucket: AgingBucket
  due_date_source: DueDateSource
  status: OutstandingStatus
  return_vouchers: Voucher[]
}

export interface UnappliedSettlementRow {
  voucher: Voucher
  party: Party
  amount: number
}

export interface OutstandingAdjustmentRow {
  id: string
  party: Party
  kind: 'opening' | 'journal' | 'other'
  label: string
  amount: number
  voucher?: Voucher
}

export interface PartyOutstandingSummary {
  party: Party
  outstanding: number
  unapplied: number
  unallocated_adjustment: number
  ledger_balance: number
  document_count: number
  buckets: Record<AgingBucket, number>
  documents: OutstandingDocument[]
  unapplied_rows: UnappliedSettlementRow[]
  adjustment_rows: OutstandingAdjustmentRow[]
}

function parseBsTime(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  try {
    const [year, month, day] = bsToAd(value).split('-').map(Number)
    const time = Date.UTC(year, month - 1, day)
    return Number.isFinite(time) ? time : null
  } catch {
    return null
  }
}

function resolveDocumentAge(voucher: Voucher, asOf: string) {
  const asOfTime = parseBsTime(asOf)
  const invoiceTime = parseBsTime(voucher.date_bs)
  let effectiveDueDate = voucher.due_date_bs
  if (invoiceTime !== null && Number.isInteger(voucher.credit_days) && (voucher.credit_days ?? -1) >= 0) {
    try {
      effectiveDueDate = addDaysToBs(voucher.date_bs, voucher.credit_days!)
    } catch {
      effectiveDueDate = voucher.due_date_bs
    }
  }
  const dueTime = parseBsTime(effectiveDueDate)
  const dueDateSource: DueDateSource = dueTime !== null ? 'due-date' : invoiceTime !== null ? 'invoice-date' : 'invalid'
  const effectiveTime = dueTime ?? invoiceTime
  const age = effectiveTime !== null && asOfTime !== null ? Math.floor((asOfTime - effectiveTime) / 86400000) : 0
  return {
    dueDateBs: dueTime !== null ? effectiveDueDate! : voucher.date_bs,
    dueDateSource,
    age,
  }
}

function agingBucket(age: number): AgingBucket {
  if (age <= 0) return 'Not Due'
  if (age <= 30) return '1-30'
  if (age <= 60) return '31-60'
  if (age <= 90) return '61-90'
  return '90+'
}

function outstandingStatus(age: number): OutstandingStatus {
  if (age < 0) return 'Not Due'
  if (age === 0) return 'Due Today'
  return 'Overdue'
}

const emptyBuckets = () => Object.fromEntries(agingBuckets.map(bucket => [bucket, 0])) as Record<AgingBucket, number>

function partyMovementAmount(voucher: Voucher, partyId: string, kind: OutstandingKind) {
  return round2((voucher.lines || []).filter(line => line.account_id === partyId).reduce((sum, line) => sum + (kind === 'receivable' ? line.credit : line.debit), 0))
}

function accountBalanceAsOf(account: Account, vouchers: Voucher[], asOf: string) {
  const side = normalSide(account.type)
  return round2(activeThrough(vouchers, asOf).reduce((balance, voucher) => {
    const lineMovement = (voucher.lines || []).filter(line => line.account_id === account.id).reduce((sum, line) => sum + (side === 'debit' ? line.debit - line.credit : line.credit - line.debit), 0)
    return balance + lineMovement
  }, account.opening_balance || 0))
}

export function getOutstandingReport(kind: OutstandingKind, parties: Party[], accounts: Account[], vouchers: Voucher[], asOf: string) {
  const partyType = kind === 'receivable' ? 'customer' : 'supplier'
  const invoiceType = kind === 'receivable' ? 'Sales' : 'Purchase'
  const returnType = kind === 'receivable' ? 'Sales Return' : 'Purchase Return'
  const settlementType = kind === 'receivable' ? 'Receipt' : 'Payment'
  const active = activeThrough(vouchers, asOf)
  const relevantParties = parties.filter(party => party.type === partyType)
  const partyMap = new Map(relevantParties.map(party => [party.account_id, party]))
  const returnsByInvoice = new Map<string, number>()
  const returnVouchersByInvoice = new Map<string, Voucher[]>()
  for (const voucher of active.filter(entry => entry.type === returnType && entry.settlement_mode === 'party' && entry.original_voucher_id)) {
    returnsByInvoice.set(voucher.original_voucher_id!, round2((returnsByInvoice.get(voucher.original_voucher_id!) || 0) + voucher.total))
    returnVouchersByInvoice.set(voucher.original_voucher_id!, [...(returnVouchersByInvoice.get(voucher.original_voucher_id!) || []), voucher])
  }

  const documents: OutstandingDocument[] = active.filter(voucher => voucher.type === invoiceType && !voucher.is_cash && voucher.party_account_id && partyMap.has(voucher.party_account_id)).map(voucher => {
    const returns = Math.min(voucher.total, returnsByInvoice.get(voucher.id) || 0)
    const resolvedDate = resolveDocumentAge(voucher, asOf)
    return {
      voucher,
      party: partyMap.get(voucher.party_account_id!)!,
      original_amount: voucher.total,
      returns,
      settled: 0,
      outstanding: round2(voucher.total - returns),
      due_date_bs: resolvedDate.dueDateBs,
      age_days: resolvedDate.age,
      bucket: agingBucket(resolvedDate.age),
      due_date_source: resolvedDate.dueDateSource,
      status: resolvedDate.dueDateSource === 'invalid' ? 'Not Due' : outstandingStatus(resolvedDate.age),
      return_vouchers: returnVouchersByInvoice.get(voucher.id) || [],
    }
  })
  const docsById = new Map(documents.map(document => [document.voucher.id, document]))
  const unapplied = new Map<string, number>()
  const unappliedRows: UnappliedSettlementRow[] = []

  const allocate = (partyId: string, amount: number, settlementVoucher: Voucher, preferred?: { invoiceId: string; amount: number }[]) => {
    let remaining = round2(amount)
    if (preferred?.length) {
      for (const allocation of preferred) {
        const document = docsById.get(allocation.invoiceId)
        if (!document || document.party.account_id !== partyId) continue
        const applied = Math.min(document.outstanding, allocation.amount, remaining)
        document.settled = round2(document.settled + applied)
        document.outstanding = round2(document.outstanding - applied)
        remaining = round2(remaining - applied)
      }
    } else {
      const fifo = documents.filter(document => document.party.account_id === partyId && document.outstanding > 0).sort((a, b) => makeBsKey(a.due_date_bs) - makeBsKey(b.due_date_bs) || sortChronologically(a.voucher, b.voucher))
      for (const document of fifo) {
        if (remaining <= 0) break
        const applied = Math.min(document.outstanding, remaining)
        document.settled = round2(document.settled + applied)
        document.outstanding = round2(document.outstanding - applied)
        remaining = round2(remaining - applied)
      }
    }
    if (remaining > 0) {
      unapplied.set(partyId, round2((unapplied.get(partyId) || 0) + remaining))
      const party = partyMap.get(partyId)
      if (party) unappliedRows.push({ voucher: settlementVoucher, party, amount: remaining })
    }
  }

  for (const voucher of active.filter(entry => entry.type === settlementType).sort(sortChronologically)) {
    for (const party of relevantParties) {
      const amount = partyMovementAmount(voucher, party.account_id, kind)
      if (!amount) continue
      const stored = (voucher.settlements || []).filter(row => row.party_account_id === party.account_id)
      allocate(party.account_id, amount, voucher, stored.length ? stored.map(row => ({ invoiceId: row.invoice_voucher_id, amount: row.amount })) : undefined)
    }
  }

  const summaries: PartyOutstandingSummary[] = relevantParties.map(party => {
    const partyDocuments = documents.filter(document => document.party.id === party.id && document.outstanding > 0)
    const outstanding = round2(partyDocuments.reduce((sum, document) => sum + document.outstanding, 0))
    const unappliedAmount = unapplied.get(party.account_id) || 0
    const account = accounts.find(entry => entry.id === party.account_id)
    const ledgerBalance = account ? accountBalanceAsOf(account, vouchers, asOf) : 0
    const unallocatedAdjustment = round2(ledgerBalance - (outstanding - unappliedAmount))
    const adjustmentRows: OutstandingAdjustmentRow[] = []
    if (account?.opening_balance) adjustmentRows.push({ id: `opening-${party.id}`, party, kind: 'opening', label: 'Opening balance', amount: round2(account.opening_balance) })
    for (const voucher of active.filter(entry => entry.type === 'Journal')) {
      const side = account ? normalSide(account.type) : kind === 'receivable' ? 'debit' : 'credit'
      const amount = round2((voucher.lines || []).filter(line => line.account_id === party.account_id).reduce((sum, line) => sum + (side === 'debit' ? line.debit - line.credit : line.credit - line.debit), 0))
      if (amount) adjustmentRows.push({ id: `journal-${voucher.id}-${party.id}`, party, kind: 'journal', label: voucher.narration || 'Journal adjustment', amount, voucher })
    }
    const explainedAdjustment = round2(adjustmentRows.reduce((sum, row) => sum + row.amount, 0))
    const residual = round2(unallocatedAdjustment - explainedAdjustment)
    if (residual) adjustmentRows.push({ id: `other-${party.id}`, party, kind: 'other', label: 'Other unallocated party movement', amount: residual })
    const partyBuckets = emptyBuckets()
    for (const document of partyDocuments) partyBuckets[document.bucket] = round2(partyBuckets[document.bucket] + document.outstanding)
    return {
      party,
      outstanding,
      unapplied: unappliedAmount,
      unallocated_adjustment: unallocatedAdjustment,
      ledger_balance: ledgerBalance,
      document_count: partyDocuments.length,
      buckets: partyBuckets,
      documents: partyDocuments,
      unapplied_rows: unappliedRows.filter(row => row.party.id === party.id),
      adjustment_rows: adjustmentRows,
    }
  }).filter(row => row.outstanding || row.unapplied || row.unallocated_adjustment || row.ledger_balance)
  const buckets = Object.fromEntries(agingBuckets.map(bucket => [bucket, round2(documents.filter(document => document.bucket === bucket).reduce((sum, document) => sum + document.outstanding, 0))])) as Record<AgingBucket, number>
  const totalOutstanding = round2(documents.reduce((sum, document) => sum + document.outstanding, 0))
  const totalUnapplied = round2([...unapplied.values()].reduce((sum, amount) => sum + amount, 0))
  const totalAdjustments = round2(summaries.reduce((sum, row) => sum + row.unallocated_adjustment, 0))
  const netLedgerBalance = round2(summaries.reduce((sum, row) => sum + row.ledger_balance, 0))
  const totalOverdue = round2(agingBuckets.slice(1).reduce((sum, bucket) => sum + buckets[bucket], 0))
  return {
    kind,
    documents: documents.filter(document => document.outstanding > 0),
    summaries,
    unapplied_rows: unappliedRows,
    adjustment_rows: summaries.flatMap(row => row.adjustment_rows),
    buckets,
    total_outstanding: totalOutstanding,
    total_unapplied: totalUnapplied,
    total_adjustments: totalAdjustments,
    net_ledger_balance: netLedgerBalance,
    total_overdue: totalOverdue,
  }
}

export function suggestSettlementAllocations(kind: OutstandingKind, partyAccountId: string, amount: number, parties: Party[], accounts: Account[], vouchers: Voucher[], asOf: string, excludeSettlementVoucherId?: string) {
  const report = getOutstandingReport(kind, parties, accounts, vouchers.filter(voucher => voucher.id !== excludeSettlementVoucherId), asOf)
  let remaining = round2(Math.max(0, amount))
  return report.documents.filter(document => document.party.account_id === partyAccountId).sort((a, b) => makeBsKey(a.due_date_bs) - makeBsKey(b.due_date_bs) || sortChronologically(a.voucher, b.voucher)).flatMap(document => {
    if (remaining <= 0) return []
    const applied = round2(Math.min(remaining, document.outstanding))
    remaining = round2(remaining - applied)
    return applied > 0 ? [{ invoice_voucher_id: document.voucher.id, amount: applied }] : []
  })
}

export interface RegisterRow {
  voucher: Voucher
  party: string
  subtotal: number
  discount: number
  taxable: number
  vat: number
  returns: number
  gross: number
  net: number
}

export function getRegister(kind: 'sales' | 'purchase', vouchers: Voucher[], parties: Party[], from: string, to: string, includeCancelled = false) {
  const type = kind === 'sales' ? 'Sales' : 'Purchase'
  const returnType = kind === 'sales' ? 'Sales Return' : 'Purchase Return'
  const fromKey = makeBsKey(from), toKey = makeBsKey(to)
  const partyMap = new Map(parties.map(party => [party.account_id, party.name]))
  const period = vouchers.filter(voucher => keyOf(voucher) >= fromKey && keyOf(voucher) <= toKey && (includeCancelled || !voucher.cancelled))
  const invoiceById = new Map(vouchers.filter(voucher => voucher.type === type).map(voucher => [voucher.id, voucher]))
  const rows: RegisterRow[] = period.filter(voucher => voucher.type === type || voucher.type === returnType).map(voucher => {
    const isReturn = voucher.type === returnType
    const source = voucher.original_voucher_id ? invoiceById.get(voucher.original_voucher_id) : undefined
    const partyAccountId = voucher.party_account_id || source?.party_account_id
    const sign = isReturn ? -1 : 1
    const subtotal = voucher.subtotal || 0
    const discount = voucher.discount || 0
    return {
      voucher,
      party: partyAccountId ? partyMap.get(partyAccountId) || 'Party' : 'Cash',
      subtotal: round2(sign * subtotal),
      discount: round2(sign * discount),
      taxable: round2(sign * (subtotal - discount)),
      vat: round2(sign * (voucher.vat_amount || 0)),
      returns: isReturn ? voucher.total : 0,
      gross: round2(sign * voucher.total),
      net: round2(sign * voucher.total),
    }
  }).sort((a, b) => sortChronologically(a.voucher, b.voucher))
  const activeRows = rows.filter(row => !row.voucher.cancelled)
  return { rows, subtotal: round2(activeRows.reduce((sum, row) => sum + row.subtotal, 0)), discount: round2(activeRows.reduce((sum, row) => sum + row.discount, 0)), taxable: round2(activeRows.reduce((sum, row) => sum + row.taxable, 0)), vat: round2(activeRows.reduce((sum, row) => sum + row.vat, 0)), returns: round2(activeRows.reduce((sum, row) => sum + row.returns, 0)), gross: round2(activeRows.reduce((sum, row) => sum + row.gross, 0)), net: round2(activeRows.reduce((sum, row) => sum + row.net, 0)) }
}

export type TransactionRegisterKind = 'receipt' | 'payment' | 'journal'

export interface TransactionRegisterRow {
  voucher: Voucher
  particulars: string
  debit: number
  credit: number
  amount: number
}

export function getTransactionRegister(kind: TransactionRegisterKind, vouchers: Voucher[], accounts: Account[], parties: Party[], from: string, to: string, includeCancelled = false) {
  const type = kind === 'receipt' ? 'Receipt' : kind === 'payment' ? 'Payment' : 'Journal'
  const fromKey = makeBsKey(from), toKey = makeBsKey(to)
  const accountNames = new Map(accounts.map(account => [account.id, account.name]))
  const partyNames = new Map(parties.map(party => [party.account_id, party.name]))
  const nameOf = (accountId: string) => partyNames.get(accountId) || accountNames.get(accountId) || accountId
  const rows: TransactionRegisterRow[] = vouchers.filter(voucher => (
    voucher.type === type && keyOf(voucher) >= fromKey && keyOf(voucher) <= toKey && (includeCancelled || !voucher.cancelled)
  )).sort(sortChronologically).map(voucher => {
    const lines = voucher.lines || []
    const detailLines = kind === 'receipt'
      ? lines.filter(line => line.credit > 0)
      : kind === 'payment'
        ? lines.filter(line => line.debit > 0)
        : lines
    const particulars = [...new Set(detailLines.map(line => nameOf(line.account_id)))].join(', ') || '-'
    const debit = round2(lines.reduce((sum, line) => sum + line.debit, 0))
    const credit = round2(lines.reduce((sum, line) => sum + line.credit, 0))
    return { voucher, particulars, debit, credit, amount: voucher.total || Math.max(debit, credit) }
  })
  const activeRows = rows.filter(row => !row.voucher.cancelled)
  return {
    rows,
    total_debit: round2(activeRows.reduce((sum, row) => sum + row.debit, 0)),
    total_credit: round2(activeRows.reduce((sum, row) => sum + row.credit, 0)),
    total_amount: round2(activeRows.reduce((sum, row) => sum + row.amount, 0)),
  }
}

export function getCashBankBook(companyId: string, selectedAccountId: string | null, accounts: Account[], categories: AccountCategory[], vouchers: Voucher[], from: string, to: string, includeCancelled = false) {
  const cashId = resolveSystemAccountId(accounts, companyId, 'cash')
  const moneyAccounts = accounts.filter(account => account.id === cashId || bankAccounts(accounts, categories, true).some(bank => bank.id === account.id))
  const selected = selectedAccountId ? moneyAccounts.filter(account => account.id === selectedAccountId) : moneyAccounts
  const selectedIds = new Set(selected.map(account => account.id))
  const fromKey = makeBsKey(from), toKey = makeBsKey(to)
  const opening = round2(selected.reduce((sum, account) => sum + getLedgerRows(account.id, accounts, vouchers, from, to, false).opening_balance, 0))
  let running = opening
  const rows = [...vouchers].sort(sortChronologically).flatMap(voucher => {
    const key = keyOf(voucher)
    if (key < fromKey || key > toKey || (voucher.cancelled && !includeCancelled)) return []
    const lines = (voucher.lines || []).filter(line => selectedIds.has(line.account_id))
    if (!lines.length) return []
    const receipts = round2(lines.reduce((sum, line) => sum + line.debit, 0))
    const payments = round2(lines.reduce((sum, line) => sum + line.credit, 0))
    if (!voucher.cancelled) running = round2(running + receipts - payments)
    const isTransfer = (voucher.lines || []).filter(line => moneyAccounts.some(account => account.id === line.account_id)).length >= 2
    return [{ voucher, account_names: [...new Set(lines.map(line => accounts.find(account => account.id === line.account_id)?.name || line.account_id))].join(', '), activity: isTransfer ? 'Transfer' : receipts ? 'Receipt' : 'Payment', receipts, payments, running_balance: running }]
  })
  return { accounts: selected, opening, rows, total_receipts: round2(rows.filter(row => !row.voucher.cancelled).reduce((sum, row) => sum + row.receipts, 0)), total_payments: round2(rows.filter(row => !row.voucher.cancelled).reduce((sum, row) => sum + row.payments, 0)), closing: running }
}
