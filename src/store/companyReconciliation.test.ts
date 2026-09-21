import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Company, Voucher } from '@/types'

const mocks = vi.hoisted(() => ({
  fetchMyCompanies: vi.fn(), fetchCompanySnapshot: vi.fn(), setActiveCompanyRemote: vi.fn(),
  insertDraftVoucher: vi.fn(), fetchCompanyModules: vi.fn(), fetchCompanyPermissions: vi.fn(), fetchVoucherBundles: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ ...mocks }))
vi.mock('@/lib/companySnapshot', () => ({ fetchCompanySnapshot: mocks.fetchCompanySnapshot }))
vi.mock('@/lib/notifications', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }))
import { useAppStore } from './useAppStore'

const company = (id: string) => ({ id, name: id, user_id: 'user', fiscal_year_configured: true, fiscal_year_start: '2026-07-17' }) as Company
const snapshot = (id: string) => ({ rawAccounts: [], accounts: [], parties: [], items: [], accountCategories: [], itemCategories: [], pricingRules: [], stock: [], vouchers: [{ id: `${id}-voucher`, company_id: id }] as Voucher[] })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.getState().setUserId(null)
  useAppStore.getState().setUserId('user')
  useAppStore.setState({ company: company('A'), activeCompanyId: 'A', ...snapshot('A'), dataReady: true, dataStale: false, error: null })
  mocks.fetchCompanyModules.mockResolvedValue([])
  mocks.fetchCompanyPermissions.mockResolvedValue([])
})

describe('company-scoped accounting publication', () => {
  it('exits initial loading with a retryable error when accounting history never responds', async () => {
    vi.useFakeTimers()
    try {
      useAppStore.setState({ dataReady: false })
      mocks.fetchMyCompanies.mockResolvedValueOnce({ active_company_id: 'A', memberships: [{ company_id: 'A', company: company('A') }], license: null })
      mocks.fetchCompanySnapshot.mockReturnValueOnce(new Promise(() => {}))
      const task = useAppStore.getState().loadAll('user')
      await vi.advanceTimersByTimeAsync(120_001)
      await task
      expect(useAppStore.getState().loading).toBe(false)
      expect(useAppStore.getState().dataReady).toBe(false)
      expect(useAppStore.getState().error).toContain('too long to load')
    } finally { vi.useRealTimers() }
  })
  it('shares the first hydration after company discovery and on focus/reconnect', async () => {
    useAppStore.setState({ company: null, activeCompanyId: null, dataReady: false })
    const waiting = deferred<ReturnType<typeof snapshot>>()
    mocks.fetchMyCompanies.mockResolvedValueOnce({ active_company_id: 'A', memberships: [{ company_id: 'A', company: company('A') }], license: null })
    mocks.fetchCompanySnapshot.mockReturnValueOnce(waiting.promise)
    const first = useAppStore.getState().loadAll('user')
    await vi.waitFor(() => expect(mocks.fetchCompanySnapshot).toHaveBeenCalledTimes(1))
    expect(useAppStore.getState().loadAll('user')).toBe(first)
    expect(useAppStore.getState().reconcileCompany('A')).toBe(first)
    waiting.resolve(snapshot('A'))
    await first
    expect(mocks.fetchMyCompanies).toHaveBeenCalledTimes(1)
    expect(mocks.fetchCompanySnapshot).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().dataReady).toBe(true)
  })
  it('shares a pending background read instead of invalidating it on every focus event', async () => {
    const waiting = deferred<ReturnType<typeof snapshot>>()
    mocks.fetchCompanySnapshot.mockReturnValueOnce(waiting.promise)
    const first = useAppStore.getState().reconcileCompany('A')
    expect(useAppStore.getState().reconcileCompany('A')).toBe(first)
    waiting.resolve(snapshot('A'))
    await first
    expect(mocks.fetchCompanySnapshot).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().dataStale).toBe(false)
  })
  it('ignores a failed load after logout', async () => {
    const old = deferred<never>()
    mocks.fetchMyCompanies.mockReturnValueOnce(old.promise)
    const task = useAppStore.getState().loadAll('user')
    useAppStore.getState().setUserId(null)
    old.reject(new Error('old failure'))
    await task
    expect(useAppStore.getState()).toMatchObject({ userId: null, company: null, error: null, vouchers: [] })
  })
  it('does not publish company A into company B after a delayed reconciliation', async () => {
    const old = deferred<ReturnType<typeof snapshot>>()
    mocks.fetchCompanySnapshot.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot('B'))
    const a = useAppStore.getState().reconcileCompany('A')
    mocks.setActiveCompanyRemote.mockResolvedValueOnce(company('B'))
    mocks.fetchMyCompanies.mockResolvedValueOnce({ active_company_id: 'B', memberships: [{ company_id: 'B', company: company('B') }], license: null })
    await useAppStore.getState().switchCompany('B')
    old.resolve(snapshot('A'))
    await a
    expect(useAppStore.getState().vouchers[0].company_id).toBe('B')
    expect(useAppStore.getState().dataStale).toBe(false)
  })
  it('guards obsolete same-company errors after a newer committed refresh', async () => {
    const old = deferred<ReturnType<typeof snapshot>>()
    mocks.fetchMyCompanies.mockResolvedValueOnce({ active_company_id: 'A', memberships: [{ company_id: 'A', company: company('A') }], license: null })
    mocks.fetchCompanySnapshot.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot('new'))
    const loading = useAppStore.getState().loadAll('user')
    await vi.waitFor(() => expect(mocks.fetchCompanySnapshot).toHaveBeenCalledTimes(1))
    await useAppStore.getState().reconcileCompany('A', true)
    old.reject(new Error('old page failed'))
    await loading
    expect(useAppStore.getState().error).toBeNull()
    expect(useAppStore.getState().vouchers[0].id).toBe('new-voucher')
  })
  it('retains the old complete snapshot on a failed post-commit read, then retries only reads', async () => {
    vi.useFakeTimers()
    try {
      mocks.fetchCompanySnapshot.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot('fresh'))
      await useAppStore.getState().reconcileCompany('A', true)
      expect(useAppStore.getState().error).toContain('Saved, refresh pending')
      expect(useAppStore.getState().vouchers[0].id).toBe('A-voucher')
      expect(useAppStore.getState().dataStale).toBe(true)
      await vi.advanceTimersByTimeAsync(2000)
      expect(useAppStore.getState().dataStale).toBe(false)
      expect(mocks.insertDraftVoucher).not.toHaveBeenCalled()
      expect(mocks.fetchCompanySnapshot).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
  it('publishes a saved draft without blocking on a full-company snapshot', async () => {
    const saved = { id: 'draft', company_id: 'A', type: 'Sales', date: '2026-08-18', date_ad: '2026-08-18', date_bs: '2083-05-01', date_bs_key: 20830501, is_cash: false, total: 0, cancelled: false, status: 'Draft', seq: 2, draft_no: 'DRAFT-0001', lines: [], stock_lines: [], invoice_items: [], settlements: [] } as Voucher
    mocks.insertDraftVoucher.mockResolvedValueOnce(saved)
    await useAppStore.getState().saveDraftVoucher({ type: 'Sales', date_bs: '2083-05-01', draft_payload: {} })
    expect(useAppStore.getState().vouchers.some(voucher => voucher.id === saved.id)).toBe(true)
    expect(mocks.fetchCompanySnapshot).not.toHaveBeenCalled()
  })
})
