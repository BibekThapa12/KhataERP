import { describe, expect, it } from 'vitest'
import { canonicalizeModuleEntitlements, dedupeModules, getBackupLocationLabel } from './developerDashboard'

describe('developer dashboard presentation helpers', () => {
  it('shows a module key only once even when the catalogue contains duplicates', () => {
    const modules = [
      { id: 'first', key: 'cheque_management', name: 'Cheque Management' },
      { id: 'second', key: 'CHEQUE_MANAGEMENT', name: 'Cheque Management' },
      { id: 'third', key: 'inventory', name: 'Inventory' },
    ]

    expect(dedupeModules(modules).map(module => module.id)).toEqual(['first', 'third'])
    expect(canonicalizeModuleEntitlements(modules, [
      { company_id: 'company', module_id: 'first', is_enabled: false },
      { company_id: 'company', module_id: 'second', is_enabled: true },
    ])).toEqual([{ company_id: 'company', module_id: 'first', is_enabled: true }])
  })

  it('does not present a slash-only directory handle as a useful path', () => {
    expect(getBackupLocationLabel({ name: '\\' }, true)).toBe('Folder selected (name unavailable)')
    expect(getBackupLocationLabel(null, true)).toBe('Not configured')
    expect(getBackupLocationLabel(null, false)).toBe('Folder access unavailable — ZIP only')
  })
})
