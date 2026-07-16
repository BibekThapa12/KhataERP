import type { Account, AccountCategory, Voucher } from '@/types'

export function bankCategory(categories: AccountCategory[]) {
  return categories.find(category => category.name === 'Bank Accounts' && category.account_type === 'Asset')
    || categories.find(category => category.name === 'Bank' && category.account_type === 'Asset')
}

export function bankOverdraftCategory(categories: AccountCategory[]) {
  return categories.find(category => category.name === 'Bank OD A/c' && category.account_type === 'Liability')
}

export function bankAccounts(accounts: Account[], categories: AccountCategory[], includeArchived = false) {
  const categoryIds = new Set([bankCategory(categories)?.id, bankOverdraftCategory(categories)?.id].filter(Boolean))
  return accounts.filter(account => categoryIds.has(account.category_id) && (includeArchived || !account.is_archived))
}

export function signedBankBalance(account: Account, amount = account.balance || 0) {
  return account.type === 'Liability' ? -amount : amount
}

export function legacySettlementAccountId(voucher: Voucher) {
  if (voucher.settlement_account_id) return voucher.settlement_account_id
  const lines = voucher.lines || []
  if (voucher.type === 'Receipt') return lines.find(line => line.account_id !== voucher.party_account_id && line.debit > 0)?.account_id
  if (voucher.type === 'Payment') return lines.find(line => line.account_id !== voucher.party_account_id && line.credit > 0)?.account_id
  if (voucher.type === 'Sales Return') return lines.find(line => line.credit > 0)?.account_id
  if (voucher.type === 'Purchase Return') return lines.find(line => line.debit > 0)?.account_id
  return undefined
}
