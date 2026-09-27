import { describe, expect, it } from 'vitest'
import { filterSidebarDestinations, normalizeSidebarQuery, rankSidebarDestinations, sidebarPreferenceKeys } from './sidebarNavigation'

const destinations = [
  { label: 'Transaction Registers', parent: 'Reports', to: '/reports/registers' },
  { label: 'Pending Cheques', parent: 'Cheque Management / Incoming Cheques', to: '/cheques/received/pending' },
  { label: 'Customers & Suppliers', parent: 'Accounts & Items', to: '/parties' },
  { label: 'Sales Invoices', parent: 'Transactions', to: '/sales' },
  { label: 'Purchase Bills', parent: 'Transactions', to: '/purchase' },
  { label: 'Ledgers & Categories', parent: 'Accounts & Items', to: '/masters', keywords: ['masters', 'alter masters'] },
]

describe('sidebar navigation helpers', () => {
  it('finds destinations by page or parent label', () => {
    expect(filterSidebarDestinations(destinations, 'incoming').map(item => item.to)).toEqual(['/cheques/received/pending'])
    expect(filterSidebarDestinations(destinations, 'suppliers').map(item => item.to)).toEqual(['/parties'])
  })

  it('ranks title matches before parent-category matches', () => {
    expect(rankSidebarDestinations(destinations, 'transaction').map(item => item.label)).toEqual([
      'Transaction Registers',
      'Sales Invoices',
      'Purchase Bills',
    ])
  })

  it('finds contained, exact, and alias matches using the expected precedence', () => {
    expect(rankSidebarDestinations(destinations, 'register')[0].label).toBe('Transaction Registers')
    expect(rankSidebarDestinations(destinations, 'Transaction Registers')[0].label).toBe('Transaction Registers')
    expect(rankSidebarDestinations(destinations, 'masters')[0].label).toBe('Ledgers & Categories')
  })

  it('normalizes case and repeated whitespace', () => {
    expect(normalizeSidebarQuery('  TRANSACTION   registers ')).toBe('transaction registers')
    expect(rankSidebarDestinations(destinations, '  TRANSACTION   REGISTERS ')[0].label).toBe('Transaction Registers')
  })

  it('preserves navigation order for an empty query and returns nothing for no match', () => {
    expect(rankSidebarDestinations(destinations, '')).toEqual(destinations)
    expect(rankSidebarDestinations(destinations, 'not-a-real-page')).toEqual([])
  })

  it('sorts the full match set before applying a result limit', () => {
    const categoryMatches = Array.from({ length: 12 }, (_, index) => ({ label: `Page ${index}`, parent: 'Transactions', to: `/page-${index}` }))
    const lateTitleMatch = { label: 'Transaction Registers', parent: 'Reports', to: '/reports/registers' }
    expect(filterSidebarDestinations([...categoryMatches, lateTitleMatch], 'transaction', 10)[0]).toEqual(lateTitleMatch)
  })

  it('uses user-scoped preference keys', () => {
    expect(sidebarPreferenceKeys('user-a').collapsed).not.toBe(sidebarPreferenceKeys('user-b').collapsed)
  })
})
