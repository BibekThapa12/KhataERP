import { describe, expect, it } from 'vitest'
import {
  buildPaymentData, buildPurchaseVoucherData, buildReceiptData,
  buildSalesVoucherData, computeStockSummary, recomputeStock, validateBalanced,
} from './engine'
import type { Item, Voucher } from '@/types'
import { formatStockQuantity, fromBaseRate, toBaseQty, toBaseRate } from './units'

const accounts = { cash: 'c:cash', sales: 'c:sales', purchase: 'c:purchase', vat_payable: 'c:vatp', vat_receivable: 'c:vatr' }

describe('accounting engine integrity', () => {
  it('posts a VAT sale as a balanced journal', () => {
    const result = buildSalesVoucherData({ party_account_id: null, is_cash: true, items: [{ item_id: 'tea', qty: 2, rate: 100 }], discount: 10, vat_rate: 13, system_accounts: accounts })
    expect(result).toMatchObject({ subtotal: 200, discount: 10, vat_amount: 24.7, total: 214.7 })
    expect(validateBalanced(result.lines)).toMatchObject({ valid: true, total_debit: 214.7, total_credit: 214.7 })
  })

  it('posts purchases, receipts, and payments as balanced journals', () => {
    const purchase = buildPurchaseVoucherData({ party_account_id: 'supplier', is_cash: false, items: [{ item_id: 'tea', qty: 3, rate: 50 }], vat_rate: 13, system_accounts: accounts })
    expect(validateBalanced(purchase.lines).valid).toBe(true)
    expect(validateBalanced(buildReceiptData('customer', 500, 'cash').lines).valid).toBe(true)
    expect(validateBalanced(buildPaymentData('supplier', 300, 'cash').lines).valid).toBe(true)
  })

  it('maintains weighted-average stock cost and ignores cancelled vouchers', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 10 } as Item
    const voucher = (seq: number, cancelled: boolean, direction: 'in' | 'out', qty: number, rate: number) => ({ id: String(seq), company_id: 'c', type: 'Purchase', date: '2026-01-01', date_ad: '2026-01-01', date_bs: '2082-09-17', date_bs_key: 20820917, is_cash: true, total: 0, cancelled, seq, stock_lines: [{ item_id: 'tea', direction, qty, rate }] }) as Voucher
    const [stock] = recomputeStock([item], [voucher(1, false, 'in', 10, 20), voucher(2, false, 'out', 5, 999), voucher(3, true, 'in', 100, 1)])
    expect(stock).toMatchObject({ qty: 15, avg_cost: 15, value: 225 })
  })

  it('summarizes opening, inward, outward, and closing stock', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'pc', sell_rate: 0, opening_qty: 10, opening_rate: 10 } as Item
    const voucher = (seq: number, cancelled: boolean, direction: 'in' | 'out', qty: number, rate: number) => ({ id: String(seq), company_id: 'c', type: 'Purchase', date: '2026-01-01', date_ad: '2026-01-01', date_bs: '2082-09-17', date_bs_key: 20820917, is_cash: true, total: 0, cancelled, seq, stock_lines: [{ item_id: 'tea', direction, qty, rate }] }) as Voucher
    const [row] = computeStockSummary([item], [voucher(1, false, 'in', 10, 20), voucher(2, false, 'out', 5, 999), voucher(3, true, 'in', 100, 1)])
    expect(row).toMatchObject({
      opening_qty: 10, opening_value: 100,
      inward_qty: 10, inward_value: 200,
      outward_qty: 5, outward_value: 75,
      closing_qty: 15, closing_rate: 15, closing_value: 225,
    })
  })

  it('converts an alternative-unit invoice to canonical stock units', () => {
    const purchase = buildPurchaseVoucherData({ party_account_id: null, is_cash: true, items: [{ item_id: 'tea', qty: 12, rate: 100, entry_unit: 'pcs', conversion_factor: 12 }], vat_rate: 0, system_accounts: accounts })
    expect(purchase.subtotal).toBe(1200)
    expect(purchase.invoice_items[0]).toMatchObject({ qty: 12, rate: 100, entry_unit: 'pcs', conversion_factor: 12, base_qty: 1 })
    expect(purchase.stock_lines[0]).toMatchObject({ qty: 1, rate: 1200, direction: 'in' })
  })

  it('converts quantities and rates and formats equivalent stock', () => {
    const item = { id: 'tea', company_id: 'c', name: 'Tea', unit: 'cs', alternate_unit: 'pcs', alternate_conversion: 6, sell_rate: 600, opening_qty: 0, opening_rate: 0 } as Item
    expect(toBaseQty(15, 6)).toBe(2.5)
    expect(toBaseRate(100, 6)).toBe(600)
    expect(fromBaseRate(600, 6)).toBe(100)
    expect(formatStockQuantity(2.5, item)).toBe('2.5 cs (15 pcs)')
    expect(formatStockQuantity(4, item)).toBe('4 cs (24 pcs)')
  })
})
