import { describe, expect, it } from 'vitest'
import { importedVoucherVatRate, normalizeImportedBsDate } from '@/lib/importData'

describe('voucher import B.S. dates', () => {
  it.each([
    ['2083-05-01', '2083-05-01'],
    ['2083.05.01', '2083-05-01'],
    ['2083/05/01', '2083-05-01'],
    ['20830501', '2083-05-01'],
  ])('normalizes %s without changing the stored date format', (input, expected) => {
    expect(normalizeImportedBsDate(input)).toBe(expected)
  })

  it('rejects an impossible B.S. date', () => {
    expect(normalizeImportedBsDate('2083.13.01')).toBeNull()
  })
})

describe('imported voucher VAT', () => {
  it('forces VAT to zero when company VAT mode is disabled', () => {
    expect(importedVoucherVatRate(false, 13)).toBe(0)
  })

  it('keeps the imported VAT rate when company VAT mode is enabled', () => {
    expect(importedVoucherVatRate(true, '13')).toBe(13)
  })
})
