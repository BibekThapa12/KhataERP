import { describe, expect, it } from 'vitest'
import { buildPortableCompanyBackup, portableAccountIdMap, portableSystemAccountKey, safeBackupFolderName, serializePortableBackup, uniqueBackupNames, validatePortableCompanyBackup } from './portableBackup'

describe('portable company backups', () => {
  it('keeps v1 compatibility, counts nested records, and removes secrets', () => {
    const backup = buildPortableCompanyBackup({
      company: { id: 'company-1', name: 'Admin Company', address: 'Kathmandu', user_id: 'owner', plan_status: 'paid', plan_expires_at: '2027-01-01T00:00:00Z', developer_notes: 'private' } as never,
      accounts: [{ id: 'a', company_id: 'company-1', name: 'Cash', access_token: 'never' } as never],
      parties: [], items: [], accountCategories: [], itemCategories: [],
      vouchers: [{ id: 'v', company_id: 'company-1', lines: [{ id: 'l' }], stock_lines: [], invoice_items: [] } as never],
      cheques: [{ id: 'c' } as never],
    }, { exportedBy: 'developer-1' })
    expect(backup.format).toBe('khataerp-portable-company-v1')
    expect(backup.original_company_id).toBe('company-1')
    expect(backup.company).toEqual({ name: 'Admin Company', address: 'Kathmandu', plan_status: 'paid', plan_expires_at: '2027-01-01T00:00:00Z' })
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

  it('remaps company-scoped system ledgers and tolerates legacy type differences', () => {
    const mapping = portableAccountIdMap([
      { id: 'source-company:cash', name: 'Cash', type: 'Asset' },
      { id: 'source-company:vat_receivable', name: 'VAT Receivable (Input)', type: 'Asset' },
      { id: 'custom-source', name: 'Commission Income', type: 'Income' },
    ], [
      { id: 'target-company:cash', name: 'Cash', type: 'Asset' },
      { id: 'target-company:vat_receivable', name: 'VAT Receivable (Input)', type: 'Liability' },
      { id: 'custom-target', name: 'Commission Income', type: 'Income' },
    ] as never)
    expect(portableSystemAccountKey('source-company:cash')).toBe('cash')
    expect(mapping.get('source-company:cash')).toBe('target-company:cash')
    expect(mapping.get('source-company:vat_receivable')).toBe('target-company:vat_receivable')
    expect(mapping.get('custom-source')).toBe('custom-target')
  })
})
