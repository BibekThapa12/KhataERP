import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationName = '202610200001_serialized_item_opening_stock.sql'
const normalizeSql = (value: string) => value.replace(/\r\n/g, '\n').trim()
const migration = normalizeSql(readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8'))

function syncedMigration(file: string) {
  const source = readFileSync(join(root, file), 'utf8')
  const startMarker = `-- BEGIN SYNCED MIGRATION: ${migrationName}`
  const endMarker = `-- END SYNCED MIGRATION: ${migrationName}`
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return normalizeSql(source.slice(start + startMarker.length, end))
}

describe('serialized opening-stock migration', () => {
  it('keeps item creation and serial insertion in one authenticated RPC', () => {
    expect(migration).toContain('create_serialized_item_with_opening_stock')
    expect(migration).toContain("not public.is_company_member(target_company)")
    expect(migration).toContain('update of is_serialized,is_service,opening_qty,alternate_unit,alternate_conversion')
    expect(migration).toContain('update public.items set opening_qty=expected_count')
    expect(migration).toContain("values(target_company,saved.id,btrim(serial_text),auth.uid(),true,'saleable')")
  })

  it('includes opening balances in selection, movement validation, and reporting', () => {
    expect(migration).toContain('public.inventory_serial_balance')
    expect(migration).toContain('public.inventory_serial_report_rows')
    expect(migration).toContain("'Opening Stock'::text voucher_type")
    expect(migration).toContain("p_mode<>'purchase_return'")
  })

  it('is synchronized with the base schema and staging bootstrap', () => {
    expect(syncedMigration(join('supabase', 'standalone', 'supabase-schema.sql'))).toBe(migration)
    expect(syncedMigration(join('supabase', 'bootstrap.sql'))).toBe(migration)
  })
})
