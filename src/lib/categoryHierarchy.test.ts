import { describe, expect, it } from 'vitest'
import { buildCategoryTree, categoryDepth, categoryDescendantIds, categoryOptionLabel, categoryPath, subtreeHeight } from '@/lib/categoryHierarchy'

const categories = [
  { id: 'assets', name: 'Assets', parent_category_id: null },
  { id: 'current', name: 'Current Assets', parent_category_id: 'assets' },
  { id: 'debtors', name: 'Sundry Debtors', parent_category_id: 'current' },
  { id: 'employee', name: 'Employees / Staffs', parent_category_id: 'debtors' },
]

describe('category hierarchy', () => {
  it('builds four levels and includes direct and descendant records in totals', () => {
    const tree = buildCategoryTree(categories, [
      { id: 'root-ledger', category_id: 'assets' },
      { id: 'employee-advance', category_id: 'employee' },
    ])
    expect(tree[0].path).toBe('Assets')
    expect(tree[0].directCount).toBe(1)
    expect(tree[0].totalCount).toBe(2)
    expect(tree[0].children[0].children[0].children[0]).toMatchObject({ depth: 4, totalCount: 1 })
    expect(tree[0].children[0].children[0].children[0].path).toContain('Employees / Staffs')
  })

  it('calculates paths, depth, descendants, and subtree height', () => {
    expect(categoryPath(categories, 'employee')).toContain('Employees / Staffs')
    expect(categoryDepth(categories, 'employee')).toBe(4)
    expect(categoryDescendantIds(categories, 'assets')).toEqual(new Set(['current', 'debtors', 'employee']))
    expect(subtreeHeight(categories, 'assets')).toBe(4)
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
