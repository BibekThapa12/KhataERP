import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { getDaybookRows } from '@/lib/reports'
import { makeBsKey, todayBs } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { JournalForm, ReceiptPaymentForm } from '@/components/forms/OtherForms'
import { ReturnForm } from '@/components/forms/ReturnForm'
import { Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Voucher } from '@/types'

const badgeVariant = (type: Voucher['type'], cancelled: boolean) => {
  if (cancelled) return 'cancelled' as const
  const variants = { Sales: 'sales', Purchase: 'purchase', Receipt: 'receipt', Payment: 'payment', Journal: 'journal' } as const
  return type === 'Stock Adjustment' ? 'secondary' as const : variants[type]
}

export function DaybookPage() {
  const { company, rawAccounts, parties, vouchers } = useAppStore()
  const [range, setRange] = useState<ReportRange>('today')
  const [from, setFrom] = useState(todayBs())
  const [to, setTo] = useState(todayBs())
  const [showCancelled, setShowCancelled] = useState(false)
  const [selected, setSelected] = useState<Voucher | null>(null)
  const [editing, setEditing] = useState<Voucher | null>(null)

  const rows = useMemo(() => {
    const fromKey = makeBsKey(from)
    const toKey = makeBsKey(to)
    return getDaybookRows(vouchers, rawAccounts, parties).filter(row =>
      row.date_bs_key >= fromKey && row.date_bs_key <= toKey && (showCancelled || !row.cancelled)
    )
  }, [vouchers, rawAccounts, parties, from, to, showCancelled])

  const activeRows = rows.filter(row => !row.cancelled)
  const totalDebit = activeRows.reduce((sum, row) => sum + row.debit, 0)
  const totalCredit = activeRows.reduce((sum, row) => sum + row.credit, 0)
  const totalValue = activeRows.reduce((sum, row) => sum + row.total, 0)

  const editVoucher = (voucher: Voucher) => {
    setSelected(null)
    setEditing(voucher)
  }
  const closeEdit = () => setEditing(null)

  return (
    <div className="report-page">
      <PageHeader
        title="Daybook"
        description="All voucher activity in chronological order"
        action={<Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>}
      />
      <PageContent className="report-content space-y-4">
        <div className="report-print-header hidden">
          <h1>{company?.name || 'KhataERP'}</h1>
          <p>Daybook | {fmtDate(from)} to {fmtDate(to)}</p>
        </div>
        <Card className="report-controls">
          <CardContent className="p-4 flex flex-wrap items-end justify-between gap-4">
            <ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} />
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={showCancelled} onChange={event => setShowCancelled(event.target.checked)} className="h-4 w-4 accent-primary" />
              Show cancelled
            </label>
          </CardContent>
        </Card>

        <Card className="report-table-card overflow-hidden">
          {rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No vouchers in this date range.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="report-th text-left">Date</th>
                    <th className="report-th text-left">Voucher Type</th>
                    <th className="report-th text-left">Voucher No.</th>
                    <th className="report-th text-left">Party / Account</th>
                    <th className="report-th text-left">Narration</th>
                    <th className="report-th text-right">Debit</th>
                    <th className="report-th text-right">Credit</th>
                    <th className="report-th text-right">Total</th>
                    <th className="report-th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr
                      key={row.voucher.id}
                      onClick={() => setSelected(row.voucher)}
                      className={`cursor-pointer border-t border-border transition-colors hover:bg-muted/30 ${row.cancelled ? 'opacity-50' : ''}`}
                    >
                      <td className="report-td whitespace-nowrap text-muted-foreground">{fmtDate(row.date_bs)}</td>
                      <td className="report-td"><Badge variant={badgeVariant(row.voucher_type, row.cancelled)}>{row.voucher_type}</Badge></td>
                      <td className="report-td num">{row.voucher_no}</td>
                      <td className="report-td font-medium">{row.particulars}</td>
                      <td className="report-td max-w-[220px] truncate text-muted-foreground">{row.narration || '-'}</td>
                      <td className="report-td text-right num debit-amt">{fmtMoney(row.debit)}</td>
                      <td className="report-td text-right num credit-amt">{fmtMoney(row.credit)}</td>
                      <td className="report-td text-right num font-semibold">{fmtMoney(row.total)}</td>
                      <td className="report-td">{row.cancelled ? 'Cancelled' : 'Active'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="report-td" colSpan={5}>Period totals ({activeRows.length} active voucher{activeRows.length === 1 ? '' : 's'})</td>
                    <td className="report-td text-right num">{fmtMoney(totalDebit)}</td>
                    <td className="report-td text-right num">{fmtMoney(totalCredit)}</td>
                    <td className="report-td text-right num">{fmtMoney(totalValue)}</td>
                    <td className="report-td"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
        {Math.abs(totalDebit - totalCredit) >= 0.01 && (
          <p className="report-controls text-sm font-medium text-destructive">
            Warning: the selected vouchers are out of balance by {fmtMoney(Math.abs(totalDebit - totalCredit))}.
          </p>
        )}
      </PageContent>

      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Voucher actions</DialogTitle></DialogHeader>
          {selected && <VoucherTable vouchers={[selected]} onEdit={selected.type === 'Stock Adjustment' ? undefined : editVoucher} />}
        </DialogContent>
      </Dialog>

      <InvoiceForm type="Sales" open={editing?.type === 'Sales'} voucher={editing?.type === 'Sales' ? editing : null} onClose={closeEdit} />
      <InvoiceForm type="Purchase" open={editing?.type === 'Purchase'} voucher={editing?.type === 'Purchase' ? editing : null} onClose={closeEdit} />
      <ReceiptPaymentForm type="Receipt" open={editing?.type === 'Receipt'} voucher={editing?.type === 'Receipt' ? editing : null} onClose={closeEdit} />
      <ReceiptPaymentForm type="Payment" open={editing?.type === 'Payment'} voucher={editing?.type === 'Payment' ? editing : null} onClose={closeEdit} />
      <JournalForm open={editing?.type === 'Journal'} voucher={editing?.type === 'Journal' ? editing : null} onClose={closeEdit} />
      <ReturnForm type="Sales Return" open={editing?.type === 'Sales Return'} voucher={editing?.type === 'Sales Return' ? editing : null} onClose={closeEdit} />
      <ReturnForm type="Purchase Return" open={editing?.type === 'Purchase Return'} voucher={editing?.type === 'Purchase Return' ? editing : null} onClose={closeEdit} />
    </div>
  )
}
