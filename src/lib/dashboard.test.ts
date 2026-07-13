import { describe, expect, it } from 'vitest'
import { buildDashboardSeries, createDashboardSeries, dashboardGrouping, dashboardVouchersInRange, isPostedDashboardVoucher, topSellingItems } from './dashboard'
import type { Item, Voucher } from '@/types'

const voucher = (id: string, type: Voucher['type'], date_bs: string, total: number, extras: Partial<Voucher> = {}) => ({
  id, company_id: 'c', type, date: '2026-07-13', date_ad: '2026-07-13', date_bs,
  date_bs_key: Number(date_bs.replaceAll('-', '')), is_cash: false, total, cancelled: false, seq: 1, ...extras,
}) as Voucher

describe('dashboard aggregation', () => {
  it('excludes cancelled and future workflow records', () => {
    expect(isPostedDashboardVoucher(voucher('a', 'Sales', '2083-03-29', 10))).toBe(true)
    expect(isPostedDashboardVoucher(voucher('b', 'Sales', '2083-03-29', 10, { cancelled: true }))).toBe(false)
    expect(isPostedDashboardVoucher({ ...voucher('c', 'Sales', '2083-03-29', 10), status: 'draft' } as Voucher)).toBe(false)
    expect(dashboardVouchersInRange([voucher('a', 'Sales', '2083-03-29', 10)], '2083-03-01', '2083-03-29')).toHaveLength(1)
  })

  it('chooses grouping from range length and nets returns', () => {
    expect(dashboardGrouping('2083-03-01', '2083-03-29')).toBe('daily')
    expect(dashboardGrouping('2083-01-01', '2083-03-29')).toBe('weekly')
    expect(dashboardGrouping('2082-04-01', '2083-03-29')).toBe('monthly')
    const result = buildDashboardSeries([
      voucher('s', 'Sales', '2083-03-29', 100),
      voucher('sr', 'Sales Return', '2083-03-29', 25),
      voucher('p', 'Purchase', '2083-03-29', 60),
    ], [{ voucher: voucher('r', 'Receipt', '2083-03-29', 40), amount: 40 }], '2083-03-29', '2083-03-29')
    expect(result.points[0]).toMatchObject({ sales: 75, purchases: 60, inflow: 40, net: 40 })
    expect(createDashboardSeries('2083-', '2083-03-29').points).toEqual([])
  })

  it('ranks sold base quantities and subtracts returns', () => {
    const items = [{ id: 'tea', name: 'Tea', unit: 'Pcs' }, { id: 'rice', name: 'Rice', unit: 'Kg' }] as Item[]
    const sales = voucher('s', 'Sales', '2083-03-29', 100, { invoice_items: [{ item_id: 'tea', qty: 2, rate: 10, base_qty: 12 }, { item_id: 'rice', qty: 4, rate: 10 }] })
    const returned = voucher('r', 'Sales Return', '2083-03-29', 20, { invoice_items: [{ item_id: 'tea', qty: 1, rate: 10, base_qty: 2 }] })
    expect(topSellingItems([sales, returned], items, '2083-03-01', '2083-03-29').map(row => [row.itemId, row.qty])).toEqual([['tea', 10], ['rice', 4]])
  })
})
