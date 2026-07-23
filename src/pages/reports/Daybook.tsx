import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Columns3, Download, FileText, Info, MoreVertical, Printer, ScanLine, Search, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { getDaybookRows, selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { makeBsKey } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { normalizeSearch } from '@/lib/search'
import { legacySettlementAccountId } from '@/lib/banks'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { FormalReportPrintFooter, FormalReportPrintHeader } from '@/components/reports/FormalReportPrint'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { JournalForm, ReceiptPaymentForm } from '@/components/forms/OtherForms'
import { ReturnForm } from '@/components/forms/ReturnForm'
import { Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import type { Voucher } from '@/types'

const badgeVariant = (type: Voucher['type'], cancelled: boolean) => {
  if (cancelled) return 'cancelled' as const
  const variants = { Sales: 'sales', Purchase: 'purchase', Receipt: 'receipt', Payment: 'payment', Journal: 'journal' } as const
  return type === 'Stock Adjustment' ? 'secondary' as const : variants[type]
}

const printMoney = (value: number) => fmtMoney(value).replace(/^(-?)Rs\u00a0/, '$1')

function MetricCard({ label, value, note, Icon, tone = 'default' }: { label: string; value: string; note: string; Icon: typeof FileText; tone?: 'default' | 'debit' | 'credit' | 'warning' }) {
  const colors = tone === 'debit' ? 'bg-red-50 text-red-600' : tone === 'credit' ? 'bg-emerald-50 text-emerald-600' : tone === 'warning' ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'
  return <Card className="min-w-0"><CardContent className="flex min-w-0 items-center gap-2.5 p-3 sm:p-4"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${colors}`}><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">{label}</span><span title={value} className="mt-0.5 block whitespace-nowrap font-serif font-bold leading-tight tracking-tight num text-[clamp(1rem,1.35vw,1.25rem)]">{value}</span><span className="block text-xs text-muted-foreground">{note}</span></span></CardContent></Card>
}

type OptionalColumn = 'narration' | 'debit' | 'credit' | 'net' | 'status'

export function DaybookPage() {
  const { company, rawAccounts, parties, vouchers } = useAppStore()
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(() => selectedFiscalYearStartBs(company))
  const [to, setTo] = useState(() => selectedFiscalYearEndBs(company))
  const [showCancelled, setShowCancelled] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cancelled'>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [showColumns, setShowColumns] = useState(false)
  const [columns, setColumns] = useState<Set<OptionalColumn>>(() => new Set(['narration', 'debit', 'credit', 'net', 'status']))
  const [selected, setSelected] = useState<Voucher | null>(null)
  const [editing, setEditing] = useState<Voucher | null>(null)

  const rows = useMemo(() => {
    const fromKey = makeBsKey(from)
    const toKey = makeBsKey(to)
    const query = normalizeSearch(search)
    return getDaybookRows(vouchers, rawAccounts, parties).filter(row =>
      row.date_bs_key >= fromKey && row.date_bs_key <= toKey && (showCancelled || !row.cancelled)
    ).filter(row => typeFilter === 'all' || row.voucher_type === typeFilter)
      .filter(row => statusFilter === 'all' || (statusFilter === 'cancelled' ? row.cancelled : !row.cancelled))
      .filter(row => !query || normalizeSearch(`${row.date_bs} ${row.voucher_type} ${row.voucher_no} ${row.particulars} ${row.narration}`).includes(query))
  }, [vouchers, rawAccounts, parties, from, to, showCancelled, search, typeFilter, statusFilter])

  const activeRows = rows.filter(row => !row.cancelled)
  const totalDebit = activeRows.reduce((sum, row) => sum + row.debit, 0)
  const totalCredit = activeRows.reduce((sum, row) => sum + row.credit, 0)
  const netTotal = totalDebit - totalCredit
  const difference = Math.abs(netTotal)
  const accountNames = useMemo(() => new Map(rawAccounts.map(account => [account.id, account.name])), [rawAccounts])
  const partyNames = useMemo(() => new Map(parties.map(party => [party.account_id, party.name])), [parties])
  const accountName = (id: string) => partyNames.get(id) || accountNames.get(id) || id
  const rowParticulars = (row: typeof rows[number]) => {
    if (row.voucher_type !== 'Receipt' && row.voucher_type !== 'Payment') return { primary: row.particulars, secondary: '' }
    const settlementId = legacySettlementAccountId(row.voucher)
    return { primary: settlementId ? accountName(settlementId) : row.particulars, secondary: row.particulars }
  }
  const toggleColumn = (column: OptionalColumn) => setColumns(current => { const next = new Set(current); if (next.has(column)) next.delete(column); else next.add(column); return next })
  const exportCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const data = [['Date', 'Voucher Type', 'Voucher No.', 'Party / Account', 'Narration', 'Debit', 'Credit', 'Net Amount', 'Status'], ...rows.map(row => [row.date_bs, row.voucher_type, row.voucher_no, rowParticulars(row).primary, row.narration, row.debit, row.credit, row.debit - row.credit, row.cancelled ? 'Cancelled' : 'Active'])]
    const blob = new Blob([data.map(record => record.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `daybook-${from}-to-${to}.csv`; link.click(); URL.revokeObjectURL(url)
  }

  const editVoucher = (voucher: Voucher) => {
    setSelected(null)
    setEditing(voucher)
  }
  const closeEdit = () => setEditing(null)

  return (
    <div className="report-page daybook-report-page">
      <PageHeader
        title="Day Book"
        description="Summary of all transactions for the selected period"
        action={<div className="flex gap-2"><Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button></div>}
      />
      <PageContent className="report-content space-y-4">
        <FormalReportPrintHeader company={company} title="Day Book" periodLabel={`${fmtDate(from)} to ${fmtDate(to)}`} />
        <Card className="report-controls">
          <CardContent className="p-4 flex flex-wrap items-end justify-between gap-4">
            <ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} />
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={showCancelled} onChange={event => setShowCancelled(event.target.checked)} className="h-4 w-4 accent-primary" />
              Show cancelled
            </label>
          </CardContent>
        </Card>

        <div className="report-summary grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 min-[1280px]:grid-cols-5">
          <MetricCard label="Total Vouchers" value={String(activeRows.length)} note="Active vouchers" Icon={FileText} />
          <MetricCard label="Total Debit" value={fmtMoney(totalDebit)} note="Debit movements" Icon={ArrowDown} tone="debit" />
          <MetricCard label="Total Credit" value={fmtMoney(totalCredit)} note="Credit movements" Icon={ArrowUp} tone="credit" />
          <MetricCard label="Net Total" value={fmtMoney(netTotal)} note="Debit - Credit" Icon={FileText} />
          <MetricCard label="Difference" value={fmtMoney(difference)} note={difference < 0.01 ? 'Balanced' : 'Review required'} Icon={ScanLine} tone={difference < 0.01 ? 'default' : 'warning'} />
        </div>

        <Card className="report-controls"><CardContent className="space-y-3 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Button variant="outline" size="sm" onClick={() => setShowColumns(value => !value)}><Columns3 className="mr-2 h-4 w-4" />Columns</Button>
            <div className="relative min-w-0 flex-1 md:ml-auto md:max-w-md"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search voucher no., party, account…" className="pl-8" /></div>
            <Button variant={showFilters ? 'default' : 'outline'} size="sm" onClick={() => setShowFilters(value => !value)}><SlidersHorizontal className="mr-2 h-4 w-4" />Filters</Button>
          </div>
          {showColumns && <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border bg-muted/20 p-3">{(['narration', 'debit', 'credit', 'net', 'status'] as OptionalColumn[]).map(column => <label key={column} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={columns.has(column)} onChange={() => toggleColumn(column)} />{column === 'net' ? 'Net Amount' : column}</label>)}</div>}
          {showFilters && <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2"><SearchableSelect value={typeFilter} onValueChange={setTypeFilter} options={[{ value: 'all', label: 'All Voucher Types' }, ...(['Sales', 'Purchase', 'Sales Return', 'Purchase Return', 'Receipt', 'Payment', 'Journal', 'Stock Adjustment'] as Voucher['type'][]).map(type => ({ value: type, label: type }))]} /><SearchableSelect value={statusFilter} onValueChange={value => { const next = value as typeof statusFilter; setStatusFilter(next); if (next === 'cancelled') setShowCancelled(true) }} options={[{ value: 'all', label: 'All Included Status' }, { value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} /></div>}
        </CardContent></Card>

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
                    {columns.has('narration') && <th className="daybook-print-hide report-th text-left">Narration</th>}
                    {columns.has('debit') && <th className="report-th text-right"><span className="daybook-screen-money">Debit</span><span className="daybook-print-money hidden">Debit (Rs.)</span></th>}
                    {columns.has('credit') && <th className="report-th text-right"><span className="daybook-screen-money">Credit</span><span className="daybook-print-money hidden">Credit (Rs.)</span></th>}
                    {columns.has('net') && <th className="daybook-print-hide report-th text-right">Net Amount</th>}
                    {columns.has('status') && <th className="daybook-print-hide report-th text-left">Status</th>}
                    <th className="report-th report-controls text-center">Action</th>
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
                      <td className="report-td font-medium">{(() => { const names = rowParticulars(row); return <>{names.primary}{names.secondary && names.secondary !== names.primary && <span className="block text-xs font-normal text-muted-foreground">{names.secondary}</span>}</> })()}</td>
                      {columns.has('narration') && <td className="daybook-print-hide report-td max-w-[220px] truncate text-muted-foreground">{row.narration || '-'}</td>}
                      {columns.has('debit') && <td className="report-td text-right num debit-amt"><span className="daybook-screen-money">{row.debit ? fmtMoney(row.debit) : '—'}</span><span className="daybook-print-money hidden">{row.debit ? printMoney(row.debit) : '—'}</span></td>}
                      {columns.has('credit') && <td className="report-td text-right num credit-amt"><span className="daybook-screen-money">{row.credit ? fmtMoney(row.credit) : '—'}</span><span className="daybook-print-money hidden">{row.credit ? printMoney(row.credit) : '—'}</span></td>}
                      {columns.has('net') && <td className={`daybook-print-hide report-td text-right num font-semibold ${row.debit - row.credit > 0 ? 'debit-amt' : row.credit - row.debit > 0 ? 'credit-amt' : ''}`}>{fmtMoney(Math.abs(row.debit - row.credit))}</td>}
                      {columns.has('status') && <td className="daybook-print-hide report-td"><Badge variant={row.cancelled ? 'cancelled' : 'default'}>{row.cancelled ? 'Cancelled' : 'Active'}</Badge></td>}
                      <td className="report-td report-controls text-center"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${row.voucher_no}`} onClick={event => { event.stopPropagation(); setSelected(row.voucher) }}><MoreVertical className="h-4 w-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="daybook-screen-total border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="report-td" colSpan={4 + (columns.has('narration') ? 1 : 0)}>Period totals ({activeRows.length} active voucher{activeRows.length === 1 ? '' : 's'})</td>
                    {columns.has('debit') && <td className="report-td text-right num debit-amt"><span className="daybook-screen-money">{fmtMoney(totalDebit)}</span><span className="daybook-print-money hidden">{printMoney(totalDebit)}</span></td>}
                    {columns.has('credit') && <td className="report-td text-right num credit-amt"><span className="daybook-screen-money">{fmtMoney(totalCredit)}</span><span className="daybook-print-money hidden">{printMoney(totalCredit)}</span></td>}
                    {columns.has('net') && <td className="report-td text-right num">{fmtMoney(Math.abs(netTotal))}</td>}
                    {columns.has('status') && <td className="report-td"></td>}
                    <td className="report-td report-controls"></td>
                  </tr>
                  <tr className="daybook-print-total hidden border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="report-td" colSpan={4}>Period totals ({activeRows.length} active voucher{activeRows.length === 1 ? '' : 's'})</td>
                    {columns.has('debit') && <td className="report-td text-right num debit-amt">{printMoney(totalDebit)}</td>}
                    {columns.has('credit') && <td className="report-td text-right num credit-amt">{printMoney(totalCredit)}</td>}
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
        <Card className="report-controls"><CardContent className="grid gap-4 p-4 text-sm sm:grid-cols-3"><div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600"><ArrowDown className="h-4 w-4" /></span><span><strong className="block">Debit</strong><span className="text-xs text-muted-foreground">Asset / expense increase</span></span></div><div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><ArrowUp className="h-4 w-4" /></span><span><strong className="block">Credit</strong><span className="text-xs text-muted-foreground">Income / liability increase</span></span></div><div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600"><FileText className="h-4 w-4" /></span><span><strong className="block">Net Amount</strong><span className="text-xs text-muted-foreground">Absolute debit-credit difference</span></span></div></CardContent></Card>
        <div className="report-controls flex gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><strong className="block">About Day Book</strong><p className="mt-1 text-xs text-muted-foreground">Day Book shows all vouchers in chronological order. Open any row to view, edit, print, or cancel the underlying voucher.</p></div></div>
        <FormalReportPrintFooter />
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
