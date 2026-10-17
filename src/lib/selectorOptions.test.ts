import { describe, expect, it } from 'vitest'
import { categorySelectorOption, itemSelectorOption, ledgerSelectorOption, partySelectorOption, sortSelectorOptions } from '@/lib/selectorOptions'
import type { Account, AccountCategory, Item, ItemCategory, Party } from '@/types'

const categories: AccountCategory[] = [
  { id: 'assets', company_id: 'c', name: 'Assets', account_type: 'Asset', is_system: true, is_archived: false },
  { id: 'bank', company_id: 'c', name: 'Bank Accounts', account_type: 'Asset', parent_category_id: 'assets', is_system: true, is_archived: false },
]

const account: Account = {
  id: 'a', company_id: 'c', name: 'ABC Bank', type: 'Asset', group: 'Bank Accounts', is_system: false,
  is_party: false, opening_balance: 0, bank_account_no: '0012', category_id: 'bank', balance: 0,
}

it('builds descriptive item and party options without changing stable IDs', () => {
  const item = { id: 'i', company_id: 'c', name: 'Coke', unit: 'pcs', alternate_unit: 'case', sell_rate: 10, opening_qty: 0, opening_rate: 0, sku: 'CK-1' } satisfies Item
  const party = { id: 'p', company_id: 'c', name: 'Durgapur Traders', type: 'customer', account_id: 'party-a', phone: '9800000000', pan_vat: '123' } satisfies Party
  expect(itemSelectorOption(item)).toMatchObject({ value: 'i', label: 'Coke', secondaryText: expect.stringContaining('SKU CK-1') })
  expect(partySelectorOption(party)).toMatchObject({ value: 'party-a', label: 'Durgapur Traders', secondaryText: expect.stringContaining('PAN 123') })
})

describe('hierarchical selector options', () => {
  it('groups ledgers by their complete account category path', () => {
    expect(ledgerSelectorOption(account, categories)).toMatchObject({ value: 'a', group: 'Assets › Bank Accounts' })
  })

  it('shows the parent path for nested item categories', () => {
    const itemCategories: ItemCategory[] = [
      { id: 'food', company_id: 'c', name: 'Food', is_archived: false },
      { id: 'drinks', company_id: 'c', name: 'Drinks', parent_category_id: 'food', is_archived: false },
    ]
    expect(categorySelectorOption(itemCategories[1], itemCategories)).toMatchObject({ label: 'Drinks', secondaryText: 'Food' })
  })

  it('sorts by group and then label consistently', () => {
    expect(sortSelectorOptions([
      { value: '2', label: 'Zulu', group: 'B' },
      { value: '1', label: 'Alpha', group: 'A' },
      { value: '3', label: 'Beta', group: 'A' },
    ]).map(option => option.value)).toEqual(['1', '3', '2'])
  })
})
