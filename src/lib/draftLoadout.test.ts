import { describe, expect, it } from 'vitest'
import type { Item, Voucher } from '@/types'
import { buildDraftLoadoutSummary, formatDraftLoadoutQuantity } from './draftLoadout'

const item = (overrides: Partial<Item> = {}): Item => ({
  id: 'item-1', company_id: 'company-1', name: 'Cola', unit: 'ctn', alternate_unit: 'pcs', alternate_conversion: 12,
  sell_rate: 0, opening_qty: 0, opening_rate: 0, ...overrides,
})

const draft = (id: string, lines: Record<string, unknown>[], overrides: Partial<Voucher> = {}): Voucher => ({
  id, company_id: 'company-1', type: 'Sales', date: '2026-08-24', date_ad: '2026-08-24', date_bs: '2083-05-08',
  date_bs_key: 20830508, draft_no: id, is_cash: false, total: 0, cancelled: false, status: 'Draft', seq: 1,
  draft_payload: { lines }, ...overrides,
})

describe('buildDraftLoadoutSummary', () => {
  it('formats decimal main units as whole main units and remaining alternate units', () => {
    expect(formatDraftLoadoutQuantity({ itemId: '1', itemName: 'Drink', baseUnit: 'crate', alternateUnit: 'pcs', alternateConversion: 24, totalQuantity: 10.75, totalAmount: 0 })).toBe('10 crate 18 pcs')
    expect(formatDraftLoadoutQuantity({ itemId: '1', itemName: 'Drink', baseUnit: 'crate', alternateUnit: 'pcs', alternateConversion: 24, totalQuantity: 10.8333, totalAmount: 0 })).toBe('10 crate 20 pcs')
    expect(formatDraftLoadoutQuantity({ itemId: '1', itemName: 'Drink', baseUnit: 'crate', alternateUnit: 'pcs', alternateConversion: 24, totalQuantity: 0.5, totalAmount: 0 })).toBe('12 pcs')
  })
  it('aggregates identical items using saved amounts and base quantities', () => {
    const summary = buildDraftLoadoutSummary('company-1', [
      draft('D-1', [{ item_id: 'item-1', qty: 24, rate: 100, amount: 2300, conversion_factor: 12 }]),
      draft('D-2', [{ item_id: 'item-1', qty: 12, rate: 100, amount_input: '1100', conversion_factor: 12 }]),
    ], [item()])
    expect(summary.draftCount).toBe(2)
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0]).toMatchObject({ itemId: 'item-1', totalQuantity: 3, totalAmount: 3400 })
    expect(summary.grandTotalQuantity).toBe(3)
    expect(summary.grandTotalAmount).toBe(3400)
  })

  it('falls back to quantity times rate and retains zero-value lines', () => {
    const summary = buildDraftLoadoutSummary('company-1', [draft('D-1', [
      { item_id: 'item-1', qty: 2, rate: 75, conversion_factor: 1 },
      { item_id: 'item-2', qty: 5, rate: 50, amount: 0, conversion_factor: 1 },
    ])], [item(), item({ id: 'item-2', name: 'Free sample', unit: 'pcs', alternate_unit: null, alternate_conversion: null })])
    expect(summary.rows.map(row => [row.itemId, row.totalAmount])).toEqual([['item-1', 150], ['item-2', 0]])
  })

  it('excludes non-sales, cancelled, cross-company, malformed, missing-item, and service data', () => {
    const summary = buildDraftLoadoutSummary('company-1', [
      draft('valid', [{ item_id: 'item-1', qty: 1, rate: 10 }]),
      draft('cancelled', [{ item_id: 'item-1', qty: 10, rate: 10 }], { cancelled: true }),
      draft('purchase', [{ item_id: 'item-1', qty: 10, rate: 10 }], { type: 'Purchase' }),
      draft('foreign', [{ item_id: 'item-1', qty: 10, rate: 10 }], { company_id: 'company-2' }),
      draft('malformed', [], { draft_payload: {} }),
      draft('bad-lines', [{ item_id: 'missing', qty: 2, rate: 10 }, { item_id: 'service', qty: 1, rate: 50 }]),
    ], [item(), item({ id: 'service', name: 'Delivery', is_service: true })])
    expect(summary.draftCount).toBe(2)
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0].totalQuantity).toBe(1)
    expect(summary.warnings.map(warning => warning.voucherId)).toEqual(['malformed', 'bad-lines'])
  })

  it('handles large selections in one grouped result', () => {
    const drafts = Array.from({ length: 1000 }, (_, index) => draft(`D-${index}`, [{ item_id: 'item-1', qty: 12, amount: 1, conversion_factor: 12 }]))
    const summary = buildDraftLoadoutSummary('company-1', drafts, [item()])
    expect(summary.draftCount).toBe(1000)
    expect(summary.rows).toHaveLength(1)
    expect(summary.grandTotalQuantity).toBe(1000)
    expect(summary.grandTotalAmount).toBe(1000)
  })
})
