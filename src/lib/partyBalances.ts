import type { Account, Party } from '@/types'
import { round2 } from '@/lib/engine'

export interface PartyBalanceRow {
  party: Party
  debit: number
  credit: number
}

export interface PartyBalanceTotals {
  debit: number
  credit: number
}

const totalRows = (rows: PartyBalanceRow[]): PartyBalanceTotals => ({
  debit: round2(rows.reduce((sum, row) => sum + row.debit, 0)),
  credit: round2(rows.reduce((sum, row) => sum + row.credit, 0)),
})

export function getPartyBalanceSummary(parties: Party[], accounts: Account[]) {
  const accountMap = new Map(accounts.map(account => [account.id, account]))
  const rows: PartyBalanceRow[] = parties.filter(party => !party.is_archived).map(party => {
    const balance = round2(accountMap.get(party.account_id)?.balance || 0)
    const debitBalance = party.type === 'customer' ? balance : -balance
    return {
      party,
      debit: debitBalance > 0 ? debitBalance : 0,
      credit: debitBalance < 0 ? Math.abs(debitBalance) : 0,
    }
  }).sort((left, right) => left.party.type.localeCompare(right.party.type) || left.party.name.localeCompare(right.party.name))
  const debtors = rows.filter(row => row.party.type === 'customer')
  const creditors = rows.filter(row => row.party.type === 'supplier')
  return { rows, debtors, creditors, debtorTotals: totalRows(debtors), creditorTotals: totalRows(creditors), totals: totalRows(rows) }
}
