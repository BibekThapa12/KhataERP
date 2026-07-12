import { describe, expect, it } from 'vitest'
import { filterSearchableOptions, normalizeSearch } from '@/lib/search'

describe('searchable selection filtering', () => {
  const options = [
    { value: 'party-1', label: 'Krishan Traders', searchText: 'Customer 9800000000 PAN-123', group: 'Asset' },
    { value: 'item-1', label: 'Rice Bag', searchText: 'RICE-25 998877 box kg', group: 'Items' },
    { value: 'cash', label: 'Cash', group: 'Asset' },
  ]

  it('normalizes case and repeated whitespace', () => {
    expect(normalizeSearch('  Rice   BAG ')).toBe('rice bag')
  })

  it('matches labels and hidden identifiers', () => {
    expect(filterSearchableOptions(options, 'TRADERS').map(option => option.value)).toEqual(['party-1'])
    expect(filterSearchableOptions(options, '998877').map(option => option.value)).toEqual(['item-1'])
    expect(filterSearchableOptions(options, 'pan-123').map(option => option.value)).toEqual(['party-1'])
  })

  it('retains grouped option metadata and returns all options for a blank query', () => {
    expect(filterSearchableOptions(options, '')).toEqual(options)
    expect(filterSearchableOptions(options, 'cash')[0].group).toBe('Asset')
  })
})
