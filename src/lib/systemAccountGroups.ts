import type { AccountCategory, AccountType } from '@/types'
import type { SystemAccountKey } from '@/lib/engine'

export interface SystemAccountGroupSpec {
  key: string
  name: string
  account_type: AccountType
  parent_key?: string
}

export const SYSTEM_ACCOUNT_GROUPS: SystemAccountGroupSpec[] = [
  { key: 'assets', name: 'Assets', account_type: 'Asset' },
  { key: 'liabilities', name: 'Liabilities', account_type: 'Liability' },
  { key: 'equity', name: 'Equity', account_type: 'Equity' },
  { key: 'incomes', name: 'Incomes', account_type: 'Income' },
  { key: 'expenses', name: 'Expenses', account_type: 'Expense' },
  { key: 'capital', name: 'Capital Account', account_type: 'Equity', parent_key: 'equity' },
  { key: 'current-assets', name: 'Current Assets', account_type: 'Asset', parent_key: 'assets' },
  { key: 'fixed-assets', name: 'Fixed Assets', account_type: 'Asset', parent_key: 'assets' },
  { key: 'investments', name: 'Investments', account_type: 'Asset', parent_key: 'assets' },
  { key: 'current-liabilities', name: 'Current Liabilities', account_type: 'Liability', parent_key: 'liabilities' },
  { key: 'loans-liability', name: 'Loans (Liability)', account_type: 'Liability', parent_key: 'liabilities' },
  { key: 'suspense', name: 'Suspense A/c', account_type: 'Liability', parent_key: 'liabilities' },
  { key: 'direct-expenses', name: 'Direct Expenses', account_type: 'Expense', parent_key: 'expenses' },
  { key: 'indirect-expenses', name: 'Indirect Expenses', account_type: 'Expense', parent_key: 'expenses' },
  { key: 'purchase-accounts', name: 'Purchase Accounts', account_type: 'Expense', parent_key: 'expenses' },
  { key: 'direct-incomes', name: 'Direct Incomes', account_type: 'Income', parent_key: 'incomes' },
  { key: 'indirect-incomes', name: 'Indirect Incomes', account_type: 'Income', parent_key: 'incomes' },
  { key: 'sales-accounts', name: 'Sales Accounts', account_type: 'Income', parent_key: 'incomes' },
  { key: 'reserves-surplus', name: 'Reserves & Surplus', account_type: 'Equity', parent_key: 'capital' },
  { key: 'bank-accounts', name: 'Bank Accounts', account_type: 'Asset', parent_key: 'current-assets' },
  { key: 'cash-in-hand', name: 'Cash-in-Hand', account_type: 'Asset', parent_key: 'current-assets' },
  { key: 'deposits-asset', name: 'Deposits (Asset)', account_type: 'Asset', parent_key: 'current-assets' },
  { key: 'loans-advances-asset', name: 'Loans & Advances (Asset)', account_type: 'Asset', parent_key: 'current-assets' },
  { key: 'sundry-debtors', name: 'Sundry Debtors', account_type: 'Asset', parent_key: 'current-assets' },
  { key: 'duties-taxes', name: 'Duties & Taxes', account_type: 'Liability', parent_key: 'current-liabilities' },
  { key: 'provisions', name: 'Provisions', account_type: 'Liability', parent_key: 'current-liabilities' },
  { key: 'sundry-creditors', name: 'Sundry Creditors', account_type: 'Liability', parent_key: 'current-liabilities' },
  { key: 'bank-od', name: 'Bank OD A/c', account_type: 'Liability', parent_key: 'loans-liability' },
  { key: 'secured-loans', name: 'Secured Loans', account_type: 'Liability', parent_key: 'loans-liability' },
  { key: 'unsecured-loans', name: 'Unsecured Loans', account_type: 'Liability', parent_key: 'loans-liability' },
]

export const SYSTEM_ACCOUNT_DESTINATIONS: Record<SystemAccountKey, string> = {
  cash: 'cash-in-hand',
  bank: 'bank-accounts',
  inventory: 'current-assets',
  vat_payable: 'duties-taxes',
  vat_receivable: 'duties-taxes',
  sales: 'sales-accounts',
  purchase: 'purchase-accounts',
  sales_return: 'sales-accounts',
  purchase_return: 'purchase-accounts',
  capital: 'capital',
  discount_allowed: 'indirect-expenses',
  rent: 'indirect-expenses',
  salary: 'indirect-expenses',
  electricity: 'indirect-expenses',
}

export function systemAccountGroup(categories: AccountCategory[], key: string) {
  const spec = SYSTEM_ACCOUNT_GROUPS.find(group => group.key === key)
  return spec ? categories.find(category => category.name === spec.name && category.account_type === spec.account_type) : undefined
}
