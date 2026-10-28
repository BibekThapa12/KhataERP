import { describe, expect, it } from 'vitest'
import type { CompanyModule, Item, Voucher } from '@/types'
import { buildSalesVoucherData } from './engine'
import { addPosItem, checkTendered, exclusiveDiscount, findPosItemByCode, posBillDate, posCustomerName, posModuleAccess, posNarration, posTotals, qtyFromInput, receiptLinesFromVoucher, recentPosBills, setPosLineQty, toInvoiceItems, type PosLine } from './pos'

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

describe('checkTendered', () => {
  it('accepts the exact displayed amount when the total has sub-paisa drift', () => {
    const total = posTotals([line('a', 3, 1)], 0, 13).total
    expect(total).not.toBe(3)
    expect(checkTendered('3', total)).toEqual({ tendered: 3, change: 0 })
  })

  it('treats an empty box as exact', () => {
    expect(checkTendered('', 99.004)).toEqual({ change: 0 })
  })

  it('refuses less than the total', () => {
    expect(checkTendered('98', 99)).toEqual({ error: 'Tendered is less than the total' })
  })

  it('refuses a scanned barcode typed into tendered', () => {
    expect(checkTendered('8901725121259', 99).error).toBe('That amount looks like a barcode. Check the tendered amount.')
  })
})

describe('qtyFromInput', () => {
  it('ignores text that is still being typed', () => {
    expect(['', '0', '0.', '1.', '-', 'abc'].map(qtyFromInput)).toEqual([null, null, null, null, null, null])
  })

  it('reads a finished positive quantity', () => {
    expect(['12', '0.5', '1.25'].map(qtyFromInput)).toEqual([12, 0.5, 1.25])
  })
})

describe('posBillDate', () => {
  it('uses today inside the selected fiscal year', () => {
    expect(posBillDate('2083-07-10', '2083-04-01')).toEqual({ dateBs: '2083-07-10' })
  })

  it('refuses to back-date into a different fiscal year', () => {
    expect(posBillDate('2083-07-10', '2082-04-01')).toEqual({ error: 'Today is outside the fiscal year selected in KhataERP. Switch to the current fiscal year first.' })
  })
})

describe('recentPosBills', () => {
  const bill = (id: string, overrides: Partial<Voucher> = {}) => ({ id, type: 'Sales', status: 'Completed', narration: 'POS', date_bs: '2083-07-10', seq: Number(id), total: 1, cancelled: false, ...overrides }) as Voucher

  it('lists today\'s POS bills newest first, including cancelled ones', () => {
    const vouchers = [bill('1'), bill('3', { cancelled: true }), bill('2'), bill('4', { narration: 'Counter sale' }), bill('5', { date_bs: '2083-07-09' }), bill('6', { status: 'Draft' }), bill('7', { type: 'Purchase' })]
    expect(recentPosBills(vouchers, '2083-07-10').map(entry => entry.id)).toEqual(['3', '2', '1'])
  })

  it('includes bills that carry a customer name', () => {
    expect(recentPosBills([bill('1', { narration: 'POS · Ram Sharma' })], '2083-07-10').map(entry => entry.id)).toEqual(['1'])
  })

  it('keeps only the newest ten', () => {
    expect(recentPosBills(Array.from({ length: 12 }, (_, index) => bill(String(index + 1))), '2083-07-10')).toHaveLength(10)
  })
})

describe('POS customer name in the bill note', () => {
  it('writes and reads back a walk-in customer name', () => {
    expect(posNarration('  Ram   Sharma ')).toBe('POS · Ram Sharma')
    expect(posCustomerName('POS · Ram Sharma')).toBe('Ram Sharma')
  })

  it('stays plain POS without a name', () => {
    expect(posNarration('   ')).toBe('POS')
    expect(posCustomerName('POS')).toBeUndefined()
    expect(posCustomerName('Counter sale')).toBeUndefined()
  })

  it('caps the name at 80 characters', () => {
    expect(posCustomerName(posNarration('x'.repeat(120)))).toHaveLength(80)
  })
})

describe('receiptLinesFromVoucher', () => {
  it('turns saved exclusive rates back into shelf prices', () => {
    const voucher = { vat_rate: 13, invoice_items: [{ item_id: 'coke', item_name: 'Coke 500ml', qty: 2, rate: 61.946903 }] } as Voucher
    expect(receiptLinesFromVoucher(voucher, () => 'unused')).toEqual([{ name: 'Coke 500ml', qty: 2, shelf_rate: 70 }])
  })

  it('falls back to the item name lookup and keeps rates when VAT is 0', () => {
    const voucher = { vat_rate: 0, invoice_items: [{ item_id: 'tea', qty: 1, rate: 25 }] } as Voucher
    expect(receiptLinesFromVoucher(voucher, id => `Item ${id}`)).toEqual([{ name: 'Item tea', qty: 1, shelf_rate: 25 }])
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
