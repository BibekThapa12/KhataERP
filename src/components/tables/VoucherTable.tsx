import { useState } from 'react'
import { Eye, XCircle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Voucher } from '@/types'

function voucherBadgeVariant(type: string, cancelled: boolean) {
  if (cancelled) return 'cancelled' as const
  const map: Record<string, 'sales' | 'purchase' | 'receipt' | 'payment' | 'journal'> = {
    Sales: 'sales', Purchase: 'purchase', Receipt: 'receipt', Payment: 'payment', Journal: 'journal',
  }
  return map[type] ?? 'default' as const
}

function VoucherDetail({ voucher }: { voucher: Voucher }) {
  const { getAccount, getItem, getPartyByAccountId } = useAppStore()
  const partyName = voucher.party_account_id
    ? getPartyByAccountId(voucher.party_account_id)?.name ?? getAccount(voucher.party_account_id)?.name
    : voucher.is_cash ? 'Cash' : '—'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Date</p><p className="font-medium mt-0.5">{fmtDate(voucher.date)}</p></div>
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Party</p><p className="font-medium mt-0.5">{partyName}</p></div>
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Total</p><p className="font-serif font-bold mt-0.5 num">{fmtMoney(voucher.total)}</p></div>
      </div>

      {voucher.invoice_items && voucher.invoice_items.length > 0 ? (
        <>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Item</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Qty</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Rate</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {voucher.invoice_items.map((it, i) => {
                const item = getItem(it.item_id)
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2">{item?.name ?? it.item_id}</td>
                    <td className="px-3 py-2 text-right num">{it.qty}</td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(it.rate)}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(it.qty * it.rate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="text-sm space-y-1 pt-2 border-t border-border">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="num">{fmtMoney(voucher.subtotal)}</span></div>
            {(voucher.discount ?? 0) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="num">- {fmtMoney(voucher.discount)}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">VAT ({voucher.vat_rate}%)</span><span className="num">{fmtMoney(voucher.vat_amount)}</span></div>
            <div className="flex justify-between font-serif font-bold text-base pt-1 border-t border-border"><span>Total</span><span className="num">{fmtMoney(voucher.total)}</span></div>
          </div>
        </>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Account</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Debit</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Credit</th>
            </tr>
          </thead>
          <tbody>
            {(voucher.lines ?? []).map((l, i) => {
              const acc = getAccount(l.account_id)
              return (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2">{acc?.name ?? l.account_id}</td>
                  <td className="px-3 py-2 text-right num">{l.debit ? <span className="debit-amt">{fmtMoney(l.debit)}</span> : '—'}</td>
                  <td className="px-3 py-2 text-right num">{l.credit ? <span className="credit-amt">{fmtMoney(l.credit)}</span> : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {voucher.narration && (
        <p className="text-sm text-muted-foreground italic border-t border-border pt-2">
          Note: {voucher.narration}
        </p>
      )}
    </div>
  )
}

interface VoucherTableProps {
  vouchers: Voucher[]
  showActions?: boolean
}

export function VoucherTable({ vouchers, showActions = true }: VoucherTableProps) {
  const cancelV = useAppStore(s => s.cancelV)
  const getPartyByAccountId = useAppStore(s => s.getPartyByAccountId)
  const [detail, setDetail] = useState<Voucher | null>(null)
  const [cancelling, setCancelling] = useState(false)

  if (vouchers.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-3xl mb-3 opacity-30">◇</p>
        <p className="font-medium text-foreground">No transactions yet</p>
        <p className="text-sm mt-1">Transactions will appear here once added.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Date</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Type</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Ref / Party</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5 hidden md:table-cell">Narration</th>
              <th className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Amount</th>
              {showActions && <th className="px-4 py-2.5 w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {vouchers.map(v => {
              const partyName = v.party_account_id
                ? getPartyByAccountId(v.party_account_id)?.name ?? '—'
                : v.is_cash ? 'Cash' : '—'
              return (
                <tr key={v.id} className={`border-t border-border hover:bg-muted/30 transition-colors ${v.cancelled ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{fmtDate(v.date)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={voucherBadgeVariant(v.type, v.cancelled)}>{v.type}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {v.invoice_no && <span className="text-xs text-muted-foreground block num">{v.invoice_no}</span>}
                    <span className="font-medium">{partyName}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-[200px] truncate">{v.narration}</td>
                  <td className="px-4 py-3 text-right num font-semibold">{fmtMoney(v.total)}</td>
                  {showActions && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetail(v)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {!v.cancelled && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Cancel this voucher?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will reverse <strong>{v.type} {v.invoice_no}</strong> dated {fmtDate(v.date)} for {fmtMoney(v.total)}.
                                  All affected balances and stock will be reversed. The voucher stays in history marked cancelled.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Keep it</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={async () => { setCancelling(true); await cancelV(v.id); setCancelling(false) }}
                                  disabled={cancelling}
                                >
                                  Cancel voucher
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail?.type} {detail?.invoice_no ? `· ${detail.invoice_no}` : ''}
            </DialogTitle>
          </DialogHeader>
          {detail && <VoucherDetail voucher={detail} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
