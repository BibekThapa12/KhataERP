import { describe, expect, it } from 'vitest'
import { bankAccounts, legacySettlementAccountId, signedBankBalance } from '@/lib/banks'
import type { Account, AccountCategory, Voucher } from '@/types'

describe('multiple bank accounts', () => {
  it('includes direct Bank Accounts and Bank OD ledgers', () => {
    const category = { id: 'bank-category', name: 'Bank Accounts', account_type: 'Asset', company_id: 'c', is_system: true, is_archived: false } as AccountCategory
    const overdraft = { id: 'od-category', name: 'Bank OD A/c', account_type: 'Liability', company_id: 'c', is_system: true, is_archived: false } as AccountCategory
    const accounts = [
      { id: 'bank-1', name: 'Bank One', type: 'Asset', category_id: category.id, is_archived: false, balance: 500 },
      { id: 'od-1', name: 'OD One', type: 'Liability', category_id: overdraft.id, is_archived: false, balance: 200 },
      { id: 'other', name: 'Other Asset', category_id: 'current-assets', is_archived: false },
      { id: 'old-bank', name: 'Old Bank', category_id: category.id, is_archived: true },
    ] as Account[]
    expect(bankAccounts(accounts, [category, overdraft]).map(account => account.id)).toEqual(['bank-1', 'od-1'])
    expect(bankAccounts(accounts, [category, overdraft], true).map(account => account.id)).toEqual(['bank-1', 'od-1', 'old-bank'])
    expect(signedBankBalance(accounts[0])).toBe(500)
    expect(signedBankBalance(accounts[1])).toBe(-200)
  })

  it('restores a legacy receipt account from its voucher lines', () => {
    const voucher = { type: 'Receipt', party_account_id: 'customer', lines: [{ account_id: 'bank-2', debit: 100, credit: 0 }, { account_id: 'customer', debit: 0, credit: 100 }] } as Voucher
    expect(legacySettlementAccountId(voucher)).toBe('bank-2')
  })
})
