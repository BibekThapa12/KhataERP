import { useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, Edit2, Eye, PackageMinus, PackageOpen, PackagePlus, Printer } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { computeStockLedger } from '@/lib/engine'
import { categoryPath } from '@/lib/categoryHierarchy'
import { downloadCsv } from '@/lib/csv'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { ReportActions } from '@/components/reports/ReportActions'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { VoucherDetail } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { ReturnForm } from '@/components/forms/ReturnForm'
import { StatCard } from '@/components/StatCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { Item, Voucher } from '@/types'

function number(value: number) {
  return value.toLocaleString('en-NP', { maximumFractionDigits: 4 })
}

function quantityLabel(value: number, item: Item) {
  const equivalent = item.alternate_unit && item.alternate_conversion
    ? ` (${number(value * item.alternate_conversion)} ${item.alternate_unit})`
    : ''
  return `${number(value)} ${item.unit}${equivalent}`
}

function QuantityCell({ value, item }: { value: number; item: Item }) {
  return <><span className="block whitespace-nowrap num">{number(value)} {item.unit}</span>{item.alternate_unit && item.alternate_conversion && <span className="block whitespace-nowrap text-[11px] text-muted-foreground">({number(value * item.alternate_conversion)} {item.alternate_unit})</span>}</>
}

export function StockLedgerPage() {
  const { company, items, vouchers, parties, itemCategories } = useAppStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('item') || ''
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(() => selectedFiscalYearStartBs(company))
  const [to, setTo] = useState(() => selectedFiscalYearEndBs(company))
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null)
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null)
  const printableVoucherRef = useRef<HTMLDivElement>(null)
  const pendingPrintWindow = useRef<Window | null>(null)
  const [printRequest, setPrintRequest] = useState(0)
  const method = company?.inventory_valuation_method || 'weighted_average'
  const methodLabel = method === 'fifo' ? 'FIFO' : method === 'lifo' ? 'LIFO' : 'Weighted Average'
  const sortedItems = useMemo(() => [...items].sort((left, right) => Number(left.is_archived) - Number(right.is_archived) || left.name.localeCompare(right.name)), [items])

  useEffect(() => { if (range === 'fiscal') { setFrom(selectedFiscalYearStartBs(company)); setTo(selectedFiscalYearEndBs(company)) } }, [company, range])
  useEffect(() => {
    if (sortedItems.some(item => item.id === selectedId) || !sortedItems.length) return
    const first = sortedItems.find(item => !item.is_archived) || sortedItems[0]
    setSearchParams({ item: first.id }, { replace: true })
  }, [selectedId, setSearchParams, sortedItems])

  const item = sortedItems.find(candidate => candidate.id === selectedId) || null
  const ledger = useMemo(() => item ? computeStockLedger(item, vouchers, from, to, method) : null, [item, vouchers, from, to, method])
  const voucherById = useMemo(() => new Map(vouchers.map(voucher => [voucher.id, voucher])), [vouchers])
  const partyByAccount = useMemo(() => new Map(parties.map(party => [party.account_id, party])), [parties])
  const particulars = (voucherId: string) => {
    const voucher = voucherById.get(voucherId)
    if (!voucher) return '—'
    if (voucher.party?.name) return voucher.party.name
    if (voucher.party_account_id && partyByAccount.get(voucher.party_account_id)?.name) return partyByAccount.get(voucher.party_account_id)!.name
    return voucher.type === 'Stock Adjustment' ? 'Stock Adjustment' : voucher.is_cash ? 'Cash' : '—'
  }

  const canEditVoucher = (voucher: Voucher) => !voucher.cancelled && ['Sales', 'Purchase', 'Sales Return', 'Purchase Return'].includes(voucher.type)
  const editVoucher = (voucher: Voucher) => {
    if (!canEditVoucher(voucher)) return
    setSelectedVoucher(null)
    setEditingVoucher(voucher)
  }
  const requestVoucherPrint = (voucher: Voucher) => {
    const printWindow = window.open('', '_blank', 'width=850,height=900')
    if (!printWindow) return
    pendingPrintWindow.current = printWindow
    setSelectedVoucher(voucher)
    setPrintRequest(request => request + 1)
  }

  useEffect(() => {
    const printWindow = pendingPrintWindow.current
    const printable = printableVoucherRef.current
    if (!printRequest || !printWindow || !printable || !selectedVoucher) return
    pendingPrintWindow.current = null
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(node => node.outerHTML).join('\n')
    printWindow.document.open()
    printWindow.document.write(`<!doctype html><html><head><title>${selectedVoucher.type} ${selectedVoucher.invoice_no || selectedVoucher.seq}</title>${styles}<style>@page{margin:12mm}.voucher-print-sheet{max-width:190mm;margin:0 auto;padding:8mm;color:#111827}@media print{button{display:none!important}}</style></head><body><main class="voucher-print-sheet">${printable.innerHTML}</main></body></html>`)
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => printWindow.print(), 250)
  }, [printRequest, selectedVoucher])

  const selectItem = (value: string) => setSearchParams(value ? { item: value } : {}, { replace: true })
  const exportCsv = () => {
    if (!item || !ledger) return
    downloadCsv(`stock-ledger-${item.name}-${from}-to-${to}.csv`, ['Date', 'Voucher Type', 'Voucher No.', 'Particulars', 'Narration', 'Inward Qty', 'Inward Rate', 'Inward Value', 'Outward Qty', 'Outward Rate', 'Outward Value', 'Balance Qty', 'Balance Rate', 'Balance Value'], ledger.movements.map(row => [row.date_bs, row.voucher_type, row.voucher_no, particulars(row.voucher_id), row.narration, row.inward_qty || '', row.inward_rate || '', row.inward_value || '', row.outward_qty || '', row.outward_rate || '', row.outward_value || '', row.balance_qty, row.balance_rate, row.balance_value]))
  }

  return <div className="report-page">
    <PageHeader title="Stock Ledger" description={`Item-wise inventory movements with ${methodLabel} valuation`} action={<ReportActions onExport={exportCsv} />} />
    <PageContent className="report-content space-y-4">
      <div className="report-print-header hidden"><h1>{company?.name || 'KhataERP'}</h1><p>Stock Ledger · {item?.name || 'No item selected'} | {fmtDate(from)} to {fmtDate(to)} | {methodLabel}</p></div>
      <Card className="report-controls"><CardContent className="space-y-4 p-4">
        <div className="max-w-2xl space-y-1.5"><Label>Stock Item</Label><SearchableSelect value={selectedId} onValueChange={selectItem} placeholder="Select stock item" searchPlaceholder="Search name, SKU, barcode, category or unit…" emptyMessage="No matching stock items" options={sortedItems.map(candidate => ({ value: candidate.id, label: `${candidate.name}${candidate.is_archived ? ' (Archived)' : ''}`, searchText: `${candidate.sku || ''} ${candidate.barcode || ''} ${categoryPath(itemCategories, candidate.category_id)} ${candidate.unit} ${candidate.alternate_unit || ''}` }))} /></div>
        <ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} />
      </CardContent></Card>

      {item && ledger ? <>
        <div className="report-summary grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Opening Stock" value={quantityLabel(ledger.opening_qty, item)} sub={`${fmtMoney(ledger.opening_value)} @ ${fmtMoney(ledger.opening_rate)}`} Icon={PackageOpen} />
          <StatCard label="Total Inward" value={quantityLabel(ledger.inward_qty, item)} sub={fmtMoney(ledger.inward_value)} color="positive" Icon={PackagePlus} />
          <StatCard label="Total Outward" value={quantityLabel(ledger.outward_qty, item)} sub={fmtMoney(ledger.outward_value)} color="negative" Icon={PackageMinus} />
          <StatCard label="Closing Stock" value={quantityLabel(ledger.closing_qty, item)} sub={`${fmtMoney(ledger.closing_value)} @ ${fmtMoney(ledger.closing_rate)}`} Icon={Boxes} />
        </div>
        <Card className="report-table-card overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full min-w-[1450px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50"><th rowSpan={2} className="report-th text-left">Date</th><th rowSpan={2} className="report-th text-left">Voucher Type</th><th rowSpan={2} className="report-th text-left">Voucher No.</th><th rowSpan={2} className="report-th text-left">Party / Particulars</th><th rowSpan={2} className="report-th text-left">Narration</th><th colSpan={3} className="report-th text-center text-emerald-700">Inward</th><th colSpan={3} className="report-th text-center text-red-700">Outward</th><th colSpan={3} className="report-th text-center">Balance</th><th rowSpan={2} className="report-th text-right print:hidden">Actions</th></tr>
              <tr className="border-t bg-muted/30">{['Qty', 'Rate', 'Value', 'Qty', 'Rate', 'Value', 'Qty', 'Rate', 'Value'].map((heading, index) => <th key={`${heading}-${index}`} className="report-th text-right">{heading}</th>)}</tr>
            </thead>
            <tbody>
              <tr className="border-t bg-amber-50/60 font-medium"><td className="report-td text-muted-foreground">Before {fmtDate(from)}</td><td colSpan={4} className="report-td italic">Opening Balance b/f</td><td colSpan={6}></td><td className="report-td text-right"><QuantityCell value={ledger.opening_qty} item={item} /></td><td className="report-td text-right num">{fmtMoney(ledger.opening_rate)}</td><td className="report-td text-right num">{fmtMoney(ledger.opening_value)}</td><td className="print:hidden"></td></tr>
              {ledger.movements.map((row, index) => {
                const voucher = voucherById.get(row.voucher_id)
                return <tr key={`${row.voucher_id}-${index}`} tabIndex={voucher ? 0 : undefined} aria-label={voucher ? `View ${voucher.type} ${row.voucher_no}` : undefined} onClick={() => voucher && setSelectedVoucher(voucher)} onKeyDown={event => { if (voucher && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedVoucher(voucher) } }} className="cursor-pointer border-t transition-colors hover:bg-muted/30 focus:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><td className="report-td whitespace-nowrap">{fmtDate(row.date_bs)}</td><td className="report-td">{row.voucher_type}</td><td className="report-td font-medium text-primary underline-offset-4">{row.voucher_no}</td><td className="report-td">{particulars(row.voucher_id)}</td><td className="report-td max-w-56 truncate text-muted-foreground" title={row.narration}>{row.narration || '—'}</td><td className="report-td text-right text-emerald-700">{row.inward_qty ? <QuantityCell value={row.inward_qty} item={item} /> : '—'}</td><td className="report-td text-right num text-emerald-700">{row.inward_qty ? fmtMoney(row.inward_rate) : '—'}</td><td className="report-td text-right num text-emerald-700">{row.inward_qty ? fmtMoney(row.inward_value) : '—'}</td><td className="report-td text-right text-red-700">{row.outward_qty ? <QuantityCell value={row.outward_qty} item={item} /> : '—'}</td><td className="report-td text-right num text-red-700">{row.outward_qty ? fmtMoney(row.outward_rate) : '—'}</td><td className="report-td text-right num text-red-700">{row.outward_qty ? fmtMoney(row.outward_value) : '—'}</td><td className="report-td text-right font-semibold"><QuantityCell value={row.balance_qty} item={item} /></td><td className="report-td text-right num">{fmtMoney(row.balance_rate)}</td><td className="report-td text-right num font-semibold">{fmtMoney(row.balance_value)}</td><td className="report-td print:hidden"><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon" title="View voucher" aria-label={`View ${row.voucher_no}`} onClick={event => { event.stopPropagation(); if (voucher) setSelectedVoucher(voucher) }}><Eye className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" title="Print voucher" aria-label={`Print ${row.voucher_no}`} onClick={event => { event.stopPropagation(); if (voucher) requestVoucherPrint(voucher) }}><Printer className="h-4 w-4" /></Button>{voucher && canEditVoucher(voucher) && <Button type="button" variant="ghost" size="icon" title="Edit voucher" aria-label={`Edit ${row.voucher_no}`} onClick={event => { event.stopPropagation(); editVoucher(voucher) }}><Edit2 className="h-4 w-4" /></Button>}</div></td></tr>
              })}
              {!ledger.movements.length && <tr><td colSpan={15} className="px-4 py-14 text-center text-muted-foreground"><Boxes className="mx-auto mb-3 h-8 w-8 opacity-30" /><p className="font-medium text-foreground">No stock movements in this period</p><p className="mt-1 text-sm">Opening and closing balances are still shown.</p></td></tr>}
            </tbody>
            <tfoot><tr className="border-t-2 bg-muted/30 font-semibold"><td colSpan={5} className="report-td">Period Total</td><td className="report-td text-right"><QuantityCell value={ledger.inward_qty} item={item} /></td><td></td><td className="report-td text-right num">{fmtMoney(ledger.inward_value)}</td><td className="report-td text-right"><QuantityCell value={ledger.outward_qty} item={item} /></td><td></td><td className="report-td text-right num">{fmtMoney(ledger.outward_value)}</td><td className="report-td text-right"><QuantityCell value={ledger.closing_qty} item={item} /></td><td className="report-td text-right num">{fmtMoney(ledger.closing_rate)}</td><td className="report-td text-right num">{fmtMoney(ledger.closing_value)}</td><td className="print:hidden"></td></tr></tfoot>
          </table></div>
        </Card>
      </> : <Card><CardContent className="py-16 text-center text-muted-foreground"><Boxes className="mx-auto mb-3 h-9 w-9 opacity-30" /><p className="font-medium text-foreground">No stock item selected</p><p className="mt-1 text-sm">Select an item to view its stock ledger.</p></CardContent></Card>}
    </PageContent>

    <Dialog open={!!selectedVoucher} onOpenChange={open => { if (!open) setSelectedVoucher(null) }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{selectedVoucher?.type} {selectedVoucher?.invoice_no ? `· ${selectedVoucher.invoice_no}` : ''}</DialogTitle></DialogHeader>
        {selectedVoucher && <div ref={printableVoucherRef} className="space-y-5"><div className="hidden print:block"><h1 className="text-2xl font-bold">{company?.name || 'KhataERP'}</h1><p className="text-sm text-muted-foreground">{selectedVoucher.type} {selectedVoucher.invoice_no || selectedVoucher.seq}</p></div><VoucherDetail voucher={selectedVoucher} /></div>}
        {selectedVoucher && <DialogFooter className="print:hidden"><Button variant="outline" onClick={() => requestVoucherPrint(selectedVoucher)}><Printer className="mr-1.5 h-4 w-4" />Print</Button>{canEditVoucher(selectedVoucher) && <Button onClick={() => editVoucher(selectedVoucher)}><Edit2 className="mr-1.5 h-4 w-4" />Edit Voucher</Button>}</DialogFooter>}
      </DialogContent>
    </Dialog>

    {editingVoucher && (editingVoucher.type === 'Sales' || editingVoucher.type === 'Purchase') && <InvoiceForm type={editingVoucher.type} open voucher={editingVoucher} onClose={() => setEditingVoucher(null)} />}
    {editingVoucher && (editingVoucher.type === 'Sales Return' || editingVoucher.type === 'Purchase Return') && <ReturnForm type={editingVoucher.type} open voucher={editingVoucher} onClose={() => setEditingVoucher(null)} />}
  </div>
}
