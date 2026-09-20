import { describe, expect, it, vi } from 'vitest'
import { ReconciliationQueue } from './reconciliationQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('reconciliation queue', () => {
  it('coalesces requests and discards a read started before the latest commit', async () => {
    const queue = new ReconciliationQueue()
    const first = deferred<() => void>()
    const stale = vi.fn(), current = vi.fn(), error = vi.fn()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(current)
    const a = queue.request('user:company', read, error)
    const b = queue.request('user:company', read, error)
    expect(a).toBe(b)
    first.resolve(stale)
    await a
    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
  })
  it('does not let an obsolete failure clobber a subsequent refresh', async () => {
    const queue = new ReconciliationQueue()
    const first = deferred<() => void>()
    const publish = vi.fn(), error = vi.fn()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(publish)
    const task = queue.request('A', read, error)
    queue.request('A', read, error)
    first.reject(new Error('old request failed'))
    await task
    expect(error).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledOnce()
  })
  it('separates company identities and reports a failure without retrying any write', async () => {
    const queue = new ReconciliationQueue()
    const slow = deferred<() => void>()
    const a = vi.fn(), b = vi.fn(), error = vi.fn()
    const task = queue.request('A', () => slow.promise, error)
    await queue.request('B', async () => b, error)
    expect(b).toHaveBeenCalledOnce()
    expect(a).not.toHaveBeenCalled()
    slow.resolve(a)
    await task
    await queue.request('A', async () => { throw new Error('offline') }, error)
    expect(error).toHaveBeenCalledOnce()
  })
})
