import { useEffect, useMemo, useRef, useState } from 'react'
import { Barcode, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, History, Loader2, PackageCheck, PackageX, Printer, RefreshCw, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { fetchInventorySerialHistory, fetchInventorySerialItemGroups, fetchInventorySerialRegister, fetchVoucherBundle, type InventorySerialRegisterFilters } from '@/lib/supabase'
import { publicErrorMessage } from '@/lib/security'
import { downloadCsv } from '@/lib/csv'
import { collectInventorySerialRegisterRows } from '@/lib/serialReporting'
import { cn, fmtDate } from '@/lib/utils'
import { itemSelectorOption } from '@/lib/selectorOptions'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { FormalReportPrintFooter, FormalReportPrintHeader } from '@/components/reports/FormalReportPrint'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { VoucherDetail } from '@/components/tables/VoucherTable'
import { ExpandCollapseControls } from '@/components/ExpandCollapseControls'
import { printPersistedVoucher } from '@/lib/voucherPrinterRegistry'
import type { InventorySerialItemGroup, InventorySerialItemGroupResult, InventorySerialMovement, InventorySerialRegisterRow, InventorySerialStatus, StockCondition, Voucher } from '@/types'

const ITEM_PAGE_SIZE = 15
const EXPORT_PAGE_SIZE = 200

const EMPTY_RESULT: InventorySerialItemGroupResult = {
  company_id: '', generated_at: '', total_count: 0, total_items: 0,
  summary: { total: 0, available: 0, saleable: 0, damaged: 0, expired: 0, sold: 0, returned_to_supplier: 0, adjusted_out: 0, unavailable: 0 },
  groups: [],
}

const STATUS_LABELS: Record<InventorySerialStatus, string> = {
  available: 'Available',
  sold: 'Sold',
  returned_to_supplier: 'Returned to Supplier',
  adjusted_out: 'Adjusted Out',
  unavailable: 'Inactive',
}

const CONDITION_LABELS: Record<StockCondition, string> = { saleable: 'Saleable', damaged: 'Damaged', expired: 'Expired' }
const SERIAL_STATUSES = Object.keys(STATUS_LABELS) as InventorySerialStatus[]

function SerialStatusBadge({ status }: { status: InventorySerialStatus }) {
  const tone = status === 'available'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'sold'
      ? 'border-blue-200 bg-blue-50 text-blue-800'
      : status === 'returned_to_supplier'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-slate-50 text-slate-700'
  return <Badge variant="outline" className={cn('whitespace-nowrap', tone)}>{STATUS_LABELS[status]}</Badge>
}

function movementParty(row: InventorySerialRegisterRow, kind: 'received' | 'latest') {
  return kind === 'received' ? row.received_party || '—' : row.latest_party || '—'
}

function movementLabel(row: InventorySerialRegisterRow) {
  if (!row.latest_voucher_no) return 'No active movement'
  const action = row.latest_voucher_type === 'Sales' ? 'Sold via'
    : row.latest_voucher_type === 'Sales Return' ? 'Returned via'
      : row.latest_voucher_type === 'Purchase Return' ? 'Supplier return via'
        : row.latest_voucher_type === 'Stock Adjustment' ? 'Adjusted via'
          : row.latest_voucher_type || 'Moved via'
  return `${action} ${row.latest_voucher_no}`
}

function ItemMetric({ value, label, tone = 'navy' }: { value: number; label: string; tone?: 'navy' | 'green' | 'blue' | 'amber' }) {
  const color = tone === 'green' ? 'text-emerald-700' : tone === 'blue' ? 'text-blue-700' : tone === 'amber' ? 'text-amber-700' : 'text-primary'
  return <span className="min-w-0 px-2.5 py-0.5 text-center sm:px-4">
    <span className={cn('block text-base font-semibold tabular-nums leading-none', color)}>{value.toLocaleString('en-NP')}</span>
    <span className="mt-1.5 block whitespace-nowrap text-[11px] font-medium leading-none text-muted-foreground">{label}</span>
  </span>
}

function SerialDetailTable({ rows, onHistory, onVoucher }: { rows: InventorySerialRegisterRow[]; onHistory: (row: InventorySerialRegisterRow) => void; onVoucher: (voucherId: string) => void }) {
  return <>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[850px] border-collapse text-sm">
        <thead><tr className="bg-muted/45">
          <th className="report-th text-left">Serial Number</th><th className="report-th text-left">Status</th><th className="report-th text-left">Condition</th><th className="report-th text-left">Received</th><th className="report-th text-left">Purchase Reference</th><th className="report-th text-left">Latest Movement</th><th className="report-th text-right">History</th>
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.serial_id} className="border-t transition-colors hover:bg-muted/20">
          <td className="report-td whitespace-nowrap font-mono font-semibold text-foreground">{row.serial_number}</td>
          <td className="report-td"><SerialStatusBadge status={row.status} /></td>
          <td className="report-td">{row.stock_condition ? CONDITION_LABELS[row.stock_condition] : '—'}</td>
          <td className="report-td whitespace-nowrap">{row.received_date_bs ? fmtDate(row.received_date_bs) : '—'}</td>
          <td className="report-td">{row.received_voucher_id ? <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => onVoucher(row.received_voucher_id!)}>{row.received_voucher_no || 'Open voucher'}</Button> : '—'}{row.received_party && <span className="mt-0.5 block max-w-52 truncate text-xs text-muted-foreground" title={row.received_party}>{row.received_party}</span>}</td>
          <td className="report-td">{row.latest_voucher_id ? <Button type="button" variant="link" className="h-auto p-0 text-left text-sm" onClick={() => onVoucher(row.latest_voucher_id!)}>{movementLabel(row)}</Button> : <span>{movementLabel(row)}</span>}<span className="mt-0.5 block max-w-52 truncate text-xs text-muted-foreground" title={movementParty(row, 'latest')}>{movementParty(row, 'latest')}</span></td>
          <td className="report-td text-right"><Button type="button" variant="outline" size="sm" onClick={() => onHistory(row)}><History className="mr-1.5 h-4 w-4" />View history</Button></td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className="divide-y md:hidden">{rows.map(row => <article key={row.serial_id} className="space-y-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3"><div><p className="font-mono font-semibold">{row.serial_number}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.stock_condition ? `${CONDITION_LABELS[row.stock_condition]} stock` : 'Outside inventory'}</p></div><SerialStatusBadge status={row.status} /></div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs"><div><dt className="text-muted-foreground">Received</dt><dd className="mt-0.5 font-medium">{row.received_date_bs ? fmtDate(row.received_date_bs) : '—'}</dd></div><div><dt className="text-muted-foreground">Purchase reference</dt><dd className="mt-0.5 font-medium">{row.received_voucher_id ? <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => onVoucher(row.received_voucher_id!)}>{row.received_voucher_no}</button> : '—'}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Latest movement</dt><dd className="mt-0.5 font-medium">{row.latest_voucher_id ? <button type="button" className="text-left text-primary underline-offset-4 hover:underline" onClick={() => onVoucher(row.latest_voucher_id!)}>{movementLabel(row)}</button> : movementLabel(row)}</dd></div></dl>
      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => onHistory(row)}><History className="mr-1.5 h-4 w-4" />View serial history</Button>
    </article>)}</div>
  </>
}

function PrintableSerialTable({ rows }: { rows: InventorySerialRegisterRow[] }) {
  return <table className="serial-register-table w-full border-collapse text-sm">
    <thead><tr className="bg-muted/50"><th className="report-th text-left">S.No.</th><th className="report-th text-left">Serial Number</th><th className="report-th text-left">Item</th><th className="report-th text-left">Status</th><th className="report-th text-left">Condition</th><th className="report-th text-left">Received</th><th className="report-th text-left">Supplier / Source</th><th className="report-th text-left">Latest Movement</th><th className="report-th text-left">Party / Particulars</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.serial_id} className="border-t"><td className="report-td num">{index + 1}</td><td className="report-td font-mono font-semibold">{row.serial_number}</td><td className="report-td"><span className="block font-medium">{row.item_name}</span>{row.sku && <span className="block text-xs">SKU {row.sku}</span>}</td><td className="report-td">{STATUS_LABELS[row.status]}</td><td className="report-td">{row.stock_condition ? CONDITION_LABELS[row.stock_condition] : '—'}</td><td className="report-td">{row.received_date_bs ? fmtDate(row.received_date_bs) : '—'}<span className="block text-xs">{row.received_voucher_no || '—'}</span></td><td className="report-td">{movementParty(row, 'received')}</td><td className="report-td">{row.latest_date_bs ? fmtDate(row.latest_date_bs) : '—'}<span className="block text-xs">{movementLabel(row)}</span></td><td className="report-td">{movementParty(row, 'latest')}</td></tr>)}</tbody>
  </table>
}

function SerialItemGroup({ group, expanded, rows, loading, error, onToggle, onHistory, onVoucher }: { group: InventorySerialItemGroup; expanded: boolean; rows?: InventorySerialRegisterRow[]; loading: boolean; error?: string; onToggle: () => void; onHistory: (row: InventorySerialRegisterRow) => void; onVoucher: (voucherId: string) => void }) {
  const otherOutward = group.returned_to_supplier + group.adjusted_out
  const panelId = `serial-item-${group.item_id}`
  return <section className={cn('overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow] duration-200', expanded && 'shadow-sm')}>
    <button type="button" className={cn('grid w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-center', expanded && 'bg-muted/15')} aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground">
          <ChevronDown className={cn('h-[18px] w-[18px] transition-transform duration-200 ease-out', !expanded && '-rotate-90')} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold leading-5 text-foreground sm:text-base">{group.item_name}</span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">
            <span className="truncate">{group.primary_supplier ? `Supplier / source: ${group.primary_supplier}` : 'Supplier / source: —'}</span>
            {group.sku && <><span className="hidden text-border sm:inline" aria-hidden="true">•</span><span className="whitespace-nowrap font-mono text-[11px]">SKU {group.sku}</span></>}
          </span>
        </span>
      </span>
      <span className="grid grid-cols-4 divide-x divide-border/80 rounded-lg bg-muted/30 py-2.5 sm:min-w-[390px]">
        <ItemMetric value={group.total} label="Total serials" />
        <ItemMetric value={group.available} label="Available" tone="green" />
        <ItemMetric value={group.sold} label="Sold" tone="blue" />
        <ItemMetric value={otherOutward} label="Other outward" tone="amber" />
      </span>
    </button>
    {expanded && <div id={panelId} className="border-t" role="region" aria-label={`${group.item_name} serial numbers`}>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 border-b bg-muted/10 px-4 py-2 text-[11px] font-medium text-muted-foreground"><span className="flex flex-wrap items-center gap-x-3 gap-y-1"><span><strong className="font-semibold text-foreground">{group.available}</strong> available</span><span><strong className="font-semibold text-foreground">{group.saleable}</strong> saleable</span><span><strong className="font-semibold text-foreground">{group.damaged}</strong> damaged</span><span><strong className="font-semibold text-foreground">{group.expired}</strong> expired</span></span><span>{group.total} serial record{group.total === 1 ? '' : 's'}</span></div>
      {loading ? <div className="space-y-px bg-border" aria-live="polite">{Array.from({ length: Math.min(5, group.total || 3) }, (_, index) => <div key={index} className="h-14 animate-pulse bg-card px-4 py-4"><div className="h-3 w-2/3 rounded bg-muted" /></div>)}</div>
        : error ? <div className="px-4 py-8 text-center"><p className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={onToggle}>Close and retry</Button></div>
          : rows?.length ? <SerialDetailTable rows={rows} onHistory={onHistory} onVoucher={onVoucher} />
            : <div className="px-4 py-8 text-center text-sm text-muted-foreground">No matching serial details were found.</div>}
    </div>}
  </section>
}

export function SerialNumberRegisterPage() {
  const { company, items, vouchers } = useAppStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [itemId, setItemId] = useState(searchParams.get('item') || 'all')
  const [status, setStatus] = useState<InventorySerialStatus | 'all'>(() => {
    const requested = searchParams.get('status') as InventorySerialStatus | null
    return requested && SERIAL_STATUSES.includes(requested) ? requested : 'all'
  })
  const [condition, setCondition] = useState<StockCondition | 'all'>('all')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [result, setResult] = useState<InventorySerialItemGroupResult>(EMPTY_RESULT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => new Set())
  const [itemRows, setItemRows] = useState<Record<string, InventorySerialRegisterRow[]>>({})
  const [itemLoadingIds, setItemLoadingIds] = useState<Set<string>>(() => new Set())
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({})
  const [historyRow, setHistoryRow] = useState<InventorySerialRegisterRow | null>(null)
  const [history, setHistory] = useState<InventorySerialMovement[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [voucherPreview, setVoucherPreview] = useState<Voucher | null>(null)
  const [voucherLoadingId, setVoucherLoadingId] = useState<string | null>(null)
  const [voucherError, setVoucherError] = useState('')
  const [outputBusy, setOutputBusy] = useState<'csv' | 'print' | null>(null)
  const [printRows, setPrintRows] = useState<InventorySerialRegisterRow[]>([])
  const requestId = useRef(0)
  const detailRequestId = useRef(0)

  const serializedItems = useMemo(() => items.filter(item => item.is_serialized).sort((a, b) => a.name.localeCompare(b.name)), [items])
  const filters = useMemo<InventorySerialRegisterFilters>(() => ({ query: debouncedQuery, itemId: itemId === 'all' ? null : itemId, status, stockCondition: condition }), [debouncedQuery, itemId, status, condition])
  const pageCount = Math.max(1, Math.ceil(result.total_items / ITEM_PAGE_SIZE))

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250); return () => window.clearTimeout(timer) }, [query])
  useEffect(() => { setPage(1); setExpandedItemIds(new Set()); setItemRows({}); setItemErrors({}); setItemLoadingIds(new Set()); detailRequestId.current += 1 }, [debouncedQuery, itemId, status, condition])
  useEffect(() => { setExpandedItemIds(new Set()); setItemLoadingIds(new Set()); detailRequestId.current += 1 }, [page])
  useEffect(() => { if (status !== 'all' && status !== 'available' && condition !== 'all') setCondition('all') }, [condition, status])
  useEffect(() => { if (items.length && itemId !== 'all' && !serializedItems.some(item => item.id === itemId)) setItemId('all') }, [itemId, items.length, serializedItems])
  useEffect(() => { if (!loading && page > pageCount) setPage(pageCount) }, [loading, page, pageCount])
  useEffect(() => {
    const next = new URLSearchParams()
    if (itemId !== 'all') next.set('item', itemId)
    if (status !== 'all') next.set('status', status)
    setSearchParams(next, { replace: true })
  }, [itemId, status, setSearchParams])

  useEffect(() => {
    if (!company?.id) { setResult(EMPTY_RESULT); return }
    const currentRequest = ++requestId.current
    setLoading(true); setError('')
    void fetchInventorySerialItemGroups(company.id, filters, page, ITEM_PAGE_SIZE)
      .then(data => { if (currentRequest === requestId.current) setResult(data) })
      .catch(cause => { if (currentRequest === requestId.current) setError(publicErrorMessage(cause, 'loading the serial number register')) })
      .finally(() => { if (currentRequest === requestId.current) setLoading(false) })
  }, [company?.id, filters, page, refreshKey])

  useEffect(() => {
    if (!company?.id || !historyRow) { setHistory([]); return }
    let active = true
    setHistoryLoading(true); setHistoryError('')
    void fetchInventorySerialHistory(company.id, historyRow.serial_id)
      .then(rows => { if (active) setHistory(rows) })
      .catch(cause => { if (active) setHistoryError(publicErrorMessage(cause, 'loading serial number history')) })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [company?.id, historyRow])

  const fetchAllMatching = async (overrideFilters: InventorySerialRegisterFilters = filters) => {
    if (!company?.id) return []
    return collectInventorySerialRegisterRows((nextPage, pageSize) => fetchInventorySerialRegister(company.id, overrideFilters, nextPage, pageSize), EXPORT_PAGE_SIZE)
  }

  const loadItemRows = async (group: InventorySerialItemGroup, generation = detailRequestId.current) => {
    if (itemRows[group.item_id] || !company?.id) return
    setItemLoadingIds(current => new Set(current).add(group.item_id))
    setItemErrors(current => ({ ...current, [group.item_id]: '' }))
    try {
      const rows = await fetchAllMatching({ ...filters, itemId: group.item_id })
      if (generation === detailRequestId.current) setItemRows(current => ({ ...current, [group.item_id]: rows }))
    } catch (cause) {
      if (generation === detailRequestId.current) setItemErrors(current => ({ ...current, [group.item_id]: publicErrorMessage(cause, `loading serial numbers for ${group.item_name}`) }))
    } finally {
      if (generation === detailRequestId.current) setItemLoadingIds(current => { const next = new Set(current); next.delete(group.item_id); return next })
    }
  }

  const toggleItem = (group: InventorySerialItemGroup) => {
    const willExpand = !expandedItemIds.has(group.item_id)
    setExpandedItemIds(current => {
      const next = new Set(current)
      if (willExpand) next.add(group.item_id)
      else next.delete(group.item_id)
      return next
    })
    if (willExpand) void loadItemRows(group)
  }

  const visibleItemsExpanded = result.groups.length > 0 && result.groups.every(group => expandedItemIds.has(group.item_id))
  const toggleAllItems = async () => {
    if (visibleItemsExpanded) {
      setExpandedItemIds(new Set())
      return
    }
    const groups = result.groups
    setExpandedItemIds(new Set(groups.map(group => group.item_id)))
    const generation = detailRequestId.current
    const unloaded = groups.filter(group => !itemRows[group.item_id])
    for (let index = 0; index < unloaded.length; index += 3) {
      await Promise.all(unloaded.slice(index, index + 3).map(group => loadItemRows(group, generation)))
      if (generation !== detailRequestId.current) break
    }
  }

  const openVoucher = async (voucherId: string) => {
    if (!company?.id || voucherLoadingId) return
    setVoucherError('')
    const loaded = vouchers.find(voucher => voucher.id === voucherId)
    if (loaded) { setVoucherPreview(loaded); return }
    setVoucherLoadingId(voucherId)
    try {
      const voucher = await fetchVoucherBundle(company.id, voucherId)
      if (!voucher) throw new Error('Voucher not found')
      setVoucherPreview(voucher)
    } catch (cause) {
      setVoucherError(publicErrorMessage(cause, 'opening the linked voucher'))
    } finally {
      setVoucherLoadingId(null)
    }
  }

  const exportCsv = async () => {
    setOutputBusy('csv'); setError('')
    try {
      const rows = await fetchAllMatching()
      downloadCsv('serial-number-register.csv', ['S.No.', 'Serial Number', 'Item', 'SKU', 'Status', 'Condition', 'Received Date (BS)', 'Received Voucher Type', 'Received Voucher', 'Supplier / Source', 'Latest Date (BS)', 'Latest Voucher Type', 'Latest Voucher', 'Party / Particulars'], rows.map((row, index) => [index + 1, row.serial_number, row.item_name, row.sku || '', STATUS_LABELS[row.status], row.stock_condition ? CONDITION_LABELS[row.stock_condition] : '', row.received_date_bs || '', row.received_voucher_type || '', row.received_voucher_no || '', row.received_party || '', row.latest_date_bs || '', row.latest_voucher_type || '', row.latest_voucher_no || '', row.latest_party || '']))
    } catch (cause) { setError(publicErrorMessage(cause, 'exporting the complete serial register')) } finally { setOutputBusy(null) }
  }

  const printReport = async () => {
    setOutputBusy('print'); setError('')
    try {
      setPrintRows(await fetchAllMatching())
      window.setTimeout(() => window.print(), 50)
    } catch (cause) { setError(publicErrorMessage(cause, 'preparing the complete serial register for printing')) } finally { setOutputBusy(null) }
  }

  const refreshReport = () => {
    setPage(1)
    setExpandedItemIds(new Set())
    setItemRows({})
    setItemLoadingIds(new Set())
    setItemErrors({})
    detailRequestId.current += 1
    setRefreshKey(value => value + 1)
  }

  useEffect(() => {
    const clear = () => setPrintRows([])
    window.addEventListener('afterprint', clear)
    return () => window.removeEventListener('afterprint', clear)
  }, [])

  const filterLabel = [itemId === 'all' ? 'All serialized items' : serializedItems.find(item => item.id === itemId)?.name, status === 'all' ? 'All statuses' : STATUS_LABELS[status], condition === 'all' ? null : CONDITION_LABELS[condition]].filter(Boolean).join(' · ')

  return <div className="report-page serial-register-report-page">
    <PageHeader title="Serial Number Register" description="Review serialized stock item by item, then expand an item for its complete movement details" action={<div className="report-actions flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!!outputBusy} onClick={() => void exportCsv()}><Download className="mr-2 h-4 w-4" />{outputBusy === 'csv' ? 'Preparing…' : 'Export CSV'}</Button><Button variant="outline" disabled={!!outputBusy} onClick={() => void printReport()}><Printer className="mr-2 h-4 w-4" />{outputBusy === 'print' ? 'Preparing…' : 'Print'}</Button></div>} />
    <PageContent className="report-content space-y-4">
      <FormalReportPrintHeader company={company} title="Serial Number Register" periodLabel="All recorded serial movements" detailLabel={filterLabel} />
      <Card className="report-controls"><CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(220px,1.4fr)_minmax(190px,1fr)_minmax(170px,.8fr)_minmax(170px,.8fr)_auto] lg:items-end">
        <div className="space-y-1.5"><Label htmlFor="serial-register-search">Search</Label><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="serial-register-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Serial, item, SKU, party, or voucher…" className="pl-8" /></div></div>
        <div className="space-y-1.5"><Label>Item</Label><SearchableSelect mode="typeahead" value={itemId} onValueChange={setItemId} placeholder="All serialized items" ariaLabel="Serialized item" options={[{ value: 'all', label: 'All serialized items' }, ...serializedItems.map(itemSelectorOption)]} /></div>
        <div className="space-y-1.5"><Label>Status</Label><SearchableSelect value={status} onValueChange={value => setStatus(value as InventorySerialStatus | 'all')} placeholder="All statuses" ariaLabel="Serial status" options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))]} /></div>
        <div className="space-y-1.5"><Label>Condition</Label><SearchableSelect value={condition} onValueChange={value => setCondition(value as StockCondition | 'all')} placeholder="All conditions" ariaLabel="Stock condition" disabled={status !== 'all' && status !== 'available'} options={[{ value: 'all', label: 'All conditions' }, ...Object.entries(CONDITION_LABELS).map(([value, label]) => ({ value, label }))]} /></div>
        <Button variant="outline" onClick={refreshReport} disabled={loading}><RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />Refresh</Button>
      </CardContent></Card>

      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="report-summary flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/15 px-4 py-3">
        <div><p className="font-semibold text-primary">{result.total_items.toLocaleString('en-NP')} serialized item{result.total_items === 1 ? '' : 's'}</p><p className="mt-0.5 text-xs text-muted-foreground">{result.summary.total.toLocaleString('en-NP')} tracked serials matching the current filters</p></div>
        <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-xs"><span><strong className="text-emerald-700">{result.summary.available}</strong> available</span><span><strong className="text-blue-700">{result.summary.sold}</strong> sold</span><span><strong className="text-amber-700">{result.summary.returned_to_supplier + result.summary.adjusted_out}</strong> other outward</span>{result.groups.length > 0 && <ExpandCollapseControls expanded={visibleItemsExpanded} onToggle={() => void toggleAllItems()} />}</div>
      </div>

      <div className="space-y-3">
        {loading ? Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border bg-muted/30" aria-hidden="true" />)
          : result.groups.length ? result.groups.map(group => <SerialItemGroup key={group.item_id} group={group} expanded={expandedItemIds.has(group.item_id)} rows={itemRows[group.item_id]} loading={itemLoadingIds.has(group.item_id)} error={itemErrors[group.item_id]} onToggle={() => toggleItem(group)} onHistory={setHistoryRow} onVoucher={voucherId => void openVoucher(voucherId)} />)
            : <div className="rounded-lg border bg-card py-16 text-center"><Barcode className="mx-auto mb-3 h-9 w-9 text-muted-foreground/35" /><p className="font-medium">{serializedItems.length ? 'No matching serialized items' : 'No serialized items yet'}</p><p className="mt-1 text-sm text-muted-foreground">{serializedItems.length ? 'Try changing the search or filters.' : 'Enable serial tracking on an item and receive it through a Purchase bill.'}</p></div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm print:hidden"><p className="text-muted-foreground">{result.total_items ? `${(page - 1) * ITEM_PAGE_SIZE + 1}–${Math.min(page * ITEM_PAGE_SIZE, result.total_items)} of ${result.total_items} items` : '0 items'}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><span className="min-w-20 text-center tabular-nums">Page {page} of {pageCount}</span><Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>

      <div className="serial-register-print-table hidden"><div className="serial-register-print-summary"><span><strong>Tracked:</strong> {result.summary.total}</span><span><strong>Available:</strong> {result.summary.available}</span><span><strong>Sold:</strong> {result.summary.sold}</span><span><strong>Returned / Adjusted:</strong> {result.summary.returned_to_supplier + result.summary.adjusted_out}</span></div><PrintableSerialTable rows={printRows} /></div>
      <FormalReportPrintFooter />
    </PageContent>

    <Dialog open={!!historyRow} onOpenChange={open => { if (!open) setHistoryRow(null) }}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Serial History · <span className="font-mono">{historyRow?.serial_number}</span></DialogTitle></DialogHeader>
        {historyRow && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted/25 px-3 py-2 text-sm"><span className="font-medium">{historyRow.item_name}</span><SerialStatusBadge status={historyRow.status} />{historyRow.stock_condition && <span className="text-muted-foreground">{CONDITION_LABELS[historyRow.stock_condition]} stock</span>}</div>}
        {historyError && <p role="alert" className="text-sm text-destructive">{historyError}</p>}
        {voucherError && <p role="alert" className="text-sm text-destructive">{voucherError}</p>}
        {historyLoading ? <div className="space-y-2">{[0, 1, 2].map(index => <div key={index} className="h-16 animate-pulse rounded-md bg-muted" />)}</div>
          : history.length ? <ol className="relative ml-2 border-l border-border pl-5">{history.map(movement => <li key={movement.movement_id} className="relative pb-5 last:pb-0"><span className={cn('absolute -left-[1.55rem] top-1 h-3 w-3 rounded-full border-2 border-background', movement.cancelled ? 'bg-slate-400' : movement.direction === 'in' ? 'bg-emerald-500' : 'bg-blue-500')} /><div className={movement.cancelled ? 'opacity-60' : ''}><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="link" className="h-auto gap-1 p-0 font-medium" disabled={voucherLoadingId === movement.voucher_id} onClick={() => void openVoucher(movement.voucher_id)}>{voucherLoadingId === movement.voucher_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}{movement.voucher_type} · {movement.voucher_no}</Button><Badge variant="outline">{movement.direction === 'in' ? 'Inward' : 'Outward'}</Badge>{movement.cancelled && <Badge variant="cancelled">Cancelled</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{fmtDate(movement.date_bs)} · {CONDITION_LABELS[movement.stock_condition]}{movement.party_name ? ` · ${movement.party_name}` : ''}</p>{movement.narration && <p className="mt-1 text-sm">{movement.narration}</p>}</div></li>)}</ol>
            : <div className="py-10 text-center text-sm text-muted-foreground"><PackageX className="mx-auto mb-2 h-8 w-8 opacity-35" />No movement history was found.</div>}
        {!historyLoading && history.length > 0 && <p className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground"><PackageCheck className="h-4 w-4" />Only completed, non-cancelled movements determine current availability.</p>}
      </DialogContent>
    </Dialog>

    <Dialog open={!!voucherPreview} onOpenChange={open => { if (!open) setVoucherPreview(null) }}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{voucherPreview ? `${voucherPreview.type} · ${voucherPreview.invoice_no || voucherPreview.seq}` : 'Voucher details'}</DialogTitle></DialogHeader>
        {voucherPreview && <VoucherDetail voucher={voucherPreview} />}
        {voucherPreview && <DialogFooter><Button type="button" variant="outline" onClick={() => printPersistedVoucher(voucherPreview)}><Printer className="mr-2 h-4 w-4" />Print Voucher</Button></DialogFooter>}
      </DialogContent>
    </Dialog>
  </div>
}
