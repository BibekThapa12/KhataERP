import { describe, expect, it } from 'vitest'
import { buildSimpleEntryLines, voucherSimpleEntryType } from './simpleEntries'
import type { Account, AccountCategory } from '@/types'

const categories = [
  { id: 'income-category', company_id: 'company', name: 'Other Income', account_type: 'Income', parent_category_id: null, is_system: false, is_archived: false },
  { id: 'expense-category', company_id: 'company', name: 'Office Expense', account_type: 'Expense', parent_category_id: null, is_system: false, is_archived: false },
] as AccountCategory[]

const account = (id: string, type: Account['type'], category_id?: string): Account => ({
  id, company_id: 'company', name: id, type, group: type, category_id, is_system: false, is_party: false, is_archived: false, opening_balance: 0, balance: 0,
})
const accounts = [account('cash', 'Asset'), account('interest', 'Income', 'income-category'), account('rebate', 'Income', 'income-category'), account('rent', 'Expense', 'expense-category')] as Account[]

describe('buildSimpleEntryLines', () => {
  it('recovers the simple-entry marker from the persisted payload', () => {
    expect(voucherSimpleEntryType({ simple_entry_type: null, draft_payload: { simpleEntryType: 'Income' } })).toBe('Income')
    expect(voucherSimpleEntryType({ draft_payload: { simpleEntryType: 'not-valid' } })).toBeNull()
  })

  it('recognizes a simple entry from its settlement ledger and typed lines', () => {
    expect(voucherSimpleEntryType({ settlement_account_id: 'cash', lines: [
      { account_id: 'cash', debit: 150, credit: 0 },
      { account_id: 'interest', debit: 0, credit: 100 },
      { account_id: 'rebate', debit: 0, credit: 50 },
    ] }, accounts)).toBe('Income')
  })

  it('builds a split income entry with one balancing counter line', () => {
    expect(buildSimpleEntryLines({ entry_type: 'Income', counter_account_id: 'cash', lines: [
      { category_id: 'income-category', account_id: 'interest', amount: 100.125 },
      { category_id: 'income-category', account_id: 'rebate', amount: 49.875 },
    ] }, accounts, categories)).toEqual([
      { account_id: 'cash', debit: 150.01, credit: 0 },
      { account_id: 'interest', debit: 0, credit: 100.13 },
      { account_id: 'rebate', debit: 0, credit: 49.88 },
    ])
  })

  it('debits expense and credits the paying ledger', () => {
    expect(buildSimpleEntryLines({ entry_type: 'Expense', counter_account_id: 'cash', lines: [{ category_id: 'expense-category', account_id: 'rent', amount: 250 }] }, accounts, categories)).toEqual([
      { account_id: 'cash', debit: 0, credit: 250 },
      { account_id: 'rent', debit: 250, credit: 0 },
    ])
  })

  it('rejects wrong types, missing amounts, and counter reuse', () => {
    expect(() => buildSimpleEntryLines({ entry_type: 'Income', counter_account_id: 'cash', lines: [{ category_id: 'expense-category', account_id: 'rent', amount: 1 }] }, accounts, categories)).toThrow(/income category/i)
    expect(() => buildSimpleEntryLines({ entry_type: 'Expense', counter_account_id: 'cash', lines: [{ category_id: 'expense-category', account_id: 'rent', amount: 0 }] }, accounts, categories)).toThrow(/positive amount/i)
    expect(() => buildSimpleEntryLines({ entry_type: 'Expense', counter_account_id: 'rent', lines: [{ category_id: 'expense-category', account_id: 'rent', amount: 1 }] }, accounts, categories)).toThrow(/cannot also/i)
  })
})
