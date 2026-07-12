import { describe, expect, it } from 'vitest'
import { bankAccounts, legacySettlementAccountId } from '@/lib/banks'
import type { Account, AccountCategory, Voucher } from '@/types'

describe('multiple bank accounts', () => {
  it('includes only direct Bank-category ledgers', () => {
    const category = { id: 'bank-category', name: 'Bank', account_type: 'Asset', company_id: 'c', is_system: true, is_archived: false } as AccountCategory
    const accounts = [
      { id: 'bank-1', name: 'Bank One', category_id: category.id, is_archived: false },
      { id: 'other', name: 'Other Asset', category_id: 'current-assets', is_archived: false },
      { id: 'old-bank', name: 'Old Bank', category_id: category.id, is_archived: true },
    ] as Account[]
    expect(bankAccounts(accounts, [category]).map(account => account.id)).toEqual(['bank-1'])
    expect(bankAccounts(accounts, [category], true).map(account => account.id)).toEqual(['bank-1', 'old-bank'])
  })

  it('restores a legacy receipt account from its voucher lines', () => {
    const voucher = { type: 'Receipt', party_account_id: 'customer', lines: [{ account_id: 'bank-2', debit: 100, credit: 0 }, { account_id: 'customer', debit: 0, credit: 100 }] } as Voucher
    expect(legacySettlementAccountId(voucher)).toBe('bank-2')
  })
})
