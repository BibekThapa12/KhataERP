import { describe, expect, it } from 'vitest'
import type { CompanyModule, Item } from '@/types'
import { buildSalesVoucherData } from './engine'
import { addPosItem, exclusiveDiscount, findPosItemByCode, posModuleAccess, posTotals, setPosLineQty, toInvoiceItems, type PosLine } from './pos'

const item = (id: string, overrides: Partial<Item> = {}): Item => ({ id, company_id: 'A', name: id, unit: 'pcs', sell_rate: 100, opening_qty: 0, opening_rate: 0, ...overrides })
const stock = (qty: number) => () => qty
const line = (item_id: string, qty: number, shelf_rate: number): PosLine => ({ item_id, name: item_id, qty, shelf_rate })

describe('findPosItemByCode', () => {
  it('exact barcode wins over name matches', () => {
    const items = [item('pack', { name: 'Sugar 111 pack' }), item('sugar', { name: 'Sugar', barcode: '111' })]
    expect(findPosItemByCode(items, ' 111 ')?.name).toBe('Sugar')
  })

  it('falls back to exact SKU', () => {
    expect(findPosItemByCode([item('tea', { sku: 'TEA-1' })], 'tea-1')?.id).toBe('tea')
  })

  it('ignores archived items', () => {
    expect(findPosItemByCode([item('old', { barcode: '999', is_archived: true })], '999')).toBeUndefined()
  })
})

describe('addPosItem', () => {
  it('merges a repeated scan into one line', () => {
    const coke = item('coke', { sell_rate: 70 })
    const first = addPosItem([], coke, stock(10))
    if (!first.ok) throw new Error(first.error)
    const second = addPosItem(first.lines, coke, stock(10))
    expect(second).toEqual({ ok: true, lines: [{ item_id: 'coke', name: 'coke', qty: 2, shelf_rate: 70 }] })
  })

  it('blocks when merged qty exceeds stock', () => {
    const coke = item('coke')
    const first = addPosItem([], coke, stock(1))
    if (!first.ok) throw new Error(first.error)
    const second = addPosItem(first.lines, coke, stock(1))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.startsWith('Not enough stock for "')).toBe(true)
  })

  it('skips the stock check for services', () => {
    expect(addPosItem([], item('delivery', { is_service: true }), stock(0)).ok).toBe(true)
  })

  it('refuses serialized items', () => {
    expect(addPosItem([], item('phone', { is_serialized: true }), stock(5))).toEqual({ ok: false, error: 'Sell serialized items from the Sales Invoice' })
  })
})

describe('setPosLineQty', () => {
  it('removes a line when qty set to 0', () => {
    expect(setPosLineQty([line('coke', 2, 70)], 'coke', 0, item('coke'), stock(10))).toEqual({ ok: true, lines: [] })
  })

  it('blocks a qty above stock', () => {
    expect(setPosLineQty([line('coke', 2, 70)], 'coke', 5, item('coke'), stock(3)).ok).toBe(false)
  })
})

describe('posModuleAccess', () => {
  const today = '2026-10-28'
  const entitlement = (overrides: Partial<CompanyModule> = {}, key = 'pos_counter'): CompanyModule => ({ id: 'e', company_id: 'A', module_id: 'm', is_enabled: true, status: 'active', billing_type: 'included', price: 0, payment_status: 'pending', settings: {}, module: { id: 'm', key, name: 'POS Counter', default_price: 0, is_active: true }, ...overrides })

  it('is off without an entitlement', () => {
    expect(posModuleAccess(undefined, today)).toEqual({ enabled: false, reason: 'POS Counter is not enabled for this company.' })
  })

  it('is on for an active included module', () => {
    expect(posModuleAccess(entitlement(), today).enabled).toBe(true)
  })

  it('is off when read-only', () => {
    expect(posModuleAccess(entitlement({ status: 'read_only' }), today).enabled).toBe(false)
  })

  it('is off once expired', () => {
    expect(posModuleAccess(entitlement({ expires_at: '2026-10-27' }), today)).toEqual({ enabled: false, reason: 'The module has expired.' })
  })

  it('ignores a cheque entitlement', () => {
    expect(posModuleAccess(entitlement({}, 'cheque_management'), today).enabled).toBe(false)
  })
})

describe('posTotals', () => {
  it('keeps total within a paisa of shelf prices', () => {
    const lines = [line('a', 3, 33), line('b', 1.5, 17.5), line('c', 1, 113)]
    const shelf = 33 * 3 + 17.5 * 1.5 + 113 - 10
    const totals = posTotals(lines, 10, 13)
    expect(Math.abs(totals.total - shelf)).toBeLessThanOrEqual(0.01)
    const voucher = buildSalesVoucherData({ party_account_id: null, is_cash: true, items: toInvoiceItems(lines, 13), discount: exclusiveDiscount(10, 13), vat_rate: 13 })
    expect(voucher.total).toBe(totals.total)
  })

  it('no VAT conversion when VAT disabled', () => {
    const lines = [line('a', 3, 33), line('b', 1.5, 17.5)]
    expect(toInvoiceItems(lines, 0).map(entry => entry.rate)).toEqual([33, 17.5])
    expect(posTotals(lines, 5, 0).total).toBe(33 * 3 + 17.5 * 1.5 - 5)
  })
})
