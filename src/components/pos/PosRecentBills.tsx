import { useState } from 'react'
import { Ban, Eye, Pencil, Printer } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { VoucherDetail } from '@/components/tables/VoucherTable'
import { printPersistedVoucher } from '@/lib/voucherPrinterRegistry'
import { savedVoucherNumber } from '@/lib/voucherNumbers'
import { publicErrorMessage } from '@/lib/security'
import { fmtMoney } from '@/lib/utils'
import type { Voucher } from '@/types'

const QR_EDIT_BLOCK = 'POS QR bill. Cancel it and re-ring it at the POS.'

/** How the bill was paid, in the cashier's words. */
export function usePosPaymentLabel() {
  const getAccount = useAppStore(s => s.getAccount)
  const getPartyByAccountId = useAppStore(s => s.getPartyByAccountId)
  return (voucher: Voucher) => {
    if (voucher.settlement_account_id) return getAccount(voucher.settlement_account_id)?.name || 'QR'
    if (!voucher.is_cash) return `Credit · ${voucher.party_account_id ? getPartyByAccountId(voucher.party_account_id)?.name || 'Customer' : 'Customer'}`
    return 'Cash'
  }
}

export function PosRecentBills({ bills, onReprint, onError }: { bills: Voucher[]; onReprint: (voucher: Voucher) => void; onError: (message: string) => void }) {
  const cancelV = useAppStore(s => s.cancelV)
  const paymentLabel = usePosPaymentLabel()
  const [viewing, setViewing] = useState<Voucher | null>(null)
  const [editing, setEditing] = useState<Voucher | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Voucher | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const startEdit = (voucher: Voucher) => {
    if (voucher.settlement_account_id) { onError(QR_EDIT_BLOCK); return }
    setEditing(voucher)
  }

  const confirmCancel = async () => {
    if (!cancelTarget || cancelling) return
    setCancelling(true)
    try {
      await cancelV(cancelTarget.id)
      setCancelTarget(null)
    } catch (error) {
      onError(publicErrorMessage(error, 'cancelling POS bill'))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <section aria-labelledby="pos-recent-bills" className="mt-6">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h2 id="pos-recent-bills" className="text-sm font-semibold">Today's POS bills</h2>
        {bills.length > 0 && <span className="text-xs text-muted-foreground">Last {bills.length}</span>}
      </div>
      {bills.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Bills you complete today appear here for reprint, edit or cancel.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-md border bg-card">
          {bills.map(voucher => (
            <li key={voucher.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${voucher.cancelled ? 'text-muted-foreground' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">{savedVoucherNumber(voucher)}</span>
                  {voucher.cancelled && <span className="rounded bg-destructive/10 px-1.5 py-px text-[11px] font-medium text-destructive">Cancelled</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {voucher.created_at ? new Date(voucher.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''}{paymentLabel(voucher)}
                </div>
              </div>
              <span className={`tabular-nums font-medium ${voucher.cancelled ? 'line-through' : ''}`}>{fmtMoney(voucher.total)}</span>
              <div className="flex shrink-0 items-center">
                <Button variant="ghost" size="icon" className="h-8 w-8" title="View bill" aria-label={`View ${savedVoucherNumber(voucher)}`} onClick={() => setViewing(voucher)}><Eye className="h-4 w-4" /></Button>
                {!voucher.cancelled && <>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Reprint receipt" aria-label={`Reprint receipt ${savedVoucherNumber(voucher)}`} onClick={() => onReprint(voucher)}><Printer className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={voucher.settlement_account_id ? 'QR bills cannot be edited' : 'Edit bill'} aria-label={`Edit ${savedVoucherNumber(voucher)}`} onClick={() => startEdit(voucher)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" title="Cancel bill" aria-label={`Cancel ${savedVoucherNumber(voucher)}`} onClick={() => setCancelTarget(voucher)}><Ban className="h-4 w-4" /></Button>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!viewing} onOpenChange={open => !open && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Bill {viewing ? savedVoucherNumber(viewing) : ''}</DialogTitle></DialogHeader>
          {viewing && <VoucherDetail voucher={viewing} />}
          <DialogFooter>
            {viewing && !viewing.cancelled && <Button variant="outline" onClick={() => onReprint(viewing)}><Printer className="mr-1.5 h-4 w-4" />Reprint receipt</Button>}
            {viewing && <Button variant="outline" onClick={() => printPersistedVoucher(viewing)}><Printer className="mr-1.5 h-4 w-4" />Print invoice</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing && <InvoiceForm type="Sales" open voucher={editing} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!cancelTarget} onOpenChange={open => !open && !cancelling && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this bill?</AlertDialogTitle>
            <AlertDialogDescription>
              This reverses <strong>{cancelTarget ? savedVoucherNumber(cancelTarget) : ''}</strong> for Rs {fmtMoney(cancelTarget?.total)}. Stock and ledger balances are reversed, and the bill stays in history marked cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={cancelling} onClick={event => { event.preventDefault(); void confirmCancel() }}>{cancelling ? 'Cancelling…' : 'Cancel bill'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
