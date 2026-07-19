import type { AccountCategory, AccountType, PartyType } from '@/types'

export interface PartyTerminology {
  category: 'Sundry Debtors' | 'Sundry Creditors'
  accountType: AccountType
  singular: string
  plural: string
  searchAliases: string
}

const terms: Record<PartyType, PartyTerminology> = {
  customer: {
    category: 'Sundry Debtors',
    accountType: 'Asset',
    singular: 'Sundry Debtor (Customer)',
    plural: 'Sundry Debtors (Customers)',
    searchAliases: 'sundry debtor sundry debtors customer customers',
  },
  supplier: {
    category: 'Sundry Creditors',
    accountType: 'Liability',
    singular: 'Sundry Creditor (Supplier)',
    plural: 'Sundry Creditors (Suppliers)',
    searchAliases: 'sundry creditor sundry creditors supplier suppliers',
  },
}

export function partyTerminology(type: PartyType) {
  return terms[type]
}

export function partyCategoryForType(categories: AccountCategory[], type: PartyType) {
  const terminology = partyTerminology(type)
  const exact = categories.find(category => category.name === terminology.category && category.account_type === terminology.accountType)
  if (exact) return exact
  const expectedPrefix = type === 'customer' ? 'sundry debtor' : 'sundry creditor'
  return categories.find(category => category.account_type === terminology.accountType
    && category.name.trim().toLowerCase().replace(/\s+/g, ' ').startsWith(expectedPrefix))
}

export function partyTypeForCategory(category?: Pick<AccountCategory, 'name' | 'account_type'> | null): PartyType | null {
  if (category?.name === 'Sundry Debtors' && category.account_type === 'Asset') return 'customer'
  if (category?.name === 'Sundry Creditors' && category.account_type === 'Liability') return 'supplier'
  return null
}
