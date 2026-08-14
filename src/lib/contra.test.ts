import { describe, expect, it } from 'vitest'
import { buildContraLines } from './contra'
import type { Account, AccountCategory } from '@/types'

const categories = [
  { id: 'cash-cat', company_id: 'co', name: 'Cash-in-Hand', account_type: 'Asset', is_archived: false },
  { id: 'bank-cat', company_id: 'co', name: 'Bank Accounts', account_type: 'Asset', is_archived: false },
  { id: 'od-cat', company_id: 'co', name: 'Bank OD A/c', account_type: 'Liability', is_archived: false },
  { id: 'expense-cat', company_id: 'co', name: 'Indirect Expenses', account_type: 'Expense', is_archived: false },
] as AccountCategory[]
const account = (id: string, type: Account['type'], category_id: string): Account => ({ id, company_id: 'co', name: id, type, group: '', category_id, is_system: false, is_party: false, is_archived: false, opening_balance: 0, balance: 0 })
const accounts = [account('co:cash', 'Asset', 'cash-cat'), account('bank-a', 'Asset', 'bank-cat'), account('bank-b', 'Asset', 'bank-cat'), account('od', 'Liability', 'od-cat'), account('co:bank_charges', 'Expense', 'expense-cat')]

describe('buildContraLines', () => {
  it('moves the exact amount between Cash and Bank', () => {
    expect(buildContraLines({ source_account_id: 'co:cash', destination_account_id: 'bank-a', amount: 500, charge_amount: 0 }, accounts, categories, 'co', 'co:bank_charges')).toEqual([
      { account_id: 'bank-a', debit: 500, credit: 0 },
      { account_id: 'co:cash', debit: 0, credit: 500 },
    ])
  })
  it('adds the charge to the source credit while destination receives the full amount', () => {
    expect(buildContraLines({ source_account_id: 'bank-a', destination_account_id: 'bank-b', amount: 1000, charge_amount: 25 }, accounts, categories, 'co', 'co:bank_charges')).toEqual([
      { account_id: 'bank-b', debit: 1000, credit: 0 },
      { account_id: 'co:bank_charges', debit: 25, credit: 0 },
      { account_id: 'bank-a', debit: 0, credit: 1025 },
    ])
  })
  it('rounds transfer and charge values to ledger precision', () => {
    expect(buildContraLines({ source_account_id: 'bank-a', destination_account_id: 'bank-b', amount: 10.005, charge_amount: 0.005 }, accounts, categories, 'co', 'co:bank_charges')).toEqual([
      { account_id: 'bank-b', debit: 10.005, credit: 0 },
      { account_id: 'co:bank_charges', debit: 0.005, credit: 0 },
      { account_id: 'bank-a', debit: 0, credit: 10.01 },
    ])
  })
  it('supports Bank OD and rejects invalid transfers', () => {
    expect(buildContraLines({ source_account_id: 'od', destination_account_id: 'co:cash', amount: 100, charge_amount: 0 }, accounts, categories, 'co', 'co:bank_charges')).toHaveLength(2)
    expect(() => buildContraLines({ source_account_id: 'bank-a', destination_account_id: 'bank-a', amount: 1, charge_amount: 0 }, accounts, categories, 'co', 'co:bank_charges')).toThrow(/different/i)
    expect(() => buildContraLines({ source_account_id: 'bank-a', destination_account_id: 'bank-b', amount: 0, charge_amount: 0 }, accounts, categories, 'co', 'co:bank_charges')).toThrow(/positive/i)
    expect(() => buildContraLines({ source_account_id: 'bank-a', destination_account_id: 'bank-b', amount: 1, charge_amount: -1 }, accounts, categories, 'co', 'co:bank_charges')).toThrow(/negative/i)
  })
})
