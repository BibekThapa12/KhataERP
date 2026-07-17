import { describe, expect, it } from 'vitest'
import { buildAccountReportTree, computeCashFlow, computeDetailedProfitLoss, groupReportAccounts, vouchersInFiscalYear } from '@/lib/reports'
import type { Account, AccountCategory, AccountType, Voucher, VoucherLine, VoucherType } from '@/types'

const account = (id: string, name: string, type: AccountType, group: string, balance: number, category_id = group) => ({
  id, name, type, group, balance, category_id, company_id: 'company', is_system: false, is_party: group.startsWith('Sundry'), opening_balance: 0,
}) as Account

const datedVoucher = (id: string, date_bs: string) => ({
  id, company_id: 'company', type: 'Sales', date_bs, date_bs_key: Number(date_bs.replaceAll('-', '')), seq: 1, total: 0, is_cash: false, cancelled: false,
}) as Voucher

describe('fiscal-year voucher filtering', () => {
  it('includes both fiscal boundaries correctly and excludes adjacent years', () => {
    const rows = vouchersInFiscalYear([
      datedVoucher('previous', '2083-03-31'),
      datedVoucher('first', '2083-04-01'),
      datedVoucher('last', '2084-03-31'),
      datedVoucher('next', '2084-04-01'),
    ], '2083-04-01')
    expect(rows.map(row => row.id)).toEqual(['first', 'last'])
  })
})

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

describe('detailed profit and loss', () => {
  const categories: AccountCategory[] = [
    { id: 'income-root', company_id: 'company', name: 'Income', account_type: 'Income', is_system: false, is_archived: false },
    { id: 'sales-group', company_id: 'company', name: 'Sales Accounts', account_type: 'Income', parent_category_id: 'income-root', is_system: false, is_archived: false },
    { id: 'other-income', company_id: 'company', name: 'Indirect Income', account_type: 'Income', parent_category_id: 'income-root', is_system: false, is_archived: false },
    { id: 'expense-root', company_id: 'company', name: 'Expenses', account_type: 'Expense', is_system: false, is_archived: false },
    { id: 'purchase-group', company_id: 'company', name: 'Purchase Accounts', account_type: 'Expense', parent_category_id: 'expense-root', is_system: false, is_archived: false },
    { id: 'direct-group', company_id: 'company', name: 'Cost of Goods Sold', account_type: 'Expense', parent_category_id: 'expense-root', is_system: false, is_archived: false },
    { id: 'indirect-group', company_id: 'company', name: 'Indirect Expenses', account_type: 'Expense', parent_category_id: 'expense-root', is_system: false, is_archived: false },
  ]

  it('classifies accounts and balances gross and net profit', () => {
    const statement = computeDetailedProfitLoss('company', [
      account('company:sales', 'Sales', 'Income', 'Renamed Sales', 1000, 'other-income'),
      account('commission', 'Commission', 'Income', 'Indirect Income', 50, 'other-income'),
      account('company:purchase', 'Purchases', 'Expense', 'Renamed Purchase', 600, 'indirect-group'),
      account('freight', 'Freight', 'Expense', 'Cost of Goods Sold', 100, 'direct-group'),
      account('rent', 'Rent', 'Expense', 'Indirect Expenses', 80, 'indirect-group'),
    ], categories, [{ id: 'item', name: 'Item', unit: 'Pcs', qty: 10, avg_cost: 20, value: 200 }], [{ id: 'item', name: 'Item', unit: 'Pcs', qty: 15, avg_cost: 20, value: 300 }])
    expect(statement.directIncome.map(entry => entry.id)).toEqual(['company:sales'])
    expect(statement.directExpenses.map(entry => entry.id)).toEqual(['company:purchase', 'freight'])
    expect(statement).toMatchObject({ openingStockValue: 200, closingStockValue: 300, grossProfit: 400, netProfit: 370, totalIncome: 1050, totalExpense: 780 })
    expect(statement.debitTotal).toBe(statement.creditTotal)
  })

  it('places unmatched nominal accounts in indirect sections and supports losses', () => {
    const statement = computeDetailedProfitLoss('company', [
      account('misc-income', 'Misc Income', 'Income', 'General', 20, 'income-root'),
      account('admin', 'Admin', 'Expense', 'General', 50, 'expense-root'),
    ], categories, [{ id: 'item', name: 'Item', unit: 'Pcs', qty: 1, avg_cost: 100, value: 100 }], [])
    expect(statement.indirectIncome.map(entry => entry.id)).toEqual(['misc-income'])
    expect(statement.indirectExpenses.map(entry => entry.id)).toEqual(['admin'])
    expect(statement).toMatchObject({ grossProfit: -100, netProfit: -130 })
    expect(statement.debitTotal).toBe(statement.creditTotal)
  })
})

describe('cash flow report', () => {
  const companyId = 'company'
  const categories: AccountCategory[] = [
    { id: 'bank-category', company_id: companyId, name: 'Bank Accounts', account_type: 'Asset', is_system: true, is_archived: false },
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

  it('treats a Bank OD opening balance as negative cash', () => {
    const overdraftCategory = { id: 'bank-od', company_id: companyId, name: 'Bank OD A/c', account_type: 'Liability', is_system: true, is_archived: false } as AccountCategory
    const overdraft = { ...account('od', 'Overdraft', 'Liability', 'Bank OD A/c', 0, overdraftCategory.id), opening_balance: 75 }
    const report = computeCashFlow(companyId, [...accounts, overdraft], [...categories, overdraftCategory], [], '2083-04-01', '2083-04-30')
    expect(report).toMatchObject({ opening_balance: 225, net_change: 0, closing_balance: 225 })
  })
})
