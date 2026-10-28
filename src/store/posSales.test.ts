import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Company, Voucher } from '@/types'

const mocks = vi.hoisted(() => ({ insertVoucher: vi.fn(), updateVoucher: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ ...mocks, SessionExpiredError: class SessionExpiredError extends Error {} }))
vi.mock('@/lib/notifications', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }))
import { useAppStore } from './useAppStore'

const company = { id: 'A', name: 'A', user_id: 'user', fiscal_year_configured: true, fiscal_year_start: '2026-07-17', vat_enabled: true } as Company
const qrBill = { id: 'v1', company_id: 'A', type: 'Sales', status: 'Completed', is_cash: true, settlement_account_id: 'esewa', invoice_no: 'SI-1', date_bs: '2083-07-10', total: 113, cancelled: false, seq: 1, lines: [], stock_lines: [] } as unknown as Voucher

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.getState().setUserId('user')
  useAppStore.setState({ company, activeCompanyId: 'A', rawAccounts: [], accounts: [], items: [], stock: [], vouchers: [qrBill], dataReady: true, error: null })
})

describe('POS sales in the store', () => {
  it('refuses to edit a completed POS QR bill', async () => {
    await expect(useAppStore.getState().updateSalesVoucher('v1', { party_account_id: null, is_cash: true, items: [{ item_id: 'i1', qty: 1, rate: 100 }], vat_rate: 13, credit_days: 0, date_bs: '2083-07-10' }))
      .rejects.toThrow('POS QR bill. Cancel it and re-ring it at the POS.')
    expect(mocks.updateVoucher).not.toHaveBeenCalled()
  })
})
