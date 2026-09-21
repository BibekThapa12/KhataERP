import { describe, expect, it } from 'vitest'
import type { Account, Company, Item, Voucher } from '@/types'
import { applyPersistedVoucher } from './voucherState'

const company = { id: 'company', inventory_valuation_method: 'weighted_average' } as Company
const cash = { id: 'cash', company_id: company.id, name: 'Cash', type: 'Asset', group: 'Cash', opening_balance: 0, balance: 0 } as Account
const sales = { id: 'sales', company_id: company.id, name: 'Sales', type: 'Income', group: 'Income', opening_balance: 0, balance: 0 } as Account
const item = { id: 'item', company_id: company.id, name: 'Item', unit: 'pcs', opening_qty: 0, opening_rate: 0 } as Item

function voucher(id: string, total: number, cancelled = false): Voucher {
  return {
    id, company_id: company.id, type: 'Sales', date: '2026-09-01', date_ad: '2026-09-01', date_bs: '2083-05-16',
    date_bs_key: 20830516, is_cash: true, total, cancelled, status: 'Completed', seq: 1,
    lines: [{ id: `${id}-cash`, voucher_id: id, account_id: cash.id, debit: total, credit: 0 }, { id: `${id}-sales`, voucher_id: id, account_id: sales.id, debit: 0, credit: total }],
    stock_lines: [{ id: `${id}-stock`, voucher_id: id, item_id: item.id, qty: 1, rate: total, direction: 'out' }],
    invoice_items: [], settlements: [],
  }
}

const state = { rawAccounts: [cash, sales], accounts: [cash, sales], items: [item], stock: [{ id: item.id, name: item.name, unit: item.unit, qty: 0, avg_cost: 0, value: 0 }], vouchers: [] }

describe('applyPersistedVoucher', () => {
  it('adds an authoritative voucher and recomputes only its accounting effects', () => {
    const result = applyPersistedVoucher(state, company, voucher('v1', 100))
    expect(result.vouchers).toHaveLength(1)
    expect(result.accounts.find(account => account.id === cash.id)?.balance).toBe(100)
    expect(result.accounts.find(account => account.id === sales.id)?.balance).toBe(100)
  })

  it('replaces and cancels an existing voucher without duplicating it', () => {
    const first = applyPersistedVoucher(state, company, voucher('v1', 100))
    const replaced = applyPersistedVoucher({ ...state, ...first }, company, voucher('v1', 150))
    expect(replaced.vouchers).toHaveLength(1)
    expect(replaced.accounts.find(account => account.id === cash.id)?.balance).toBe(150)
    const cancelled = applyPersistedVoucher({ ...state, ...replaced }, company, voucher('v1', 150, true))
    expect(cancelled.accounts.find(account => account.id === cash.id)?.balance).toBe(0)
  })

  it('removes a draft without affecting completed balances', () => {
    const draft = { ...voucher('draft', 100), status: 'Draft' as const, lines: [], stock_lines: [] }
    const withDraft = { ...state, vouchers: [draft] }
    const result = applyPersistedVoucher(withDraft, company, null, draft.id)
    expect(result.vouchers).toEqual([])
    expect(result.accounts).toBe(withDraft.accounts)
  })

  it('rejects cross-company publication', () => {
    expect(() => applyPersistedVoucher(state, company, { ...voucher('foreign', 1), company_id: 'other' })).toThrow('active company')
  })
})
