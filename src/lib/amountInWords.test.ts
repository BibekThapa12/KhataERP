import { describe, expect, it } from 'vitest'
import { invoiceAmountInWords, nprAmountInWords } from './amountInWords'

describe('nprAmountInWords', () => {
  it('formats zero and whole rupee values without a paisa phrase', () => {
    expect(nprAmountInWords(0)).toBe('Zero Rupees Only.')
    expect(nprAmountInWords(12_000)).toBe('Twelve Thousand Rupees Only.')
  })

  it('formats paisa and rounds to the same two decimals used by invoice totals', () => {
    expect(nprAmountInWords(4_720.5)).toBe('Four Thousand Seven Hundred Twenty Rupees and Fifty Paisa Only.')
    expect(nprAmountInWords(99.999)).toBe('One Hundred Rupees Only.')
    expect(nprAmountInWords(1.004)).toBe('One Rupees Only.')
  })

  it('uses Nepal and Indian number grouping', () => {
    expect(nprAmountInWords(1_25_000.75)).toBe('One Lakh Twenty Five Thousand Rupees and Seventy Five Paisa Only.')
    expect(nprAmountInWords(12_34_56_789.01)).toBe('Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees and One Paisa Only.')
  })

  it('rejects invalid, negative, and unsafe values predictably', () => {
    expect(() => nprAmountInWords(Number.NaN)).toThrow(RangeError)
    expect(() => nprAmountInWords(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => nprAmountInWords(-1)).toThrow(RangeError)
    expect(() => nprAmountInWords(Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })

  it('is included only for invoice print types', () => {
    for (const type of ['Sales', 'Purchase', 'Sales Return', 'Purchase Return'] as const) {
      expect(invoiceAmountInWords(type, 100)).toBe('One Hundred Rupees Only.')
    }
    for (const type of ['Receipt', 'Payment', 'Journal', 'Stock Adjustment'] as const) {
      expect(invoiceAmountInWords(type, 100)).toBeNull()
    }
  })
})
