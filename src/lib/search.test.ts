import { describe, expect, it } from 'vitest'
import { filterSearchableOptions, groupSearchableOptions, normalizeSearch } from '@/lib/search'

describe('searchable selection filtering', () => {
  const options = [
    { value: 'party-1', label: 'Krishan Traders', searchText: 'Customer 9800000000 PAN-123', group: 'Asset' },
    { value: 'item-1', label: 'Rice Bag', searchText: 'RICE-25 998877 box kg', group: 'Items' },
    { value: 'cash', label: 'Cash', group: 'Asset' },
    { value: 'bank-group', label: 'Bank', searchText: 'Assets › Current Assets › Bank', group: 'Asset' },
  ]

  it('normalizes case and repeated whitespace', () => {
    expect(normalizeSearch('  Rice   BAG ')).toBe('rice bag')
  })

  it('matches labels and hidden identifiers', () => {
    expect(filterSearchableOptions(options, 'TRADERS').map(option => option.value)).toEqual(['party-1'])
    expect(filterSearchableOptions(options, '998877').map(option => option.value)).toEqual(['item-1'])
    expect(filterSearchableOptions(options, 'pan-123').map(option => option.value)).toEqual(['party-1'])
    expect(filterSearchableOptions(options, 'current assets bank').map(option => option.value)).toEqual(['bank-group'])
  })

  it('matches secondary text, trailing metadata, and group names', () => {
    const richOptions = [
      { value: 'item', label: 'Coke', secondaryText: 'SKU CK-250 · pcs', trailingText: '24 pcs', group: 'Beverages' },
      { value: 'ledger', label: 'ABC Bank', secondaryText: 'Asset · A/C 0012', group: 'Assets › Current Assets › Bank Accounts' },
    ]
    expect(filterSearchableOptions(richOptions, 'ck-250').map(option => option.value)).toEqual(['item'])
    expect(filterSearchableOptions(richOptions, '24 pcs').map(option => option.value)).toEqual(['item'])
    expect(filterSearchableOptions(richOptions, 'bank accounts').map(option => option.value)).toEqual(['ledger'])
  })

  it('filters a large option set without changing option identity', () => {
    const large = Array.from({ length: 1000 }, (_, index) => ({ value: `item-${index}`, label: `Inventory Item ${index}`, secondaryText: `SKU-${index}` }))
    expect(filterSearchableOptions(large, 'SKU-999')).toEqual([large[999]])
  })

  it('retains grouped option metadata and returns all options for a blank query', () => {
    expect(filterSearchableOptions(options, '')).toEqual(options)
    expect(filterSearchableOptions(options, 'cash')[0].group).toBe('Asset')
  })

  it('keeps grouped options contiguous so each heading is rendered once', () => {
    const interleaved = [
      { value: 'asset-1', label: 'Assets', group: 'Asset' },
      { value: 'liability-1', label: 'Liabilities', group: 'Liability' },
      { value: 'asset-2', label: 'Bank', group: 'Asset' },
      { value: 'expense-1', label: 'Indirect Expenses', group: 'Expense' },
      { value: 'liability-2', label: 'Sundry Creditors', group: 'Liability' },
    ]
    expect(groupSearchableOptions(interleaved).map(option => option.value)).toEqual([
      'asset-1', 'asset-2', 'liability-1', 'liability-2', 'expense-1',
    ])
  })
})
