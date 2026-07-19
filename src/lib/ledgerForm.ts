import { normalSide } from '@/lib/engine'
import type { AccountCategory, AccountType } from '@/types'

export type BalanceType = 'Dr' | 'Cr'

export interface LedgerFieldVisibility {
  showContactDetails: boolean
  showCreditDays: boolean
  showBankDetails: boolean
}

function categoryNames(categories: AccountCategory[], categoryId: string) {
  const byId = new Map(categories.map(category => [category.id, category]))
  const names: string[] = []
  const visited = new Set<string>()
  let current = byId.get(categoryId)
  while (current && !visited.has(current.id)) {
    names.push(current.name.trim().toLocaleLowerCase())
    visited.add(current.id)
    current = current.parent_category_id ? byId.get(current.parent_category_id) : undefined
  }
  return names
}

export function ledgerFieldVisibility(categories: AccountCategory[], categoryId: string): LedgerFieldVisibility {
  const category = categories.find(candidate => candidate.id === categoryId)
  if (!category || category.account_type === 'Income' || category.account_type === 'Expense') {
    return { showContactDetails: false, showCreditDays: false, showBankDetails: false }
  }
  const names = categoryNames(categories, categoryId)
  const showBankDetails = names.includes('bank accounts')
  const showCreditDays = names.includes('sundry debtors') || names.includes('sundry creditors')
  return {
    showContactDetails: category.account_type === 'Asset' || category.account_type === 'Liability',
    showCreditDays,
    showBankDetails,
  }
}

export function openingBalanceToStored(amount: number, accountType: AccountType, balanceType: BalanceType) {
  const selectedSide = balanceType === 'Dr' ? 'debit' : 'credit'
  return normalSide(accountType) === selectedSide ? Math.abs(amount) : -Math.abs(amount)
}

export function openingBalanceFromStored(value: number, accountType: AccountType): { amount: number; balanceType: BalanceType } {
  const natural = normalSide(accountType)
  const side = value < 0 ? (natural === 'debit' ? 'credit' : 'debit') : natural
  return { amount: Math.abs(value || 0), balanceType: side === 'debit' ? 'Dr' : 'Cr' }
}
