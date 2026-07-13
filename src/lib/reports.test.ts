import { describe, expect, it } from 'vitest'
import { buildAccountReportTree, computeCashFlow, groupReportAccounts } from '@/lib/reports'
import type { Account, AccountCategory, AccountType, Voucher, VoucherLine, VoucherType } from '@/types'

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

describe('cash flow report', () => {
  const companyId = 'company'
  const categories: AccountCategory[] = [
    { id: 'bank-category', company_id: companyId, name: 'Bank', account_type: 'Asset', is_system: true, is_archived: false },
    { id: 'fixed-category', company_id: companyId, name: 'Fixed Assets', account_type: 'Asset', is_system: false, is_archived: false },
  ]
  const accounts: Account[] = [
    { ...account(`${companyId}:cash`, 'Cash', 'Asset', 'Current Assets', 0), opening_balance: 100 },
    { ...account(`${companyId}:bank`, 'Bank Account', 'Asset', 'Bank', 0, 'bank-category'), opening_balance: 200 },
    { ...account('customer', 'Customer', 'Asset', 'Sundry Debtors', 0), is_party: true },
    account('expense', 'Rent Expense', 'Expense', 'Indirect Expenses', 0),
    account('equipment', 'Shop Equipment', 'Asset', 'Fixed Assets', 0, 'fixed-category'),
    account('capital', "Owner's Capital", 'Equity', 'Capital Account', 0),
  ]
  const voucher = (id: string, type: VoucherType, date: string, lines: VoucherLine[], cancelled = false): Voucher => ({
    id, company_id: companyId, type, date, date_ad: date, date_bs: date, date_bs_key: Number(date.replaceAll('-', '')),
    total: Math.max(...lines.map(line => line.debit || line.credit)), cancelled, seq: Number(id.replace(/\D/g, '')) || 1, is_cash: true, lines,
  })

  it('classifies cash movements and reconciles opening to closing cash', () => {
    const vouchers = [
      voucher('v0', 'Receipt', '2083-03-30', [{ account_id: `${companyId}:cash`, debit: 50, credit: 0 }, { account_id: 'customer', debit: 0, credit: 50 }]),
      voucher('v1', 'Receipt', '2083-04-02', [{ account_id: `${companyId}:cash`, debit: 500, credit: 0 }, { account_id: 'customer', debit: 0, credit: 500 }]),
      voucher('v2', 'Payment', '2083-04-03', [{ account_id: 'expense', debit: 100, credit: 0 }, { account_id: `${companyId}:cash`, debit: 0, credit: 100 }]),
      voucher('v3', 'Payment', '2083-04-04', [{ account_id: 'equipment', debit: 300, credit: 0 }, { account_id: `${companyId}:bank`, debit: 0, credit: 300 }]),
      voucher('v4', 'Receipt', '2083-04-05', [{ account_id: `${companyId}:bank`, debit: 1000, credit: 0 }, { account_id: 'capital', debit: 0, credit: 1000 }]),
      voucher('v5', 'Journal', '2083-04-06', [{ account_id: `${companyId}:bank`, debit: 200, credit: 0 }, { account_id: `${companyId}:cash`, debit: 0, credit: 200 }]),
      voucher('v6', 'Receipt', '2083-04-07', [{ account_id: `${companyId}:cash`, debit: 999, credit: 0 }, { account_id: 'customer', debit: 0, credit: 999 }], true),
    ]

    const report = computeCashFlow(companyId, accounts, categories, vouchers, '2083-04-01', '2083-04-30')
    expect(report).toMatchObject({ opening_balance: 350, total_inflow: 1500, total_outflow: 400, net_change: 1100, closing_balance: 1450 })
    expect(report.sections.map(section => [section.activity, section.net])).toEqual([
      ['operating', 400],
      ['investing', -300],
      ['financing', 1000],
    ])
    expect(report.sections.flatMap(section => section.rows).map(row => row.voucher.id)).not.toContain('v5')
    expect(report.sections.flatMap(section => section.rows).map(row => row.voucher.id)).not.toContain('v6')
  })
})
