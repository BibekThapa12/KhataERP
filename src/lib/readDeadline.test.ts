import { afterEach, describe, expect, it, vi } from 'vitest'
import { withReadDeadline } from './readDeadline'

afterEach(() => { vi.useRealTimers() })
describe('read deadlines', () => {
  it('rejects and aborts a hung request rather than leaving the loader pending', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const request = withReadDeadline('vouchers', s => { signal = s; return new Promise(() => {}) }, 100)
    const check = expect(request).rejects.toThrow('Company data read timed out: vouchers')
    await vi.advanceTimersByTimeAsync(100)
    await check
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans up the deadline for success and for an ordinary failure', async () => {
    vi.useFakeTimers()
    await expect(withReadDeadline('items', async () => [1])).resolves.toEqual([1])
    await expect(withReadDeadline('items', async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(vi.getTimerCount()).toBe(0)
  })
})
