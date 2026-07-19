import { describe, expect, it } from 'vitest'
import { SubmissionLock } from './submissionLock'

describe('submission lock', () => {
  it('rejects duplicates until the active request finishes', () => {
    const lock = new SubmissionLock()
    expect(lock.tryAcquire()).toBe(true)
    expect(lock.tryAcquire()).toBe(false)
    expect(lock.locked).toBe(true)
    lock.release()
    expect(lock.tryAcquire()).toBe(true)
  })
})
