import { describe, expect, it } from 'vitest'
import { accountCategoryDeletionBlockReason, ledgerDeletionBlockReason } from './masterDeletion'
import type { Account, AccountCategory, Voucher } from '@/types'

const ledger = (updates: Partial<Account> = {}) => ({
  id: 'ledger', company_id: 'company', name: 'Temporary Ledger', type: 'Asset', group: 'Temporary', category_id: 'group', is_system: false, is_party: false, opening_balance: 0, balance: 0, ...updates,
}) as Account

const group = (id: string, parent_category_id: string | null = null, updates: Partial<AccountCategory> = {}) => ({
  id, company_id: 'company', name: id, account_type: 'Asset', parent_category_id, is_system: false, is_archived: false, ...updates,
}) as AccountCategory

const voucher = (lines: Voucher['lines']) => ({
  id: 'voucher', company_id: 'company', type: 'Journal', date_bs: '2083-04-01', date_bs_key: 20830401, seq: 1, total: 0, is_cash: false, cancelled: false, lines,
}) as Voucher

describe('master deletion guards', () => {
  it('allows only unused, zero-balance, non-system ledgers', () => {
    expect(ledgerDeletionBlockReason(ledger(), [])).toBeNull()
    expect(ledgerDeletionBlockReason(ledger({ balance: 0.01 }), [])).toContain('balance must be zero')
    expect(ledgerDeletionBlockReason(ledger({ is_system: true }), [])).toContain('System-created')
    expect(ledgerDeletionBlockReason(ledger(), [voucher([{ account_id: 'ledger', debit: 10, credit: 10 }])])).toContain('transaction history')
  })

  it('requires an account group to contain no ledgers or child groups', () => {
    const categories = [group('group'), group('child', 'group')]
    expect(accountCategoryDeletionBlockReason(categories[0], categories, [ledger({ category_id: 'child' })])).toContain('every ledger')
    expect(accountCategoryDeletionBlockReason(categories[0], categories, [])).toContain('child account groups')
    expect(accountCategoryDeletionBlockReason(categories[1], categories, [])).toBeNull()
  })
})
