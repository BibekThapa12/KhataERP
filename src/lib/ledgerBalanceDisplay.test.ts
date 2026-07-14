import { describe, expect, it } from 'vitest'
import { ledgerBalanceDisplay } from '@/lib/ledgerBalanceDisplay'
import type { Account, Party } from '@/types'

const account = (type: Account['type'], balance: number): Account => ({
  id: 'account', company_id: 'company', name: 'Ledger', type, group: 'Group',
  is_system: false, is_party: true, opening_balance: 0, balance,
})

const party = (type: Party['type']): Party => ({
  id: 'party', company_id: 'company', name: 'Party', type, account_id: 'account',
})

describe('ledger balance display', () => {
  it('describes customer debit and credit balances clearly', () => {
    expect(ledgerBalanceDisplay(account('Asset', 35000), party('customer'))).toEqual({ amount: 35000, side: 'Dr', description: 'Receivable from customer' })
    expect(ledgerBalanceDisplay(account('Asset', -500), party('customer'))).toEqual({ amount: 500, side: 'Cr', description: 'Advance received from customer' })
  })

  it('describes supplier credit and debit balances clearly', () => {
    expect(ledgerBalanceDisplay(account('Liability', 9000), party('supplier'))).toEqual({ amount: 9000, side: 'Cr', description: 'Payable to supplier' })
    expect(ledgerBalanceDisplay(account('Liability', -700), party('supplier'))).toEqual({ amount: 700, side: 'Dr', description: 'Advance paid to supplier' })
  })

  it('uses a neutral explanation for zero balances', () => {
    expect(ledgerBalanceDisplay(account('Asset', 0))).toEqual({ amount: 0, side: null, description: 'No outstanding balance' })
  })
})
