import { describe, expect, it } from 'vitest'
import { ledgerFieldVisibility, openingBalanceFromStored, openingBalanceToStored } from '@/lib/ledgerForm'
import type { AccountCategory } from '@/types'

const category = (id: string, name: string, account_type: AccountCategory['account_type'], parent_category_id: string | null = null): AccountCategory => ({
  id, company_id: 'company', name, account_type, parent_category_id, is_system: false, is_archived: false,
})

const categories = [
  category('assets', 'Assets', 'Asset'),
  category('current', 'Current Assets', 'Asset', 'assets'),
  category('bank', 'Bank Accounts', 'Asset', 'current'),
  category('custom-bank', 'Nabil Bank', 'Asset', 'bank'),
  category('debtors', 'Sundry Debtors', 'Asset', 'current'),
  category('income', 'Incomes', 'Income'),
]

describe('ledger form rules', () => {
  it('inherits bank fields from the Bank Accounts ancestor', () => {
    expect(ledgerFieldVisibility(categories, 'custom-bank')).toEqual({ showContactDetails: true, showCreditDays: false, showBankDetails: true })
  })

  it('shows credit terms for Sundry Debtors and hides details for income', () => {
    expect(ledgerFieldVisibility(categories, 'debtors').showCreditDays).toBe(true)
    expect(ledgerFieldVisibility(categories, 'income')).toEqual({ showContactDetails: false, showCreditDays: false, showBankDetails: false })
  })

  it('stores Dr and Cr balances according to the account normal side', () => {
    expect(openingBalanceToStored(100, 'Asset', 'Dr')).toBe(100)
    expect(openingBalanceToStored(100, 'Asset', 'Cr')).toBe(-100)
    expect(openingBalanceToStored(100, 'Liability', 'Cr')).toBe(100)
    expect(openingBalanceFromStored(-100, 'Liability')).toEqual({ amount: 100, balanceType: 'Dr' })
  })
})
