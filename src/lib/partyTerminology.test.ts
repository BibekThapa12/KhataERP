import { describe, expect, it } from 'vitest'
import { partyCategoryForType, partyTerminology, partyTypeForCategory } from '@/lib/partyTerminology'

describe('party terminology', () => {
  it('maps customers to Sundry Debtors without changing the internal type', () => {
    expect(partyTerminology('customer')).toMatchObject({ category: 'Sundry Debtors', accountType: 'Asset', singular: 'Sundry Debtor (Customer)' })
    expect(partyTerminology('customer').searchAliases).toContain('customers')
  })

  it('maps suppliers to Sundry Creditors and retains old search aliases', () => {
    expect(partyTerminology('supplier')).toMatchObject({ category: 'Sundry Creditors', accountType: 'Liability', plural: 'Sundry Creditors (Suppliers)' })
    expect(partyTerminology('supplier').searchAliases).toContain('supplier')
  })

  it('recognizes only correctly typed Sundry categories as party categories', () => {
    expect(partyTypeForCategory({ name: 'Sundry Debtors', account_type: 'Asset' })).toBe('customer')
    expect(partyTypeForCategory({ name: 'Sundry Creditors', account_type: 'Liability' })).toBe('supplier')
    expect(partyTypeForCategory({ name: 'Sundry Debtors', account_type: 'Expense' })).toBeNull()
  })

  it('resolves labelled Sundry categories without falling back to another group', () => {
    const categories = [
      { id: 'expense', company_id: 'company', name: 'Administration Expenses', account_type: 'Expense' as const, is_system: false, is_archived: false },
      { id: 'debtors', company_id: 'company', name: 'Sundry Debtors (Customers)', account_type: 'Asset' as const, is_system: true, is_archived: false },
    ]
    expect(partyCategoryForType(categories, 'customer')?.id).toBe('debtors')
    expect(partyCategoryForType(categories, 'supplier')).toBeUndefined()
  })
})
