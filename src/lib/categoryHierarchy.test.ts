import { describe, expect, it } from 'vitest'
import { buildCategoryTree, categoryDepth, categoryDescendantIds, categoryOptionLabel, categoryPath, subtreeHeight } from '@/lib/categoryHierarchy'

const categories = [
  { id: 'assets', name: 'Assets', parent_category_id: null },
  { id: 'current', name: 'Current Assets', parent_category_id: 'assets' },
  { id: 'debtors', name: 'Sundry Debtors', parent_category_id: 'current' },
]

describe('category hierarchy', () => {
  it('builds three levels and includes direct and descendant records in totals', () => {
    const tree = buildCategoryTree(categories, [
      { id: 'root-ledger', category_id: 'assets' },
      { id: 'customer', category_id: 'debtors' },
    ])
    expect(tree[0].path).toBe('Assets')
    expect(tree[0].directCount).toBe(1)
    expect(tree[0].totalCount).toBe(2)
    expect(tree[0].children[0].children[0]).toMatchObject({ depth: 3, path: 'Assets › Current Assets › Sundry Debtors', totalCount: 1 })
  })

  it('calculates paths, depth, descendants, and subtree height', () => {
    expect(categoryPath(categories, 'debtors')).toBe('Assets › Current Assets › Sundry Debtors')
    expect(categoryDepth(categories, 'debtors')).toBe(3)
    expect(categoryDescendantIds(categories, 'assets')).toEqual(new Set(['current', 'debtors']))
    expect(subtreeHeight(categories, 'assets')).toBe(3)
  })

  it('uses concise selector labels and adds only the context needed for duplicates', () => {
    const options = [
      ...categories,
      { id: 'liabilities', name: 'Liabilities', parent_category_id: null },
      { id: 'liability-current', name: 'Current Liabilities', parent_category_id: 'liabilities' },
      { id: 'asset-bank', name: 'Bank', parent_category_id: 'current' },
      { id: 'liability-bank', name: 'Bank', parent_category_id: 'liability-current' },
    ]
    expect(categoryOptionLabel(options, 'debtors')).toBe('Sundry Debtors')
    expect(categoryOptionLabel(options, 'asset-bank')).toBe('Bank (Current Assets)')
    expect(categoryOptionLabel(options, 'liability-bank')).toBe('Bank (Current Liabilities)')
  })
})
