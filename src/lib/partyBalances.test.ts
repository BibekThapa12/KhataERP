import { describe, expect, it } from 'vitest'
import type { Account, Party } from '@/types'
import { getPartyBalanceSummary } from '@/lib/partyBalances'

const account = (id: string, type: Account['type'], balance: number): Account => ({ id, company_id: 'c', name: id, type, group: '', is_system: false, is_party: true, opening_balance: 0, balance })
const party = (id: string, type: Party['type'], account_id: string): Party => ({ id, company_id: 'c', name: id, type, account_id })

describe('party balance summary', () => {
  it('places customer receivables and advances on the correct side', () => {
    const report = getPartyBalanceSummary(
      [party('Customer A', 'customer', 'ca'), party('Customer Advance', 'customer', 'cb')],
      [account('ca', 'Asset', 120), account('cb', 'Asset', -25)],
    )
    expect(report.debtorTotals).toEqual({ debit: 120, credit: 25 })
  })

  it('places supplier payables and advances on the correct side', () => {
    const report = getPartyBalanceSummary(
      [party('Supplier A', 'supplier', 'sa'), party('Supplier Advance', 'supplier', 'sb')],
      [account('sa', 'Liability', 80), account('sb', 'Liability', -15)],
    )
    expect(report.creditorTotals).toEqual({ debit: 15, credit: 80 })
    expect(report.totals).toEqual({ debit: 15, credit: 80 })
  })
})
