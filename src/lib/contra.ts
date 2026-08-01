import type { Account, AccountCategory, Voucher, VoucherLine } from '@/types'
import { bankAccounts } from '@/lib/banks'
import { resolveSystemAccountId, round2 } from '@/lib/engine'

export interface ContraSaveParams {
  source_account_id: string
  destination_account_id: string
  amount: number
  charge_amount: number
  narration?: string
  date_bs: string
  invoice_no?: string
}

export function resolveBankChargesAccountId(accounts: Account[], companyId: string) {
  const deterministicId = resolveSystemAccountId(accounts, companyId, 'bank_charges')
  if (accounts.some(account => account.id === deterministicId)) return deterministicId
  return accounts.find(account => account.company_id === companyId && account.type === 'Expense' && account.name.trim().toLowerCase() === 'bank charges')?.id || deterministicId
}

export function contraMoneyAccounts(accounts: Account[], categories: AccountCategory[], companyId: string, includeArchived = false) {
  const eligible = includeArchived ? accounts : accounts.filter(account => !account.is_archived)
  const cashId = resolveSystemAccountId(eligible, companyId, 'cash')
  const cashCategoryIds = new Set(categories.filter(category => category.name === 'Cash-in-Hand' && category.account_type === 'Asset').map(category => category.id))
  const ids = new Set([
    cashId,
    ...eligible.filter(account => cashCategoryIds.has(account.category_id || '')).map(account => account.id),
    ...bankAccounts(eligible, categories, includeArchived).map(account => account.id),
  ])
  return eligible.filter(account => account.company_id === companyId && ids.has(account.id))
}

export function buildContraLines(params: Pick<ContraSaveParams, 'source_account_id' | 'destination_account_id' | 'amount' | 'charge_amount'>, accounts: Account[], categories: AccountCategory[], companyId: string, bankChargesAccountId: string) {
  const moneyIds = new Set(contraMoneyAccounts(accounts, categories, companyId).map(account => account.id))
  if (!moneyIds.has(params.source_account_id)) throw new Error('Select an active Cash or Bank ledger to transfer from.')
  if (!moneyIds.has(params.destination_account_id)) throw new Error('Select an active Cash or Bank ledger to transfer to.')
  if (params.source_account_id === params.destination_account_id) throw new Error('Transfer From and Transfer To must be different ledgers.')
  const amount = round2(Number(params.amount))
  const charge = round2(Number(params.charge_amount || 0))
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive transfer amount.')
  if (!Number.isFinite(charge) || charge < 0) throw new Error('Bank charge cannot be negative.')
  const lines: Omit<VoucherLine, 'id' | 'voucher_id'>[] = [
    { account_id: params.destination_account_id, debit: amount, credit: 0 },
  ]
  if (charge > 0) {
    const chargeAccount = accounts.find(account => account.id === bankChargesAccountId && !account.is_archived && account.type === 'Expense')
    if (!chargeAccount) throw new Error('The protected Bank Charges ledger is unavailable. Reload company data and try again.')
    lines.push({ account_id: chargeAccount.id, debit: charge, credit: 0 })
  }
  lines.push({ account_id: params.source_account_id, debit: 0, credit: round2(amount + charge) })
  return lines
}

export function voucherIsContra(voucher: Pick<Voucher, 'contra_entry' | 'draft_payload' | 'settlement_account_id' | 'contra_destination_account_id'>) {
  if (voucher.contra_entry) return true
  if (voucher.draft_payload?.journalEntryType === 'Contra') return true
  return false
}
