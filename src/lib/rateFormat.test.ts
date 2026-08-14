import { describe, expect, it } from 'vitest'
import { formatRateInput, hasAtMostSixDecimalPlaces, rateInputNumber } from './rateFormat'

describe('six-decimal numeric input precision', () => {
  it('does not force two decimals or change entered precision', () => {
    expect(formatRateInput('1.234567')).toBe('1.234567')
    expect(formatRateInput('001.230000')).toBe('001.230000')
    expect(rateInputNumber('0.000001')).toBe(0.000001)
  })

  it('accepts up to six decimals and rejects finer values', () => {
    expect(hasAtMostSixDecimalPlaces('10')).toBe(true)
    expect(hasAtMostSixDecimalPlaces('10.123456')).toBe(true)
    expect(hasAtMostSixDecimalPlaces('10.1234567')).toBe(false)
    expect(hasAtMostSixDecimalPlaces('1e-6')).toBe(true)
    expect(hasAtMostSixDecimalPlaces('1e-7')).toBe(false)
  })
})
