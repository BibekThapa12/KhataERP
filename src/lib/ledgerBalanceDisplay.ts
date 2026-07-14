import type { Account, Party } from '@/types'

export type LedgerBalanceSide = 'Dr' | 'Cr' | null

export interface LedgerBalanceDisplay {
  amount: number
  side: LedgerBalanceSide
  description: string
}

function naturalSide(account: Account): Exclude<LedgerBalanceSide, null> {
  return account.type === 'Asset' || account.type === 'Expense' ? 'Dr' : 'Cr'
}

export function ledgerBalanceDisplay(account: Account, party?: Party | null): LedgerBalanceDisplay {
  const balance = Math.abs(account.balance) < 0.005 ? 0 : account.balance
  if (balance === 0) return { amount: 0, side: null, description: 'No outstanding balance' }

  const normal = naturalSide(account)
  const side = balance > 0 ? normal : (normal === 'Dr' ? 'Cr' : 'Dr')
  let description = side === 'Dr' ? 'Debit balance' : 'Credit balance'

  if (party?.type === 'customer') {
    description = side === 'Dr' ? 'Receivable from customer' : 'Advance received from customer'
  } else if (party?.type === 'supplier') {
    description = side === 'Cr' ? 'Payable to supplier' : 'Advance paid to supplier'
  }

  return { amount: Math.abs(balance), side, description }
}
