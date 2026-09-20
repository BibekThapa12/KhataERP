import { describe, expect, it } from 'vitest'
import { completeFetch } from './completeFetch'

describe('completeFetch', () => {
  it('loads beyond the server cap with identical ordering values', async () => {
    const all = Array.from({ length: 2501 }, (_, i) => ({ id: String(i), date: '2083-01-01' }))
    let calls = 0
    const actual = await completeFetch('vouchers', async (from, to) => {
      calls++
      return { data: all.slice(from, Math.min(to + 1, from + 73)), count: all.length, error: null }
    })
    expect(actual).toEqual(all)
    expect(calls).toBe(36)
  })
  it('distinguishes an empty dataset from unavailable data', async () => {
    await expect(completeFetch('rows', async () => ({ data: [], count: 0, error: null }))).resolves.toEqual([])
    await expect(completeFetch('rows', async () => ({ data: null, count: null, error: null }))).rejects.toThrow('unavailable')
  })
  it('propagates a failed later page instead of returning partial history', async () => {
    await expect(completeFetch('rows', async from => from === 0
      ? { data: [{ id: 'a' }], count: 2, error: null }
      : { data: null, count: null, error: new Error('network failed') })).rejects.toThrow('network failed')
  })
  it('does not stop on a short server-capped page and rejects duplicate IDs', async () => {
    const pages = [[{ id: 'a' }], [{ id: 'b' }], []]
    await expect(completeFetch('rows', async () => ({ data: pages.shift() || [], error: null }))).resolves.toEqual([{ id: 'a' }, { id: 'b' }])
    await expect(completeFetch('rows', async from => ({ data: [{ id: 'same' }], error: from ? null : null }))).rejects.toThrow('unstable pagination')
  })
})
