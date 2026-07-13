import { describe, expect, it } from 'vitest'
import { addDaysToBs, bsToAd } from './nepaliDate'

describe('invoice due dates', () => {
  it('keeps the invoice date for zero credit days', () => {
    expect(addDaysToBs('2083-04-01', 0)).toBe('2083-04-01')
  })

  it('adds calendar days across Nepali month boundaries', () => {
    const invoiceAd = Date.parse(`${bsToAd('2083-04-25')}T00:00:00Z`)
    const dueAd = Date.parse(`${bsToAd(addDaysToBs('2083-04-25', 15))}T00:00:00Z`)
    expect((dueAd - invoiceAd) / 86_400_000).toBe(15)
  })
})
