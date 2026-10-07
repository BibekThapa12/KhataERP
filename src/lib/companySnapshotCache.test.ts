import { describe, expect, it, vi } from 'vitest'
import type { Company, Voucher } from '@/types'
import type { CompanySnapshot } from './companySnapshot'
import { isReusableCompanySnapshot, loadCompanySnapshotCached } from './companySnapshotCache'

const company = { id: 'A', name: 'A' } as Company
const snapshot = (companyId = 'A'): CompanySnapshot => ({
  rawAccounts: [], accounts: [], accountCategories: [], parties: [], items: [], itemCategories: [], pricingRules: [], stock: [],
  vouchers: [{ id: 'voucher', company_id: companyId }] as Voucher[],
})

function entry(dataVersion = '4', companyId = 'A') {
  return { key: `user:${companyId}`, formatVersion: 1, userId: 'user', companyId, dataVersion, savedAt: 1000, snapshot: snapshot(companyId) }
}

describe('company snapshot cache', () => {
  it('requires the same user, company, revision, and valid company scope', () => {
    expect(isReusableCompanySnapshot(entry(), 'user', 'A', '4', 2000)).toBe(true)
    expect(isReusableCompanySnapshot(entry(), 'other', 'A', '4', 2000)).toBe(false)
    expect(isReusableCompanySnapshot(entry(), 'user', 'A', '5', 2000)).toBe(false)
    expect(isReusableCompanySnapshot(entry('4', 'B'), 'user', 'A', '4', 2000)).toBe(false)
  })

  it('does not download a full snapshot when the cached revision matches', async () => {
    const fetchSnapshot = vi.fn()
    const result = await loadCompanySnapshotCached({
      userId: 'user', company, dataVersion: '4', now: 2000, fetchSnapshot,
      adapter: { read: vi.fn().mockResolvedValue(entry()), write: vi.fn() },
    })
    expect(result.source).toBe('cache')
    expect(fetchSnapshot).not.toHaveBeenCalled()
  })

  it('downloads and replaces the cache when the revision changed', async () => {
    const fresh = snapshot()
    const write = vi.fn()
    const result = await loadCompanySnapshotCached({
      userId: 'user', company, dataVersion: '5', now: 2000, fetchSnapshot: vi.fn().mockResolvedValue(fresh),
      adapter: { read: vi.fn().mockResolvedValue(entry('4')), write },
    })
    expect(result).toEqual({ snapshot: fresh, source: 'network' })
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ dataVersion: '5', companyId: 'A', snapshot: fresh }))
  })
})
