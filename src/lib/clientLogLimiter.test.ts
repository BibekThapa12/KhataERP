import { describe, expect, it } from 'vitest'
import { ClientLogLimiter } from './clientLogLimiter'

describe('ClientLogLimiter', () => {
  it('deduplicates the same error during the cooldown', () => {
    const limiter = new ClientLogLimiter(1000, 10)
    expect(limiter.shouldAccept('timeout', 1000)).toBe(true)
    expect(limiter.shouldAccept('timeout', 1500)).toBe(false)
    expect(limiter.shouldAccept('timeout', 2000)).toBe(true)
  })

  it('caps total error ingestion for one browser session', () => {
    const limiter = new ClientLogLimiter(1000, 2)
    expect(limiter.shouldAccept('first', 1000)).toBe(true)
    expect(limiter.shouldAccept('second', 1000)).toBe(true)
    expect(limiter.shouldAccept('third', 1000)).toBe(false)
  })
})
