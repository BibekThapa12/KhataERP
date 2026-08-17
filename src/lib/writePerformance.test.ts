import { describe, expect, it } from 'vitest'
import { performanceCompanySizeBand } from './writePerformance'

describe('performanceCompanySizeBand', () => {
  it.each([
    [0, 'under_1k'], [999, 'under_1k'], [1000, '1k_10k'],
    [9999, '1k_10k'], [10000, '10k_50k'], [49999, '10k_50k'],
    [50000, '50k_100k'], [100000, '50k_100k'], [100001, 'over_100k'],
  ] as const)('classifies %s vouchers as %s', (size, expected) => {
    expect(performanceCompanySizeBand(size)).toBe(expected)
  })
})
