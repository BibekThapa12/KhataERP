import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { selectedFiscalYearEndBs } from '@/lib/reports'
import { downloadCsv } from '@/lib/csv'
import {
  agingBuckets,
  getOutstandingReport,
  type AgingBucket,
  type OutstandingDocument,
  type OutstandingKind,
  type PartyOutstandingSummary,
} from '@/lib/managementReports'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { ReportActions } from '@/components/reports/ReportActions'
import { VoucherDetail } from '@/components/tables/VoucherTable'
import { ExpandCollapseControls } from '@/components/ExpandCollapseControls'
import { Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Voucher } from '@/types'

type View = 'summary' | 'aging'
type SortKey = 'party' | AgingBucket | 'outstanding' | 'unapplied' | 'adjustment' | 'ledger'
type SortDirection = 'asc' | 'desc'

const bucketLabels: Record<AgingBucket, string> = {
  'Not Due': 'Not Due',
  '1-30': '1-30 Days',
  '31-60': '31-60 Days',
  '61-90': '61-90 Days',
  '90+': '90+ Days',
}

const bucketTone: Record<AgingBucket, string> = {
  'Not Due': 'border-blue-200 bg-blue-50/60',
  '1-30': 'border-amber-200 bg-amber-50/60',
  '31-60': 'border-orange-200 bg-orange-50/60',
  '61-90': 'border-terracotta/30 bg-terracotta/5',
  '90+': 'border-destructive/30 bg-destructive/5',
}

export function ReceivablesPayablesPage() {
  const { company, parties, rawAccounts, vouchers, loading, error } = useAppStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null)
  const generatedAt = useMemo(() => new Date().toLocaleString('en-NP'), [])

  const kind: OutstandingKind = searchParams.get('kind') === 'payable' ? 'payable' : 'receivable'
  const viewParam = searchParams.get('view')
  const view: View = viewParam === 'aging' || viewParam === 'outstanding' ? 'aging' : 'summary'
  const asOf = searchParams.get('asOf') || selectedFiscalYearEndBs(company)
  const bucketParam = searchParams.get('bucket')
  const activeBucket = agingBuckets.includes(bucketParam as AgingBucket) ? bucketParam as AgingBucket : null
  const search = searchParams.get('search') || ''
  const overdueOnly = searchParams.get('overdue') === '1'
  const hideZero = searchParams.get('hideZero') === '1'
  const sortKey = (searchParams.get('sort') || 'party') as SortKey
  const sortDirection: SortDirection = searchParams.get('direction') === 'desc' ? 'desc' : 'asc'

  const updateParams = (updates: Record<string, string | null>, replace = true) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearchParams(next, { replace })
  }

  const report = useMemo(
    () => getOutstandingReport(kind, parties, rawAccounts, vouchers, asOf),
    [kind, parties, rawAccounts, vouchers, asOf],
  )
  const title = kind === 'receivable' ? 'Receivables Ageing' : 'Payables Ageing'
  const pageTitle = kind === 'receivable' ? 'Debtors Ageing' : 'Creditors Ageing'
  const pageDescription = kind === 'receivable'
    ? 'Customer invoice ageing and reconciled debtor balances'
    : 'Supplier bill ageing and reconciled creditor balances'
  const documentLabel = kind === 'receivable' ? 'Sales Invoice' : 'Purchase Bill'
  const settlementLabel = kind === 'receivable' ? 'Receipt' : 'Payment'
  const grossLabel = kind === 'receivable' ? 'Gross Outstanding Sales Invoices' : 'Gross Outstanding Purchase Bills'
  const unappliedLabel = kind === 'receivable' ? 'Unapplied Receipts' : 'Unapplied Payments'
  const netLabel = kind === 'receivable' ? 'Net Ledger Receivable' : 'Net Ledger Payable'

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = report.summaries.filter(row => {
      const eligibleDocuments = row.documents.filter(document => !activeBucket || document.bucket === activeBucket).filter(document => !overdueOnly || document.age_days > 0)
      const partyMatches = [row.party.name, row.party.phone, row.party.pan_vat].some(value => value?.toLowerCase().includes(needle))
      const voucherMatches = eligibleDocuments.some(document => String(document.voucher.invoice_no || document.voucher.seq).toLowerCase().includes(needle))
      const hasMatchingDocument = eligibleDocuments.length > 0
      const hasUnagedBalance = !activeBucket && !overdueOnly && (row.unapplied !== 0 || row.unallocated_adjustment !== 0 || row.ledger_balance !== 0)
      return (hasMatchingDocument || hasUnagedBalance) && (!needle || partyMatches || voucherMatches)
    })
    const value = (row: PartyOutstandingSummary) => {
      if (sortKey === 'party') return row.party.name.toLowerCase()
      if (agingBuckets.includes(sortKey as AgingBucket)) return row.buckets[sortKey as AgingBucket]
      if (sortKey === 'outstanding') return row.outstanding
      if (sortKey === 'unapplied') return row.unapplied
      if (sortKey === 'adjustment') return row.unallocated_adjustment
      return row.ledger_balance
    }
    return [...rows].sort((a, b) => {
      const left = value(a), right = value(b)
      const result = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right) : Number(left) - Number(right)
      return sortDirection === 'asc' ? result : -result
    })
  }, [activeBucket, overdueOnly, report.summaries, search, sortDirection, sortKey])

  const visibleBuckets = useMemo(() => hideZero
    ? agingBuckets.filter(bucket => filteredRows.some(row => row.buckets[bucket] !== 0))
    : agingBuckets, [filteredRows, hideZero])

  const matchingDocuments = (row: PartyOutstandingSummary) => row.documents.filter(document => {
    if (activeBucket && document.bucket !== activeBucket) return false
    if (overdueOnly && document.age_days <= 0) return false
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    const partyMatches = [row.party.name, row.party.phone, row.party.pan_vat].some(value => value?.toLowerCase().includes(needle))
    return partyMatches || String(document.voucher.invoice_no || document.voucher.seq).toLowerCase().includes(needle)
  })

  const selectBucket = (bucket: AgingBucket) => {
    const next = activeBucket === bucket ? null : bucket
    updateParams({ bucket: next, overdue: next === 'Not Due' ? null : overdueOnly ? '1' : null, view: 'aging' }, false)
  }
  const setSort = (key: SortKey) => updateParams({ sort: key, direction: sortKey === key && sortDirection === 'asc' ? 'desc' : 'asc' })
  const toggleExpanded = (partyId: string) => setExpanded(current => {
    const next = new Set(current)
    if (next.has(partyId)) next.delete(partyId); else next.add(partyId)
    return next
  })

  const exportCsv = () => {
    const filterDescription = [activeBucket ? `Bucket: ${bucketLabels[activeBucket]}` : '', overdueOnly ? 'Overdue only' : '', search ? `Search: ${search}` : ''].filter(Boolean).join('; ') || 'None'
    const metadata: Array<Array<string | number>> = [
      ['Report', title],
      ['Company', company?.name || 'KhataERP'],
      ['As Of', asOf],
      ['Ageing Basis', 'Due date; invoice or bill date fallback'],
      ['Generated', generatedAt],
      ['Active Filters', filterDescription],
    ]
    if (view === 'summary') {
      downloadCsv(`${title}.csv`, ['Row Type','Party',...visibleBuckets.map(bucket => bucketLabels[bucket]),'Gross Outstanding','Unapplied','Opening / Journal Adjustments','Net Ledger Balance'], [
        ...metadata,
        ['Report Total','',...visibleBuckets.map(bucket => report.buckets[bucket]),report.total_outstanding,report.total_unapplied,report.total_adjustments,report.net_ledger_balance],
        ...filteredRows.map(row => ['Party',row.party.name,...visibleBuckets.map(bucket => row.buckets[bucket]),row.outstanding,row.unapplied,row.unallocated_adjustment,row.ledger_balance]),
      ])
      return
    }
    const rows: Array<Array<string | number>> = []
    for (const party of filteredRows) {
      for (const document of matchingDocuments(party)) rows.push(['Document',party.party.name,document.voucher.invoice_no || document.voucher.seq,document.voucher.date_bs,document.due_date_bs,document.original_amount,document.returns,document.settled,document.outstanding,document.age_days,document.bucket,document.status])
      if (!activeBucket && !overdueOnly) {
        for (const unapplied of party.unapplied_rows) rows.push([`Unapplied ${settlementLabel}`,party.party.name,unapplied.voucher.invoice_no || unapplied.voucher.seq,unapplied.voucher.date_bs,'','','','',unapplied.amount,'','','Unapplied'])
        for (const adjustment of party.adjustment_rows) rows.push([adjustment.label,party.party.name,adjustment.voucher?.invoice_no || adjustment.voucher?.seq || '',adjustment.voucher?.date_bs || '','','','','',adjustment.amount,'','','Unallocated adjustment'])
      }
    }
    downloadCsv(`${title}-detailed.csv`, ['Row Type','Party','Voucher','Document Date','Due Date','Original','Returns','Allocated','Outstanding / Amount','Age Days','Bucket','Status'], [...metadata, ...rows])
  }

  const printDetails = view === 'aging'
  return <div className="report-page">
    <PageHeader title={pageTitle} description={pageDescription} action={<ReportActions onExport={exportCsv} />} />
    <PageContent className="report-content space-y-4">
      <div className="report-print-header hidden">
        <h1>{company?.name || 'KhataERP'}</h1>
        <p>{title} | As of {fmtDate(asOf)} | Basis: due date (invoice date fallback)</p>
        <p>View: {printDetails ? 'Detailed' : 'Summary'}{activeBucket ? ` | Bucket: ${bucketLabels[activeBucket]}` : ''}{overdueOnly ? ' | Overdue only' : ''}{search ? ` | Search: ${search}` : ''}</p>
        <p>Generated {generatedAt}</p>
      </div>

      <Card className="report-controls"><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1 rounded-md border bg-background p-0.5" role="group" aria-label="Report view">
            <Button size="sm" variant={view === 'summary' ? 'default' : 'ghost'} onClick={() => updateParams({ view: 'summary' }, false)}>Summary</Button>
            <Button size="sm" variant={view === 'aging' ? 'default' : 'ghost'} onClick={() => updateParams({ view: 'aging' }, false)}>Detailed</Button>
          </div>
          <div className="min-w-[220px] flex-1 sm:max-w-sm"><Label className="sr-only">Search parties or vouchers</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => updateParams({ search: event.target.value || null })} placeholder="Search party, PAN, phone, voucher..." className="pl-9" /></div></div>
          <div className="space-y-1"><Label>As of</Label><NepaliDateInput value={asOf} onChange={value => updateParams({ asOf: value })} className="w-40" /></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={overdueOnly} onChange={event => updateParams({ overdue: event.target.checked ? '1' : null, bucket: event.target.checked && activeBucket === 'Not Due' ? null : activeBucket })} />Show overdue only</label>
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={hideZero} onChange={event => updateParams({ hideZero: event.target.checked ? '1' : null })} />Hide zero columns</label>
          {view === 'aging' && <ExpandCollapseControls className="ml-auto" expanded={filteredRows.length > 0 && filteredRows.every(row => expanded.has(row.party.id))} onToggle={() => { const allExpanded = filteredRows.length > 0 && filteredRows.every(row => expanded.has(row.party.id)); setExpanded(allExpanded ? new Set() : new Set(filteredRows.map(row => row.party.id))) }} />}
        </div>
      </CardContent></Card>

      {error && <Card className="border-destructive/40"><CardContent className="p-4 text-sm text-destructive"><p className="font-semibold">Could not load ageing data</p><p className="mt-1">{error}</p></CardContent></Card>}

      <div className="report-summary grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label={grossLabel} value={report.total_outstanding} />
        <Metric label={unappliedLabel} value={report.total_unapplied} prefix="-" />
        <Metric label="Opening / Journal Adjustments" value={report.total_adjustments} signed />
        <Metric label={netLabel} value={report.net_ledger_balance} emphasized />
        <Metric label="Total Overdue" value={report.total_overdue} />
      </div>
      <p className="text-xs text-muted-foreground">Gross outstanding - unapplied {kind === 'receivable' ? 'receipts' : 'payments'} +/- opening and journal adjustments = net ledger {kind === 'receivable' ? 'receivable' : 'payable'}.</p>

      <div className="report-summary grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {agingBuckets.map(bucket => <button key={bucket} type="button" onClick={() => selectBucket(bucket)} aria-pressed={activeBucket === bucket} className={`rounded-md border p-3 text-left transition-colors hover:border-primary/40 ${bucketTone[bucket]} ${activeBucket === bucket ? 'ring-2 ring-primary ring-offset-1' : ''}`}>
          <span className="text-xs font-semibold uppercase text-muted-foreground">{bucketLabels[bucket]}</span><span className="mt-1 block font-serif text-lg font-bold num">{fmtMoney(report.buckets[bucket])}</span>
        </button>)}
      </div>

      {view === 'aging' && (loading ? <TableState title="Loading ageing details..." /> : filteredRows.length === 0 ? <TableState title={report.summaries.length ? 'No parties match these filters' : `No ${kind === 'receivable' ? 'receivable' : 'payable'} balances as of this date`} /> : <>
        <Card className="report-table-card ageing-screen-table overflow-hidden"><div className="max-h-[65vh] overflow-auto"><table className="w-full min-w-[1280px] border-collapse text-sm">
          <thead className="sticky top-0 z-[2] bg-muted"><tr><Th><span className="sr-only">Expand</span></Th><SortableTh label="Party" sortKey="party" current={sortKey} direction={sortDirection} onSort={setSort} />{visibleBuckets.map(bucket => <SortableTh key={bucket} label={bucketLabels[bucket]} sortKey={bucket} current={sortKey} direction={sortDirection} onSort={setSort} right />)}<SortableTh label="Gross Outstanding" sortKey="outstanding" current={sortKey} direction={sortDirection} onSort={setSort} right /><SortableTh label="Unapplied" sortKey="unapplied" current={sortKey} direction={sortDirection} onSort={setSort} right /><SortableTh label="Opening / Journal" sortKey="adjustment" current={sortKey} direction={sortDirection} onSort={setSort} right /><SortableTh label="Net Ledger" sortKey="ledger" current={sortKey} direction={sortDirection} onSort={setSort} right /></tr></thead>
          <tbody>{filteredRows.map(row => <PartyRows key={row.party.id} row={row} documents={matchingDocuments(row)} visibleBuckets={visibleBuckets} expanded={expanded.has(row.party.id)} onToggle={() => toggleExpanded(row.party.id)} onVoucher={setSelectedVoucher} showUnaged={!activeBucket && !overdueOnly} documentLabel={documentLabel} settlementLabel={settlementLabel} />)}</tbody>
        </table></div></Card>
        <div className="ageing-print-detail"><DetailedPrintTable rows={filteredRows} getDocuments={matchingDocuments} showUnaged={!activeBucket && !overdueOnly} /></div>
      </>)}
    </PageContent>
    <Dialog open={!!selectedVoucher} onOpenChange={open => !open && setSelectedVoucher(null)}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{selectedVoucher?.type} {selectedVoucher?.invoice_no || selectedVoucher?.seq}</DialogTitle></DialogHeader>{selectedVoucher && <VoucherDetail voucher={selectedVoucher} />}</DialogContent></Dialog>
  </div>
}

function Metric({ label, value, prefix = '', signed = false, emphasized = false }: { label: string; value: number; prefix?: string; signed?: boolean; emphasized?: boolean }) {
  const rendered = signed && value > 0 ? `+ ${fmtMoney(value)}` : signed && value < 0 ? `- ${fmtMoney(Math.abs(value))}` : `${prefix ? `${prefix} ` : ''}${fmtMoney(value)}`
  return <Card className={emphasized ? 'border-primary/30 bg-primary/[0.03]' : ''}><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 font-serif text-lg font-bold num">{rendered}</p></CardContent></Card>
}

function PartyRows({ row, documents, visibleBuckets, expanded, onToggle, onVoucher, showUnaged, documentLabel, settlementLabel }: { row: PartyOutstandingSummary; documents: OutstandingDocument[]; visibleBuckets: AgingBucket[]; expanded: boolean; onToggle: () => void; onVoucher: (voucher: Voucher) => void; showUnaged: boolean; documentLabel: string; settlementLabel: string }) {
  const columnCount = visibleBuckets.length + 6
  return <>
    <tr className="border-t hover:bg-muted/30">
      <Td><button type="button" onClick={onToggle} className="rounded p-1 hover:bg-muted" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.party.name}`}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></Td>
      <Td><a className="font-semibold text-primary hover:underline" href={`/parties?party=${encodeURIComponent(row.party.id)}`}>{row.party.name}</a><span className="mt-0.5 block text-xs text-muted-foreground">{row.document_count} document{row.document_count === 1 ? '' : 's'}</span></Td>
      {visibleBuckets.map(bucket => <Td key={bucket} right>{row.buckets[bucket] ? fmtMoney(row.buckets[bucket]) : '-'}</Td>)}
      <Td right><strong>{fmtMoney(row.outstanding)}</strong></Td><Td right>{row.unapplied ? fmtMoney(row.unapplied) : '-'}</Td><Td right>{row.unallocated_adjustment ? fmtMoney(row.unallocated_adjustment) : '-'}</Td><Td right><a className="font-semibold hover:underline" href={`/reports/ledger?account=${encodeURIComponent(row.party.account_id)}`}>{fmtMoney(row.ledger_balance)}</a></Td>
    </tr>
    {expanded && <tr className="border-t bg-muted/10"><td colSpan={columnCount} className="p-3 sm:p-4"><div className="space-y-4">
      <DetailSection title={`${documentLabel}s`} empty="No matching outstanding documents"><DocumentTable documents={documents} onVoucher={onVoucher} /></DetailSection>
      {showUnaged && row.unapplied_rows.length > 0 && <DetailSection title={`Unapplied ${settlementLabel}s`}><table className="w-full text-xs"><thead><tr><NestedTh>Voucher</NestedTh><NestedTh>Date</NestedTh><NestedTh>Note</NestedTh><NestedTh right>Amount</NestedTh></tr></thead><tbody>{row.unapplied_rows.map(entry => <tr key={`${entry.voucher.id}-${row.party.id}`} className="border-t"><NestedTd><VoucherButton voucher={entry.voucher} onClick={onVoucher} /></NestedTd><NestedTd>{fmtDate(entry.voucher.date_bs)}</NestedTd><NestedTd>{entry.voucher.narration || 'Excess amount not allocated to a document'}</NestedTd><NestedTd right>{fmtMoney(entry.amount)}</NestedTd></tr>)}</tbody></table></DetailSection>}
      {showUnaged && row.adjustment_rows.length > 0 && <DetailSection title="Opening and Journal Adjustments"><table className="w-full text-xs"><thead><tr><NestedTh>Type</NestedTh><NestedTh>Date / Voucher</NestedTh><NestedTh>Particulars</NestedTh><NestedTh right>Amount</NestedTh></tr></thead><tbody>{row.adjustment_rows.map(entry => <tr key={entry.id} className="border-t"><NestedTd className="capitalize">{entry.kind}</NestedTd><NestedTd>{entry.voucher ? <><VoucherButton voucher={entry.voucher} onClick={onVoucher} /><span className="ml-2 text-muted-foreground">{fmtDate(entry.voucher.date_bs)}</span></> : '-'}</NestedTd><NestedTd>{entry.label}</NestedTd><NestedTd right>{fmtMoney(entry.amount)}</NestedTd></tr>)}</tbody></table></DetailSection>}
    </div></td></tr>}
  </>
}

function DocumentTable({ documents, onVoucher }: { documents: OutstandingDocument[]; onVoucher: (voucher: Voucher) => void }) {
  if (!documents.length) return <p className="py-4 text-center text-sm text-muted-foreground">No matching outstanding documents</p>
  return <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-xs"><thead><tr><NestedTh>Voucher</NestedTh><NestedTh>Invoice / Bill Date</NestedTh><NestedTh>Due Date</NestedTh><NestedTh right>Original</NestedTh><NestedTh>Returns / Notes</NestedTh><NestedTh right>Allocated</NestedTh><NestedTh right>Outstanding</NestedTh><NestedTh right>Age</NestedTh><NestedTh>Bucket</NestedTh><NestedTh>Status</NestedTh></tr></thead><tbody>{documents.map(document => <tr key={document.voucher.id} className="border-t"><NestedTd><VoucherButton voucher={document.voucher} onClick={onVoucher} /></NestedTd><NestedTd>{fmtDate(document.voucher.date_bs)}</NestedTd><NestedTd>{fmtDate(document.due_date_bs)}{document.due_date_source !== 'due-date' && <Badge variant="outline" className={`ml-2 px-1.5 py-0 text-[10px] ${document.due_date_source === 'invalid' ? 'border-destructive text-destructive' : ''}`}>{document.due_date_source === 'invalid' ? 'Invalid date' : 'Invoice date used'}</Badge>}</NestedTd><NestedTd right>{fmtMoney(document.original_amount)}</NestedTd><NestedTd>{document.returns ? <><span className="num">{fmtMoney(document.returns)}</span>{document.return_vouchers.length > 0 && <span className="ml-1 text-muted-foreground">({document.return_vouchers.map(item => item.invoice_no || item.seq).join(', ')})</span>}</> : document.voucher.narration || '-'}</NestedTd><NestedTd right>{fmtMoney(document.settled)}</NestedTd><NestedTd right><strong>{fmtMoney(document.outstanding)}</strong></NestedTd><NestedTd right>{document.age_days}</NestedTd><NestedTd><Badge variant="outline">{bucketLabels[document.bucket]}</Badge></NestedTd><NestedTd><div className="flex flex-wrap gap-1"><Badge variant={document.status === 'Overdue' ? 'destructive' : 'secondary'}>{document.status}</Badge>{document.settled > 0 && document.outstanding > 0 && <Badge variant="outline">Partially Allocated</Badge>}</div></NestedTd></tr>)}</tbody></table></div>
}

function DetailedPrintTable({ rows, getDocuments, showUnaged }: { rows: PartyOutstandingSummary[]; getDocuments: (row: PartyOutstandingSummary) => OutstandingDocument[]; showUnaged: boolean }) {
  return <Card className="report-table-card"><table className="w-full border-collapse text-xs"><thead><tr><Th>Party / Row</Th><Th>Voucher</Th><Th>Date</Th><Th>Due</Th><Th right>Original</Th><Th right>Returns</Th><Th right>Allocated</Th><Th right>Outstanding / Amount</Th><Th>Aging</Th></tr></thead><tbody>{rows.flatMap(row => {
    const result: React.ReactNode[] = [<tr key={`party-${row.party.id}`} className="border-t bg-muted/40 font-semibold"><Td>{row.party.name}</Td><Td>{row.document_count} documents</Td><Td /><Td /><Td right>{fmtMoney(row.outstanding)}</Td><Td /><Td right>{fmtMoney(row.unapplied)}</Td><Td right>{fmtMoney(row.ledger_balance)}</Td><Td>Party total</Td></tr>]
    for (const document of getDocuments(row)) result.push(<tr key={document.voucher.id} className="border-t"><Td>Document</Td><Td>{document.voucher.invoice_no || document.voucher.seq}</Td><Td>{fmtDate(document.voucher.date_bs)}</Td><Td>{fmtDate(document.due_date_bs)}</Td><Td right>{fmtMoney(document.original_amount)}</Td><Td right>{fmtMoney(document.returns)}</Td><Td right>{fmtMoney(document.settled)}</Td><Td right>{fmtMoney(document.outstanding)}</Td><Td>{document.age_days} days / {bucketLabels[document.bucket]}</Td></tr>)
    if (showUnaged) {
      for (const entry of row.unapplied_rows) result.push(<tr key={`unapplied-${entry.voucher.id}-${row.party.id}`} className="border-t"><Td>Unapplied settlement</Td><Td>{entry.voucher.invoice_no || entry.voucher.seq}</Td><Td>{fmtDate(entry.voucher.date_bs)}</Td><Td /><Td /><Td /><Td /><Td right>{fmtMoney(entry.amount)}</Td><Td>Not aged</Td></tr>)
      for (const entry of row.adjustment_rows) result.push(<tr key={entry.id} className="border-t"><Td>{entry.label}</Td><Td>{entry.voucher?.invoice_no || entry.voucher?.seq || '-'}</Td><Td>{entry.voucher ? fmtDate(entry.voucher.date_bs) : '-'}</Td><Td /><Td /><Td /><Td /><Td right>{fmtMoney(entry.amount)}</Td><Td>Not aged</Td></tr>)
    }
    return result
  })}</tbody></table></Card>
}

function DetailSection({ title, children, empty }: { title: string; children: React.ReactNode; empty?: string }) { return <section><h3 className="mb-2 text-sm font-semibold">{title}</h3>{children || <p className="text-sm text-muted-foreground">{empty}</p>}</section> }
function VoucherButton({ voucher, onClick }: { voucher: Voucher; onClick: (voucher: Voucher) => void }) { return <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onClick(voucher)}>{voucher.invoice_no || `${voucher.type} ${voucher.seq}`}</button> }
function TableState({ title }: { title: string }) { return <Card><CardContent className="py-14 text-center text-sm text-muted-foreground">{title}</CardContent></Card> }
function SortableTh({ label, sortKey, current, direction, onSort, right }: { label: string; sortKey: SortKey; current: SortKey; direction: SortDirection; onSort: (key: SortKey) => void; right?: boolean }) { return <th className={`report-th whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}><button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(sortKey)}>{label}{current === sortKey && <span aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span>}</button></th> }
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) { return <th className={`report-th whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{children}</th> }
function Td({ children, right }: { children?: React.ReactNode; right?: boolean }) { return <td className={`report-td ${right ? 'text-right num' : ''}`}>{children}</td> }
function NestedTh({ children, right }: { children: React.ReactNode; right?: boolean }) { return <th className={`whitespace-nowrap bg-muted/50 px-2 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground ${right ? 'text-right' : 'text-left'}`}>{children}</th> }
function NestedTd({ children, right, className = '' }: { children: React.ReactNode; right?: boolean; className?: string }) { return <td className={`px-2 py-2 align-top ${right ? 'text-right num' : ''} ${className}`}>{children}</td> }
