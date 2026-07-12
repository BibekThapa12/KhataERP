import type { Account, AccountCategory, Voucher } from '@/types'

export function bankCategory(categories: AccountCategory[]) {
  return categories.find(category => category.name === 'Bank' && category.account_type === 'Asset')
}

export function bankAccounts(accounts: Account[], categories: AccountCategory[], includeArchived = false) {
  const category = bankCategory(categories)
  return category ? accounts.filter(account => account.category_id === category.id && (includeArchived || !account.is_archived)) : []
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
