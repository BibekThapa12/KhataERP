import { describe, expect, it } from 'vitest'
import { checkAccountingIntegrity, type IntegrityData } from './accountingIntegrity'
import { bsToAd, makeBsKey } from './nepaliDate'
import type { Voucher } from '@/types'

const date = '2083-01-01'
const voucher = (patch: Partial<Voucher> = {}): Voucher => ({
  id: 'v', company_id: 'c', type: 'Sales', date: bsToAd(date), date_ad: bsToAd(date), date_bs: date, date_bs_key: makeBsKey(date),
  seq: 1, status: 'Completed', cancelled: false, is_cash: false, total: 0, subtotal: 0, vat_amount: 0, discount: 0,
  lines: [], stock_lines: [], settlements: [], invoice_items: [{ id: 'l', voucher_id: 'v', item_id: 'i', qty: 1, rate: 0, amount: 0 }], ...patch,
})
const data = (vouchers: Voucher[], service = true): IntegrityData => ({
  company: { id: 'c', inventory_valuation_method: 'weighted_average' } as IntegrityData['company'], rawAccounts: [], parties: [],
  items: [{ id: 'i', company_id: 'c', name: 'Item', unit: 'pcs', is_service: service, opening_qty: 0, opening_rate: 0 }] as IntegrityData['items'], vouchers,
})

describe('read-only accounting integrity', () => {
  it('preserves valid zero-value and service invoice lines', () => {
    const input = data([voucher()])
    const before = JSON.stringify(input)
    const report = checkAccountingIntegrity(input, ['v'])
    expect(report.anomalies.map(a => a.check)).toEqual(['database_manifest_unavailable'])
    expect(JSON.stringify(input)).toBe(before)
  })
  it('reports missing stock for goods but not cancelled or draft vouchers', () => {
    const report = checkAccountingIntegrity(data([voucher()], false), ['v'])
    expect(report.anomalies.some(a => a.check === 'stock_quantity')).toBe(true)
    for (const v of [voucher({ cancelled: true }), voucher({ status: 'Draft', draft_payload: { lines: [] } })]) {
      expect(checkAccountingIntegrity(data([v], false), ['v']).anomalies.some(a => a.check === 'stock_quantity')).toBe(false)
    }
  })
  it('allows non-restocking sales returns', () => {
    const report = checkAccountingIntegrity(data([voucher({ type: 'Sales Return', restock_items: false })], false), ['v'])
    expect(report.anomalies.some(a => a.check === 'stock_quantity')).toBe(false)
  })
  it('uses existing alternate-unit conversion when a legacy base_qty snapshot is absent', () => {
    const report = checkAccountingIntegrity(data([voucher({
      invoice_items: [{ id: 'l', voucher_id: 'v', item_id: 'i', qty: 24, conversion_factor: 24, rate: 0, amount: 0 }],
      stock_lines: [{ id: 's', voucher_id: 'v', item_id: 'i', qty: 1, rate: 0, direction: 'out' }],
    })], false), ['v'])
    expect(report.anomalies.some(a => a.check === 'stock_quantity')).toBe(false)
  })
  it('reports evidence for absent IDs without assuming an RLS exclusion is deletion', () => {
    const report = checkAccountingIntegrity(data([voucher()]), [], {
      company_id: 'c', checked_at: '', counts: { vouchers: 2 }, voucher_ids: ['v', 'missing'], latest_voucher_update: null,
    })
    expect(report.anomalies.some(a => a.check === 'api_not_in_client' && a.voucher_id === 'v')).toBe(true)
    expect(report.anomalies.find(a => a.check === 'database_not_in_api')?.evidence).toMatchObject({ id: 'missing' })
  })
  it('distinguishes unavailable children from a legitimate empty array', () => {
    const report = checkAccountingIntegrity(data([voucher({ lines: undefined })]), ['v'])
    expect(report.anomalies.some(a => a.check === 'children_unavailable' && a.severity === 'unavailable')).toBe(true)
  })
  it('flags ledger imbalance, invalid references, and invalid dates', () => {
    const report = checkAccountingIntegrity(data([voucher({ date_bs: 'invalid', lines: [{ id: 'l', voucher_id: 'wrong', account_id: 'absent', debit: 1, credit: 0 }] })]), ['v'])
    expect(report.anomalies.map(a => a.check)).toEqual(expect.arrayContaining(['invalid_date', 'unbalanced_ledger', 'ledger_reference']))
  })
})
