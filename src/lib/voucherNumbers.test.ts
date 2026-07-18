import { describe, expect, it } from 'vitest'
import { previewNextVoucherNumber, savedVoucherNumber, voucherNumberingPeriod, voucherNumberingScope, voucherPrefix } from '@/lib/voucherNumbers'
import { DEFAULT_FISCAL_YEAR_START_AD } from '@/lib/nepaliDate'
import type { Company, Voucher } from '@/types'

const company = { id: 'c', sales_prefix: 'SI-', purchase_prefix: 'PI-' } as Company

const voucher = (type: Voucher['type'], invoiceNo: string | undefined, seq = 1) => ({
  id: `${type}-${seq}`, company_id: 'c', type, invoice_no: invoiceNo, seq,
  date_bs: '2083-04-01', date_bs_key: 20830401,
} as Voucher)

describe('voucher numbering', () => {
  it('uses configured invoice prefixes and standard operational prefixes', () => {
    expect(voucherPrefix(company, 'Sales')).toBe('SI-')
    expect(voucherPrefix(company, 'Purchase')).toBe('PI-')
    expect(voucherPrefix(company, 'Journal')).toBe('JV-')
    expect(voucherPrefix(company, 'Stock Adjustment')).toBe('SA-')
  })

  it('previews the next number for each voucher type', () => {
    const vouchers = [voucher('Sales', 'SI-0004'), voucher('Sales', 'SI-0012', 2), voucher('Purchase', 'PI-0099', 3)]
    expect(previewNextVoucherNumber(company, vouchers, 'Sales', '2083-04-02')).toBe('SI-0013')
    expect(previewNextVoucherNumber(company, vouchers, 'Journal', '2083-04-02')).toBe('JV-0001')
  })

  it('falls back to sequence numbers for historical vouchers', () => {
    expect(savedVoucherNumber(voucher('Journal', undefined, 27))).toBe('27')
  })

  it('uses separate uniqueness periods when fiscal-year numbering is enabled', () => {
    const fiscalCompany = { ...company, reset_numbering_fiscal_year: true, fiscal_year_start: DEFAULT_FISCAL_YEAR_START_AD } as Company
    expect(voucherNumberingPeriod(fiscalCompany, '2083-03-30')).toBe('FY-2082')
    expect(voucherNumberingPeriod(fiscalCompany, '2083-04-01')).toBe('FY-2083')
    expect(voucherNumberingPeriod(company, '2083-04-01')).toBe('all')
    expect(voucherNumberingScope(fiscalCompany, 'Sales', '2083-03-30')).toEqual({
      prefix: 'SI-', resetByFiscalYear: true,
      periodStartKey: 20820401, nextPeriodStartKey: 20830401,
    })
    expect(voucherNumberingScope(company, 'Sales', '2083-04-01')).toEqual({
      prefix: 'SI-', resetByFiscalYear: false,
      periodStartKey: null, nextPeriodStartKey: null,
    })
  })
})
