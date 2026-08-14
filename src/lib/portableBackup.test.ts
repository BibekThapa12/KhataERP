import { describe, expect, it } from 'vitest'
import { buildPortableCompanyBackup, safeBackupFolderName, serializePortableBackup, uniqueBackupNames, validatePortableCompanyBackup } from './portableBackup'

describe('portable company backups', () => {
  it('keeps v1 compatibility, counts nested records, and removes secrets', () => {
    const backup = buildPortableCompanyBackup({
      company: { id: 'company-1', name: 'Admin Company', address: 'Kathmandu', user_id: 'owner', developer_notes: 'private' } as never,
      accounts: [{ id: 'a', company_id: 'company-1', name: 'Cash', access_token: 'never' } as never],
      parties: [], items: [], accountCategories: [], itemCategories: [],
      vouchers: [{ id: 'v', company_id: 'company-1', lines: [{ id: 'l' }], stock_lines: [], invoice_items: [] } as never],
      cheques: [{ id: 'c' } as never],
    }, { exportedBy: 'developer-1' })
    expect(backup.format).toBe('khataerp-portable-company-v1')
    expect(backup.original_company_id).toBe('company-1')
    expect(backup.company).toEqual({ name: 'Admin Company', address: 'Kathmandu' })
    expect(backup.record_counts).toMatchObject({ accounts: 1, vouchers: 1, voucher_lines: 1, cheques: 1 })
    expect(JSON.stringify(backup)).not.toContain('access_token')
    expect(JSON.stringify(backup)).not.toContain('developer_notes')
    expect(() => validatePortableCompanyBackup(JSON.parse(serializePortableBackup(backup)))).not.toThrow()
  })

  it('accepts a legacy v1-shaped backup without optional sections', () => {
    expect(() => validatePortableCompanyBackup({ format: 'khataerp-portable-company-v1', exported_at: '2026-01-01', company: { name: 'Legacy' }, accounts: [], parties: [], items: [], vouchers: [] })).not.toThrow()
  })

  it('creates safe Windows folder names and stable duplicate suffixes', () => {
    expect(safeBackupFolderName('ACME: Nepal / 2026.', 'Company')).toBe('ACME Nepal 2026')
    expect(safeBackupFolderName('CON', 'Company')).toBe('Company Folder')
    const names = uniqueBackupNames([{ id: '12345678-a', name: 'Admin' }, { id: '87654321-b', name: 'admin' }, { id: 'other', name: 'Sales' }], 'Company')
    expect(names.get('12345678-a')).toBe('Admin (12345678)')
    expect(names.get('87654321-b')).toBe('admin (87654321)')
    expect(names.get('other')).toBe('Sales')
  })
})
