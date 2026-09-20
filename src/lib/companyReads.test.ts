import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.invalid')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-public-key')
  return { tables: {} as Record<string, Array<Record<string, unknown>>>, failTable: '', calls: [] as string[] }
})
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
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

beforeEach(() => { fake.tables = {}; fake.failTable = ''; fake.calls = [] })

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
  })
  it('does not replace settlement failures with an empty array', async () => {
    fake.failTable = 'voucher_settlements'
    await expect(fetchVouchers('A')).rejects.toThrow('schema unavailable')
  })
  it('fully loads masters even when all names are identical', async () => {
    for (const table of ['accounts', 'items', 'parties']) fake.tables[table] = Array.from({ length: 1205 }, (_, i) => ({ id: `${table}${i}`, company_id: 'A', name: 'Same' }))
    const lists = await Promise.all([fetchAccounts('A'), fetchItems('A'), fetchParties('A')])
    expect(lists.map(rows => rows.length)).toEqual([1205, 1205, 1205])
  })
})
