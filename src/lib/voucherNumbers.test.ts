import { describe, expect, it } from 'vitest'
import { previewNextVoucherNumber, savedVoucherNumber, voucherPrefix } from '@/lib/voucherNumbers'
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
})
