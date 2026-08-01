import type { Account, AccountCategory, Party, SimpleEntryType, VoucherLine } from '@/types'
import { resolveSystemAccountId, round2 } from '@/lib/engine'
import { bankAccounts } from '@/lib/banks'

export interface SimpleEntryLineInput {
  category_id: string
  account_id: string
  amount: number
}

export interface SimpleEntrySaveParams {
  entry_type: SimpleEntryType
  counter_account_id: string
  lines: SimpleEntryLineInput[]
  narration?: string
  date_bs: string
  invoice_no?: string
}

export function voucherSimpleEntryType(voucher: { simple_entry_type?: string | null; draft_payload?: Record<string, unknown> | null; settlement_account_id?: string | null; lines?: Array<{ account_id: string; debit: number; credit: number }> }, accounts: Account[] = []): SimpleEntryType | null {
  if (voucher.simple_entry_type === 'Income' || voucher.simple_entry_type === 'Expense') return voucher.simple_entry_type
  const payloadType = voucher.draft_payload?.simpleEntryType
  if (payloadType === 'Income' || payloadType === 'Expense') return payloadType
  if (!voucher.settlement_account_id || !accounts.length) return null
  const counterLines = (voucher.lines || []).filter(line => line.account_id === voucher.settlement_account_id)
  const detailLines = (voucher.lines || []).filter(line => line.account_id !== voucher.settlement_account_id)
  if (counterLines.length !== 1 || !detailLines.length) return null
  const counter = counterLines[0]
  const accountById = new Map(accounts.map(account => [account.id, account]))
  if (counter.debit > 0 && counter.credit === 0 && detailLines.every(line => accountById.get(line.account_id)?.type === 'Income' && line.credit > 0 && line.debit === 0)) return 'Income'
  if (counter.credit > 0 && counter.debit === 0 && detailLines.every(line => accountById.get(line.account_id)?.type === 'Expense' && line.debit > 0 && line.credit === 0)) return 'Expense'
  return null
}

export function simpleEntryCounterAccounts(accounts: Account[], categories: AccountCategory[], parties: Party[], companyId: string) {
  const active = accounts.filter(account => !account.is_archived)
  const cashId = resolveSystemAccountId(active, companyId, 'cash')
  const cashCategoryIds = new Set(categories.filter(category => !category.is_archived && category.account_type === 'Asset' && category.name === 'Cash-in-Hand').map(category => category.id))
  const cashAccounts = active.filter(account => cashCategoryIds.has(account.category_id || ''))
  const moneyIds = new Set([cashId, ...cashAccounts.map(account => account.id), ...bankAccounts(active, categories).map(account => account.id)].filter(Boolean))
  const partyByAccount = new Map(parties.filter(party => !party.is_archived).map(party => [party.account_id, party]))
  return {
    cashAndBanks: active.filter(account => moneyIds.has(account.id)),
    partyAccounts: active.filter(account => !moneyIds.has(account.id) && partyByAccount.has(account.id)),
    partyByAccount,
  }
}

export function assertSimpleEntryCounterAccount(accountId: string, accounts: Account[], categories: AccountCategory[], parties: Party[], companyId: string) {
  const choices = simpleEntryCounterAccounts(accounts, categories, parties, companyId)
  if (![...choices.cashAndBanks, ...choices.partyAccounts].some(account => account.id === accountId)) throw new Error('Select an active Cash, Bank, Customer, or Supplier ledger.')
}

export function buildSimpleEntryLines(
  params: Pick<SimpleEntrySaveParams, 'entry_type' | 'counter_account_id' | 'lines'>,
  accounts: Account[],
  categories: AccountCategory[],
): Omit<VoucherLine, 'id' | 'voucher_id'>[] {
  const counter = accounts.find(account => account.id === params.counter_account_id && !account.is_archived)
  if (!counter) throw new Error(`Select an active account to ${params.entry_type === 'Income' ? 'receive into' : 'pay from'}.`)
  if (!params.lines.length) throw new Error(`Add at least one ${params.entry_type.toLowerCase()} line.`)

  const detailLines = params.lines.map((line, index) => {
    const amount = round2(Number(line.amount))
    if (!line.category_id) throw new Error(`Select a category for line ${index + 1}.`)
    if (!line.account_id) throw new Error(`Select a ledger for line ${index + 1}.`)
    if (line.account_id === counter.id) throw new Error('The receiving or paying account cannot also be an income or expense ledger.')
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Enter a positive amount for line ${index + 1}.`)
    const category = categories.find(item => item.id === line.category_id && !item.is_archived)
    const account = accounts.find(item => item.id === line.account_id && !item.is_archived)
    if (!category || category.account_type !== params.entry_type) throw new Error(`Line ${index + 1} must use an active ${params.entry_type.toLowerCase()} category.`)
    if (!account || account.type !== params.entry_type || account.category_id !== category.id) throw new Error(`Line ${index + 1} ledger does not belong to the selected category.`)
    return params.entry_type === 'Income'
      ? { account_id: account.id, debit: 0, credit: amount }
      : { account_id: account.id, debit: amount, credit: 0 }
  })
  const total = round2(detailLines.reduce((sum, line) => sum + line.debit + line.credit, 0))
  const counterLine = params.entry_type === 'Income'
    ? { account_id: counter.id, debit: total, credit: 0 }
    : { account_id: counter.id, debit: 0, credit: total }
  return [counterLine, ...detailLines]
}

export function simpleEntryDraftLines(entryType: SimpleEntryType, lines: VoucherLine[], counterAccountId?: string | null): SimpleEntryLineInput[] {
  return lines
    .filter(line => line.account_id !== counterAccountId && (entryType === 'Income' ? line.credit > 0 : line.debit > 0))
    .map(line => ({ category_id: '', account_id: line.account_id, amount: entryType === 'Income' ? line.credit : line.debit }))
}
