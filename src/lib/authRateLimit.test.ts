import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLoginFailures, getLoginThrottle, recordInvalidLogin } from '@/lib/authRateLimit'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('invalid credential throttle', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    vi.stubGlobal('window', { sessionStorage: memoryStorage() })
  })

  afterEach(() => vi.restoreAllMocks())

  it('locks for one minute only after the fifth invalid credential response', () => {
    for (let attempt = 1; attempt < 5; attempt += 1) expect(recordInvalidLogin().allowed).toBe(true)
    expect(recordInvalidLogin()).toEqual({ allowed: false, retryAfterSeconds: 60 })
    expect(getLoginThrottle()).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it('allows login after the timer expires or the failures are cleared', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordInvalidLogin()
    vi.spyOn(Date, 'now').mockReturnValue(1_061_000)
    expect(getLoginThrottle()).toEqual({ allowed: true, retryAfterSeconds: 0 })
    recordInvalidLogin()
    clearLoginFailures()
    expect(getLoginThrottle().allowed).toBe(true)
  })
})
