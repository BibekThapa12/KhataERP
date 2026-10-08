import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.invalid')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-public-key')
  return { tables: {} as Record<string, Array<Record<string, unknown>>>, failTable: '', calls: [] as string[], snapshotFormat: 1, timeoutCount: 0, dataVersion: '1' }
})
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (name: string, args: { p_company_id: string; p_after_id?: string | null; p_page_size?: number }) => name === 'get_company_data_version'
      ? (fake.calls.push(name), Promise.resolve({ data: fake.dataVersion, error: null }))
      : ({ abortSignal: async (_signal: AbortSignal) => {
      if (name === 'get_company_accounting_snapshot_page_v1' && fake.snapshotFormat !== 4) return { data: null, error: { code: 'PGRST202', message: 'get_company_accounting_snapshot_page_v1 is not in the schema cache' } }
      if (name === 'get_company_accounting_snapshot_v3' && fake.snapshotFormat !== 3) return { data: null, error: { code: 'PGRST202', message: 'get_company_accounting_snapshot_v3 is not in the schema cache' } }
      if (name === 'get_company_accounting_snapshot_v2' && fake.snapshotFormat < 2) return { data: null, error: { code: 'PGRST202', message: 'get_company_accounting_snapshot_v2 is not in the schema cache' } }
      if (!['get_company_accounting_snapshot', 'get_company_accounting_snapshot_v2', 'get_company_accounting_snapshot_v3', 'get_company_accounting_snapshot_page_v1'].includes(name)) return { data: null, error: new Error('unknown rpc') }
      if (fake.failTable) return { data: null, error: new Error('schema unavailable') }
      fake.calls.push(name)
      if (fake.timeoutCount > 0) {
        fake.timeoutCount -= 1
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
      }
      const allVouchers = (fake.tables.vouchers || []).filter(row => row.company_id === args.p_company_id).map(row => ({
        ...row,
        lines: (fake.tables.voucher_lines || []).filter(line => line.voucher_id === row.id),
        stock_lines: (fake.tables.stock_lines || []).filter(line => line.voucher_id === row.id),
        invoice_items: (fake.tables.invoice_items || []).filter(line => line.voucher_id === row.id),
        settlements: (fake.tables.voucher_settlements || []).filter(line => line.company_id === args.p_company_id && line.settlement_voucher_id === row.id),
      })).sort((left, right) => String(left.id).localeCompare(String(right.id)))
      const pageStart = name === 'get_company_accounting_snapshot_page_v1' && args.p_after_id
        ? allVouchers.findIndex(voucher => String(voucher.id).localeCompare(String(args.p_after_id)) > 0)
        : 0
      const safePageStart = pageStart < 0 ? allVouchers.length : pageStart
      const pageSize = args.p_page_size || 200
      const vouchers = name === 'get_company_accounting_snapshot_page_v1'
        ? allVouchers.slice(safePageStart, safePageStart + pageSize)
        : allVouchers
      const count = (field: 'lines' | 'stock_lines' | 'invoice_items' | 'settlements') => vouchers.reduce((sum, voucher) => sum + voucher[field].length, 0)
      if (name === 'get_company_accounting_snapshot_page_v1') return { data: {
        format_version: 4,
        company_id: args.p_company_id,
        generated_at: '2026-10-08T00:00:00Z',
        data_version: fake.dataVersion,
        page: { has_more: safePageStart + vouchers.length < allVouchers.length, next_after_id: vouchers.at(-1)?.id || null },
        counts: { vouchers: vouchers.length, voucher_lines: count('lines'), stock_lines: count('stock_lines'), invoice_items: count('invoice_items'), settlements: count('settlements') },
        vouchers: vouchers.map(({ lines: _lines, stock_lines: _stockLines, invoice_items: _invoiceItems, settlements: _settlements, ...voucher }) => voucher),
        voucher_lines: vouchers.flatMap(voucher => voucher.lines),
        stock_lines: vouchers.flatMap(voucher => voucher.stock_lines),
        invoice_items: vouchers.flatMap(voucher => voucher.invoice_items),
        settlements: vouchers.flatMap(voucher => voucher.settlements),
      }, error: null }
      if (name === 'get_company_accounting_snapshot_v2' || name === 'get_company_accounting_snapshot_v3') return { data: {
        format_version: name === 'get_company_accounting_snapshot_v3' ? 3 : 2,
        company_id: args.p_company_id,
        generated_at: '2026-10-06T00:00:00Z',
        counts: { vouchers: vouchers.length, voucher_lines: count('lines'), stock_lines: count('stock_lines'), invoice_items: count('invoice_items'), settlements: count('settlements') },
        vouchers: vouchers.map(({ lines: _lines, stock_lines: _stockLines, invoice_items: _invoiceItems, settlements: _settlements, ...voucher }) => voucher),
        voucher_lines: vouchers.flatMap(voucher => voucher.lines),
        stock_lines: vouchers.flatMap(voucher => voucher.stock_lines),
        invoice_items: vouchers.flatMap(voucher => voucher.invoice_items),
        settlements: vouchers.flatMap(voucher => voucher.settlements),
      }, error: null }
      return { data: { company_id: args.p_company_id, generated_at: '2026-09-21T00:00:00Z', counts: { vouchers: vouchers.length, voucher_lines: count('lines'), stock_lines: count('stock_lines'), invoice_items: count('invoice_items'), settlements: count('settlements') }, vouchers }, error: null }
    } }),
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      const orders: string[] = []
      const query = {
        select: (_fields: string) => query,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return query },
        order: (field: string) => { orders.push(field); return query },
        range: (from: number, to: number) => ({ abortSignal: async (_signal: AbortSignal) => {
          fake.calls.push(table)
          if (table === fake.failTable) return { data: null, count: null, error: new Error('schema unavailable') }
          expect(orders).toContain('id')
          const rows = (fake.tables[table] || []).filter(row => filters.every(([field, value]) => {
            if (field === 'owner.company_id') {
              const parent = fake.tables.vouchers?.find(v => v.id === row.voucher_id)
              return parent?.company_id === value
            }
            return row[field] === value
          })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
          return { data: rows.slice(from, Math.min(to + 1, from + 41)), count: rows.length, error: null }
        } }),
      }
      return query
    },
  }),
}))
import { fetchAccounts, fetchItems, fetchParties, fetchVouchers } from './supabase'

beforeEach(() => { fake.tables = {}; fake.failTable = ''; fake.calls = []; fake.snapshotFormat = 1; fake.timeoutCount = 0; fake.dataVersion = '1' })

describe('company accounting reads beyond API caps', () => {
  it('loads all headers, individual children, settlements, and both voucher types', async () => {
    fake.tables.vouchers = Array.from({ length: 1203 }, (_, i) => ({ id: `v${i}`, company_id: 'A', type: i % 2 ? 'Sales' : 'Purchase', date_bs: '2083-01-01', date_bs_key: 20830101, date_ad: '2026-04-14', seq: 1, updated_at: '2026-01-01' }))
    fake.tables.vouchers.push({ id: 'foreign', company_id: 'B' })
    fake.tables.invoice_items = Array.from({ length: 1501 }, (_, i) => ({ id: `i${i}`, voucher_id: 'v0', item_id: 'item', qty: 1, rate: 1, amount: 1 }))
    fake.tables.invoice_items.push({ id: 'foreign-line', voucher_id: 'foreign' })
    fake.tables.voucher_lines = Array.from({ length: 1601 }, (_, i) => ({ id: `l${i}`, voucher_id: 'v0', account_id: 'a', debit: 0, credit: 0 }))
    fake.tables.stock_lines = Array.from({ length: 1551 }, (_, i) => ({ id: `s${i}`, voucher_id: 'v0', item_id: 'item', qty: 1, rate: 1, direction: 'in' }))
    fake.tables.voucher_settlements = Array.from({ length: 1301 }, (_, i) => ({ id: `t${i}`, company_id: 'A', settlement_voucher_id: 'v0', invoice_voucher_id: 'v1', party_account_id: 'a', amount: 1 }))
    const vouchers = await fetchVouchers('A')
    expect(vouchers).toHaveLength(1203)
    const first = vouchers.find(v => v.id === 'v0')!
    expect(first.invoice_items).toHaveLength(1501)
    expect(first.lines).toHaveLength(1601)
    expect(first.stock_lines).toHaveLength(1551)
    expect(first.settlements).toHaveLength(1301)
    expect(vouchers.some(v => v.company_id !== 'A')).toBe(false)
    expect(fake.calls).toEqual(['get_company_accounting_snapshot'])
  })
  it('does not replace settlement failures with an empty array', async () => {
    fake.failTable = 'voucher_settlements'
    await expect(fetchVouchers('A')).rejects.toThrow('schema unavailable')
  })
  it('assembles normalized indexed snapshot rows and retries one transient statement timeout', async () => {
    fake.snapshotFormat = 2
    fake.timeoutCount = 1
    fake.tables.vouchers = [{ id: 'v1', company_id: 'A', type: 'Sales', date_bs: '2083-01-01', date_bs_key: 20830101, date_ad: '2026-04-14', seq: 1, updated_at: '2026-01-01' }]
    fake.tables.voucher_lines = [{ id: 'l1', voucher_id: 'v1', account_id: 'a', debit: 100, credit: 0 }]
    fake.tables.invoice_items = [{ id: 'i1', voucher_id: 'v1', item_id: 'item', qty: 1, rate: 100, amount: 100 }]

    const vouchers = await fetchVouchers('A')

    expect(vouchers[0].lines).toEqual(fake.tables.voucher_lines)
    expect(vouchers[0].invoice_items).toEqual(fake.tables.invoice_items)
    expect(fake.calls).toEqual(['get_company_accounting_snapshot_v2', 'get_company_accounting_snapshot_v2'])
  })
  it('prefers the lean v3 snapshot when it is deployed', async () => {
    fake.snapshotFormat = 3
    fake.tables.vouchers = [{ id: 'v1', company_id: 'A', type: 'Sales', date_bs: '2083-01-01', date_bs_key: 20830101, date_ad: '2026-04-14', seq: 1 }]
    await fetchVouchers('A')
    expect(fake.calls).toEqual(['get_company_accounting_snapshot_v3'])
  })
  it('loads large accounting histories in bounded pages and validates the final revision', async () => {
    fake.snapshotFormat = 4
    fake.tables.vouchers = Array.from({ length: 1203 }, (_, i) => ({ id: `v${String(i).padStart(4, '0')}`, company_id: 'A', type: 'Sales', date_bs: '2083-01-01', date_bs_key: 20830101, date_ad: '2026-04-14', seq: i + 1 }))
    const vouchers = await fetchVouchers('A')
    expect(vouchers).toHaveLength(1203)
    expect(fake.calls.filter(name => name === 'get_company_accounting_snapshot_page_v1')).toHaveLength(7)
    expect(fake.calls.at(-1)).toBe('get_company_data_version')
  })
  it('fully loads masters even when all names are identical', async () => {
    for (const table of ['accounts', 'items', 'parties']) fake.tables[table] = Array.from({ length: 1205 }, (_, i) => ({ id: `${table}${i}`, company_id: 'A', name: 'Same' }))
    const lists = await Promise.all([fetchAccounts('A'), fetchItems('A'), fetchParties('A')])
    expect(lists.map(rows => rows.length)).toEqual([1205, 1205, 1205])
  })
})
