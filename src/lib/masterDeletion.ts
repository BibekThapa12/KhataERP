import type { Account, AccountCategory, Voucher } from '@/types'
import { categoryDescendantIds } from '@/lib/categoryHierarchy'

const hasAccountReference = (voucher: Voucher, accountId: string) =>
  voucher.party_account_id === accountId ||
  voucher.settlement_account_id === accountId ||
  voucher.lines?.some(line => line.account_id === accountId) ||
  voucher.settlements?.some(settlement => settlement.party_account_id === accountId)

export function ledgerDeletionBlockReason(account: Account, vouchers: Voucher[]) {
  if (account.is_system) return 'System-created ledgers cannot be deleted.'
  if (Math.abs(account.balance || 0) >= 0.005) return 'The ledger balance must be zero before deletion.'
  if (vouchers.some(voucher => hasAccountReference(voucher, account.id))) return 'This ledger has transaction history. Archive it instead to preserve accounting records.'
  return null
}

export function accountCategoryDeletionBlockReason(category: AccountCategory, categories: AccountCategory[], accounts: Account[]) {
  if (category.is_system) return 'System-created account groups cannot be deleted.'
  const descendants = categoryDescendantIds(categories, category.id)
  if (accounts.some(account => account.category_id === category.id || descendants.has(account.category_id || ''))) return 'Delete every ledger in this group and its subgroups first.'
  if (categories.some(candidate => candidate.parent_category_id === category.id)) return 'Delete child account groups first.'
  return null
}
