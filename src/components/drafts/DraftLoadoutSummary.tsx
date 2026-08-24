import { Printer } from 'lucide-react'
import type { Company } from '@/types'
import { formatDraftLoadoutQuantity, type DraftLoadoutSummary as DraftLoadoutSummaryData } from '@/lib/draftLoadout'
import { printHtmlDocument } from '@/lib/voucherPrinterRegistry'
import { fmtMoney } from '@/lib/utils'
import { notifyError } from '@/lib/notifications'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
const qty = (value: number) => value.toLocaleString('en-NP', { maximumFractionDigits: 2 })

function printLoadout(company: Company | null | undefined, summary: DraftLoadoutSummaryData) {
  const rows = summary.rows.map((row, index) => `<tr><td>${index + 1}</td><td>${esc(row.itemName)}</td><td class="num">${esc(formatDraftLoadoutQuantity(row))}</td><td class="num">${esc(fmtMoney(row.totalAmount))}</td></tr>`).join('')
  const html = `<!doctype html><html><head><title>Loadout Summary</title><style>@page{size:auto;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#18233d;font:11px Arial,sans-serif}.sheet{border:1px solid #94a3b8}.head{text-align:center;padding:10px;border-bottom:1px solid #94a3b8}.head h1{margin:0;font:700 20px Georgia,serif}.head h2{margin:4px 0 0;font-size:12px}.head p{margin:3px 0 0;color:#475569}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:6px;border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1}th:last-child,td:last-child{border-right:0}th{background:#f4f1ec;text-align:left;font-size:9px;text-transform:uppercase}th:nth-child(1),td:nth-child(1){width:7%;text-align:center}th:nth-child(2),td:nth-child(2){width:45%}th:nth-child(3),td:nth-child(3){width:25%}th:nth-child(4),td:nth-child(4){width:23%;text-align:right}.num{text-align:right}.totals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:8px}.totals div{border:1px solid #cbd5e1;padding:7px}.totals span{display:block;color:#64748b;font-size:9px;text-transform:uppercase}.totals strong{display:block;margin-top:3px;font-size:12px}.foot{text-align:center;border-top:1px solid #cbd5e1;padding:5px;font-size:8px}</style></head><body><main class="sheet"><header class="head"><h1>Loadout Summary</h1><h2>${esc(company?.name || 'Company')}</h2><p>${summary.draftCount} Draft Bill${summary.draftCount === 1 ? '' : 's'} • Generated ${esc(new Date().toLocaleString('en-NP'))}</p></header><table><thead><tr><th>S.N.</th><th>Item Name</th><th>Total Quantity</th><th>Total Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="padding:20px;text-align:center">No loadable inventory items.</td></tr>'}</tbody></table><section class="totals"><div><span>Total distinct items</span><strong>${summary.distinctItemCount}</strong></div><div><span>Grand total quantity</span><strong>${qty(summary.grandTotalQuantity)}</strong></div><div><span>Grand total amount</span><strong>${esc(fmtMoney(summary.grandTotalAmount))}</strong></div></section><footer class="foot">KhataERP</footer></main></body></html>`
  if (!printHtmlDocument(html)) notifyError('The loadout summary could not be prepared for printing. Please try again.')
}

export function DraftLoadoutSummary({ open, onOpenChange, company, summary }: { open: boolean; onOpenChange: (open: boolean) => void; company?: Company | null; summary: DraftLoadoutSummaryData }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-4xl">
      <DialogHeader><DialogTitle>Loadout Summary — {summary.draftCount} Draft Bill{summary.draftCount === 1 ? '' : 's'}</DialogTitle></DialogHeader>
      <div className="max-h-[60vh] overflow-auto rounded-md border">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="sticky top-0 bg-muted"><tr><th className="w-14 px-3 py-2 text-center text-xs uppercase text-muted-foreground">S.N.</th><th className="px-3 py-2 text-left text-xs uppercase text-muted-foreground">Item Name</th><th className="w-56 px-3 py-2 text-right text-xs uppercase text-muted-foreground">Total Quantity</th><th className="w-44 px-3 py-2 text-right text-xs uppercase text-muted-foreground">Total Amount</th></tr></thead>
          <tbody>{summary.rows.map((row, index) => <tr key={row.itemId} className="border-t"><td className="px-3 py-2 text-center num text-muted-foreground">{index + 1}</td><td className="px-3 py-2 font-medium">{row.itemName}</td><td className="px-3 py-2 text-right num">{formatDraftLoadoutQuantity(row)}</td><td className="px-3 py-2 text-right num font-medium">{fmtMoney(row.totalAmount)}</td></tr>)}{!summary.rows.length && <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">No loadable inventory items were found.</td></tr>}</tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Total distinct items</p><p className="mt-1 font-semibold num">{summary.distinctItemCount}</p></div><div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Grand total quantity</p><p className="mt-1 font-semibold num">{qty(summary.grandTotalQuantity)}</p></div><div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Grand total amount</p><p className="mt-1 font-semibold num">{fmtMoney(summary.grandTotalAmount)}</p></div></div>
      {!!summary.warnings.length && <div className="max-h-24 overflow-auto rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"><p className="font-semibold">Excluded details</p>{summary.warnings.map(warning => <p key={`${warning.voucherId}-${warning.message}`}>{warning.voucherLabel}: {warning.message}</p>)}</div>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button onClick={() => printLoadout(company, summary)} disabled={!summary.rows.length}><Printer className="mr-1.5 h-4 w-4" />Print</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
