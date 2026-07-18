import { describe, expect, it } from 'vitest'
import { SYSTEM_ACCOUNT_DESTINATIONS, SYSTEM_ACCOUNT_GROUPS, systemAccountGroupLevels } from './systemAccountGroups'

describe('protected system account groups', () => {
  it('defines a unique, parent-first hierarchy no deeper than three levels', () => {
    const keys = new Set<string>()
    const depths = new Map<string, number>()
    for (const group of SYSTEM_ACCOUNT_GROUPS) {
      expect(keys.has(group.key)).toBe(false)
      const depth = group.parent_key ? (depths.get(group.parent_key) || 0) + 1 : 1
      if (group.parent_key) expect(keys.has(group.parent_key)).toBe(true)
      expect(depth).toBeLessThanOrEqual(3)
      keys.add(group.key)
      depths.set(group.key, depth)
    }
    expect([...keys]).toEqual(expect.arrayContaining([
      'assets', 'liabilities', 'equity', 'incomes', 'expenses',
      'bank-accounts', 'cash-in-hand', 'bank-od', 'duties-taxes',
      'sundry-debtors', 'sundry-creditors', 'sales-accounts', 'purchase-accounts',
    ]))
  })

  it('maps every built-in ledger to a canonical group', () => {
    const keys = new Set(SYSTEM_ACCOUNT_GROUPS.map(group => group.key))
    expect(Object.values(SYSTEM_ACCOUNT_DESTINATIONS).every(key => keys.has(key))).toBe(true)
    expect(SYSTEM_ACCOUNT_DESTINATIONS.vat_payable).toBe('duties-taxes')
    expect(SYSTEM_ACCOUNT_DESTINATIONS.vat_receivable).toBe('duties-taxes')
  })

  it('batches hierarchy writes by level while keeping every parent earlier', () => {
    const levels = systemAccountGroupLevels()
    expect(levels).toHaveLength(3)
    const levelByKey = new Map(levels.flatMap((level, index) => level.map(group => [group.key, index] as const)))
    for (const group of SYSTEM_ACCOUNT_GROUPS) {
      if (group.parent_key) expect(levelByKey.get(group.parent_key)).toBeLessThan(levelByKey.get(group.key)!)
    }
  })

  it('rejects an unresolved or circular hierarchy instead of looping forever', () => {
    expect(() => systemAccountGroupLevels([
      { key: 'a', name: 'A', account_type: 'Asset', parent_key: 'b' },
      { key: 'b', name: 'B', account_type: 'Asset', parent_key: 'a' },
    ])).toThrow(/unresolved parent or cycle/)
  })
})
