import { describe, expect, it } from 'vitest'
import { buildAccountReportTree, groupReportAccounts } from '@/lib/reports'
import type { Account, AccountCategory, AccountType } from '@/types'

const account = (id: string, name: string, type: AccountType, group: string, balance: number, category_id = group) => ({
  id, name, type, group, balance, category_id, company_id: 'company', is_system: false, is_party: group.startsWith('Sundry'), opening_balance: 0,
}) as Account

describe('financial report account grouping', () => {
  it('groups party ledgers and preserves aggregate balances', () => {
    const groups = groupReportAccounts([
      account('c1', 'Customer One', 'Asset', 'Sundry Debtors', 1200, 'debtors'),
      account('c2', 'Customer Two', 'Asset', 'Sundry Debtors', -200, 'debtors'),
      account('s1', 'Supplier One', 'Liability', 'Sundry Creditors', 500, 'creditors'),
    ])
    const debtors = groups.find(group => group.name === 'Sundry Debtors')!
    expect(debtors.accounts.map(entry => entry.name)).toEqual(['Customer One', 'Customer Two'])
    expect(debtors).toMatchObject({ balance: 1000, debit: 1200, credit: 200 })
  })

  it('keeps identically named groups with different account types separate', () => {
    const groups = groupReportAccounts([
      account('a', 'Asset Ledger', 'Asset', 'General', 100, 'asset-general'),
      account('e', 'Expense Ledger', 'Expense', 'General', 50, 'expense-general'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.type)).toEqual(['Asset', 'Expense'])
  })

  it('calculates debit and credit totals using each account natural side', () => {
    const [group] = groupReportAccounts([
      account('income', 'Sales', 'Income', 'Sales Accounts', 1000, 'sales'),
      account('return', 'Sales Return', 'Income', 'Sales Accounts', -100, 'sales'),
    ])
    expect(group).toMatchObject({ balance: 900, debit: 100, credit: 1000 })
  })

  it('rolls direct and descendant ledgers into recursive category totals', () => {
    const category = (id: string, name: string, parent_category_id: string | null): AccountCategory => ({ id, name, parent_category_id, account_type: 'Asset', company_id: 'company', is_system: false, is_archived: false })
    const tree = buildAccountReportTree([
      account('root-ledger', 'Root Ledger', 'Asset', 'Assets', 50, 'assets'),
      account('customer', 'Customer', 'Asset', 'Sundry Debtors', 120, 'debtors'),
    ], [category('assets', 'Assets', null), category('current', 'Current Assets', 'assets'), category('debtors', 'Sundry Debtors', 'current')])
    expect(tree[0]).toMatchObject({ name: 'Assets', balance: 170, debit: 170, totalCount: 2 })
    expect(tree[0].children[0].children[0]).toMatchObject({ name: 'Sundry Debtors', balance: 120, totalCount: 1 })
  })

  it('places missing and archived category assignments in an uncategorized fallback', () => {
    const archived: AccountCategory = { id: 'old', name: 'Old', parent_category_id: null, account_type: 'Asset', company_id: 'company', is_system: false, is_archived: true }
    const tree = buildAccountReportTree([account('legacy', 'Legacy', 'Asset', 'Old', 75, 'old')], [archived])
    expect(tree[0]).toMatchObject({ key: 'uncategorized:Asset', balance: 75, totalCount: 1 })
  })
})
