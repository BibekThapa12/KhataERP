import { describe, expect, it } from 'vitest'
import type { Voucher } from '@/types'
import { sanitizeSettlementAllocations } from './settlementAllocations'

const voucher = (id: string, type: Voucher['type'], patch: Partial<Voucher> = {}) => ({
  id,
  company_id: 'company-a',
  type,
  date: '2026-09-01',
  date_ad: '2026-09-01',
  date_bs: '2083-05-16',
  date_bs_key: 20830516,
  total: 100,
  cancelled: false,
  status: 'Completed',
  seq: 1,
  lines: [],
  stock_lines: [],
  invoice_items: [],
  settlements: [],
  ...patch,
}) as Voucher

describe('sanitizeSettlementAllocations', () => {
  it('keeps active Sales allocations when editing a Receipt', () => {
    const result = sanitizeSettlementAllocations([
      { account_id: 'customer', amount: 100, invoice_allocations: [{ invoice_voucher_id: 'sales', amount: 100 }] },
    ], [voucher('sales', 'Sales')], 'company-a', 'Receipt')

    expect(result.removedCount).toBe(0)
    expect(result.allocations[0].invoice_allocations).toHaveLength(1)
  })

  it('removes invalid links without changing the ledger amount', () => {
    const result = sanitizeSettlementAllocations([
      {
        account_id: 'customer',
        amount: 500,
        invoice_allocations: [
          { invoice_voucher_id: 'cancelled', amount: 100 },
          { invoice_voucher_id: 'missing', amount: 100 },
          { invoice_voucher_id: 'other-company', amount: 100 },
          { invoice_voucher_id: 'draft', amount: 100 },
          { invoice_voucher_id: 'purchase', amount: 100 },
        ],
      },
    ], [
      voucher('cancelled', 'Sales', { cancelled: true }),
      voucher('other-company', 'Sales', { company_id: 'company-b' }),
      voucher('draft', 'Sales', { status: 'Draft' }),
      voucher('purchase', 'Purchase'),
    ], 'company-a', 'Receipt')

    expect(result.removedCount).toBe(5)
    expect(result.allocations[0].amount).toBe(500)
    expect(result.allocations[0].invoice_allocations).toEqual([])
  })

  it('keeps only active Purchase allocations for a Payment', () => {
    const result = sanitizeSettlementAllocations([
      { account_id: 'supplier', amount: 200, invoice_allocations: [
        { invoice_voucher_id: 'sales', amount: 100 },
        { invoice_voucher_id: 'purchase', amount: 100 },
      ] },
    ], [voucher('sales', 'Sales'), voucher('purchase', 'Purchase')], 'company-a', 'Payment')

    expect(result.removedCount).toBe(1)
    expect(result.allocations[0].invoice_allocations).toEqual([{ invoice_voucher_id: 'purchase', amount: 100 }])
  })
})
