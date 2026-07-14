import { ledgerBalanceDisplay } from '@/lib/ledgerBalanceDisplay'
import { cn, fmtMoney } from '@/lib/utils'
import type { Account, Party } from '@/types'

interface LedgerBalanceHintProps {
  account?: Account | null
  party?: Party | null
  className?: string
}

export function LedgerBalanceHint({ account, party, className }: LedgerBalanceHintProps) {
  if (!account) return null
  const display = ledgerBalanceDisplay(account, party)
  const isReceivable = party?.type === 'customer' ? display.side === 'Dr' : party?.type === 'supplier' && display.side === 'Dr'
  const isPayable = party?.type === 'supplier' ? display.side === 'Cr' : party?.type === 'customer' && display.side === 'Cr'

  return (
    <p
      className={cn('num w-fit whitespace-nowrap text-sm font-semibold text-muted-foreground', isReceivable && 'text-forest', isPayable && 'text-destructive', className)}
      title={display.description}
    >
      {fmtMoney(display.amount)}{display.side ? ` ${display.side}` : ''}
    </p>
  )
}
