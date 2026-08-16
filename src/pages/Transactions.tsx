import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Plus, Printer, Trash2, XCircle } from 'lucide-react'
import { useAppStore, type BulkDraftCompletionResult } from '@/store/useAppStore'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { ReceiptPaymentForm, JournalForm } from '@/components/forms/OtherForms'
import { SimpleEntryForm } from '@/components/forms/SimpleEntryForm'
import { ContraForm } from '@/components/forms/ContraForm'
import { ReturnForm } from '@/components/forms/ReturnForm'
import { StockAdjustmentForm } from '@/pages/Items'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { selectedFiscalYearStartBs, vouchersInFiscalYear } from '@/lib/reports'
import type { Voucher, VoucherType } from '@/types'
import { voucherSimpleEntryType } from '@/lib/simpleEntries'
import { voucherIsContra } from '@/lib/contra'
import { companyCanWrite } from '@/lib/billing'
import { isDeveloperAdmin } from '@/lib/supabase'
import { savedVoucherNumber } from '@/lib/voucherNumbers'
import { userFacingErrorMessage } from '@/lib/security'
import { printPersistedVoucher } from '@/lib/voucherPrinterRegistry'
import { notifyError, withoutSuccessNotifications } from '@/lib/notifications'

function useVouchersByType(type: VoucherType) {
  const allVouchers = useAppStore(s => s.vouchers)
  const company = useAppStore(s => s.company)
  const fiscalStart = selectedFiscalYearStartBs(company)
  return useMemo(
    () => vouchersInFiscalYear(allVouchers, fiscalStart)
      .filter(v => v.type === type)
      .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq),
    [allVouchers, fiscalStart, type]
  )
}

function useCreateEntryRequest(setOpen: Dispatch<SetStateAction<boolean>>) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('new') === '1'
  useEffect(() => {
    if (!requested) return
    setOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [requested, searchParams, setOpen, setSearchParams])
}

export function BulkDraftVoucherTable({ vouchers, onEdit, draftOnly = false }: { vouchers: Voucher[]; onEdit: (voucher: Voucher) => void; draftOnly?: boolean }) {
  const company = useAppStore(state => state.company)
  const completeDraftVoucher = useAppStore(state => state.completeDraftVoucher)
  const deleteDraftVoucher = useAppStore(state => state.deleteDraftVoucher)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState<BulkDraftCompletionResult[]>([])
  const [lastOperation, setLastOperation] = useState<'completion' | 'deletion'>('completion')
  const [draftFilterActive, setDraftFilterActive] = useState(draftOnly)
  const [developerAdmin, setDeveloperAdmin] = useState(false)
  const drafts = useMemo(() => vouchers.filter(voucher => voucher.status === 'Draft'), [vouchers])
  const canComplete = developerAdmin || companyCanWrite(company)
  useEffect(() => { let active = true; void isDeveloperAdmin().then(value => { if (active) setDeveloperAdmin(value) }); return () => { active = false } }, [])
  useEffect(() => {
    const available = new Set(drafts.map(voucher => voucher.id))
    setSelectedIds(current => new Set([...current].filter(id => available.has(id))))
  }, [drafts])
  const completeSelected = async () => {
    if (processing || !canComplete || !selectedIds.size) return
    const selected = drafts.filter(voucher => selectedIds.has(voucher.id)).sort((a, b) => a.date_bs_key - b.date_bs_key || a.seq - b.seq)
    setProcessing(true); setResults([]); setLastOperation('completion')
    const nextResults: BulkDraftCompletionResult[] = []
    const failedIds = new Set<string>()
    for (const draft of selected) {
      try {
        const completed = await withoutSuccessNotifications(() => completeDraftVoucher(draft))
        nextResults.push({ draftId: draft.id, label: savedVoucherNumber(draft), type: draft.type, status: 'completed', completedNumber: savedVoucherNumber(completed) })
      } catch (error) {
        const fallback = error instanceof Error && error.message ? error.message : 'This draft could not be completed. Open it to review the saved details.'
        nextResults.push({ draftId: draft.id, label: savedVoucherNumber(draft), type: draft.type, status: 'failed', error: userFacingErrorMessage(error) || fallback })
        failedIds.add(draft.id)
      }
      setResults([...nextResults])
    }
    setSelectedIds(failedIds); setProcessing(false)
  }
  const printSelected = () => {
    if (processing || !selectedIds.size) return
    const selected = drafts.filter(voucher => selectedIds.has(voucher.id)).sort((a, b) => a.date_bs_key - b.date_bs_key || a.seq - b.seq)
    const targets = selected.map(() => window.open('', '_blank', 'width=800,height=900'))
    const blocked = targets.filter(target => !target).length
    selected.forEach((voucher, index) => { const target = targets[index]; if (target) printPersistedVoucher(voucher, target) })
    if (blocked) notifyError(`${blocked} print window${blocked === 1 ? ' was' : 's were'} blocked`, 'Allow popups for KhataERP and try Print Selected again.')
  }
  const deleteSelected = async () => {
    if (processing || !canComplete || !selectedIds.size) return
    const selected = drafts.filter(voucher => selectedIds.has(voucher.id)).sort((a, b) => a.date_bs_key - b.date_bs_key || a.seq - b.seq)
    setProcessing(true); setResults([]); setLastOperation('deletion')
    const nextResults: BulkDraftCompletionResult[] = []
    const failedIds = new Set<string>()
    for (const draft of selected) {
      try {
        await withoutSuccessNotifications(() => deleteDraftVoucher(draft.id))
        nextResults.push({ draftId: draft.id, label: savedVoucherNumber(draft), type: draft.type, status: 'completed' })
      } catch (error) {
        const fallback = error instanceof Error && error.message ? error.message : 'This draft could not be deleted.'
        nextResults.push({ draftId: draft.id, label: savedVoucherNumber(draft), type: draft.type, status: 'failed', error: userFacingErrorMessage(error) || fallback })
        failedIds.add(draft.id)
      }
      setResults([...nextResults])
    }
    setSelectedIds(failedIds); setProcessing(false)
  }
  const completedCount = results.filter(result => result.status === 'completed').length
  const failedCount = results.filter(result => result.status === 'failed').length
  useEffect(() => {
    if (processing || !results.length || failedCount > 0) return
    const timeout = window.setTimeout(() => setResults([]), 2000)
    return () => window.clearTimeout(timeout)
  }, [processing, results.length, failedCount])
  return <div className="space-y-3">
    {draftFilterActive && drafts.length > 0 && <Card className="border-amber-200 bg-amber-50/45 shadow-none"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-3"><div><p className="text-sm font-semibold text-amber-950">{selectedIds.size} draft{selectedIds.size === 1 ? '' : 's'} selected</p><p className="text-xs text-amber-800">Select draft rows below. Completion and deletion run oldest first.</p></div><div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={processing || !selectedIds.size} onClick={() => setSelectedIds(new Set())}>Clear Selection</Button><Button variant="outline" disabled={processing || !selectedIds.size} onClick={printSelected}><Printer className="mr-1.5 h-4 w-4" />Print Selected</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={processing || !selectedIds.size || !canComplete}><Trash2 className="mr-1.5 h-4 w-4" />Delete Selected</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {selectedIds.size} selected draft{selectedIds.size === 1 ? '' : 's'}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the selected drafts. Drafts have not affected ledgers, stock, or reports, but this action cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep Drafts</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { void deleteSelected() }}>Delete Drafts</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><AlertDialog><AlertDialogTrigger asChild><Button disabled={processing || !selectedIds.size || !canComplete}>{processing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Complete Selected</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Complete {selectedIds.size} selected draft{selectedIds.size === 1 ? '' : 's'}?</AlertDialogTitle><AlertDialogDescription>Completed vouchers will be posted to ledgers, inventory, settlements, reports, and dashboard totals. Valid drafts will complete even if another selected draft fails.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep as Draft</AlertDialogCancel><AlertDialogAction onClick={() => { void completeSelected() }}>Complete Vouchers</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></CardContent></Card>}
    {draftFilterActive && !canComplete && drafts.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This company is read-only. Renew its billing access before completing drafts.</div>}
    {draftFilterActive && results.length > 0 && <Card className={failedCount ? 'border-amber-200' : 'border-emerald-200'}><CardContent className="p-3"><p className="text-sm font-semibold">Bulk {lastOperation} finished: {completedCount} {lastOperation === 'completion' ? 'completed' : 'deleted'}, {failedCount} failed</p><div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{results.map(result => <div key={result.draftId} className="flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40">{result.status === 'completed' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}<div className="min-w-0"><span className="font-medium">{result.type} {result.label}</span>{result.status === 'completed' ? <span className="text-muted-foreground">{lastOperation === 'completion' ? ` completed as ${result.completedNumber}` : ' deleted'}</span> : <p className="text-xs text-red-700">{result.error}</p>}</div></div>)}</div></CardContent></Card>}
    <Card><VoucherTable vouchers={vouchers} alwaysShowFilters onEdit={onEdit} selectedIds={draftFilterActive ? selectedIds : undefined} onSelectionChange={draftFilterActive ? setSelectedIds : undefined} selectionDisabled={processing || !canComplete} onStatusFilterChange={status => setDraftFilterActive(draftOnly || status === 'Draft')} /></Card>
  </div>
}

// ─── Sales ────────────────────────────────────────────────────────────────────
export function SalesPage() {
  const vatEnabled = useAppStore(s => s.company?.vat_enabled ?? true)
  const vouchers = useVouchersByType('Sales')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  useCreateEntryRequest(setOpen)
  return (
    <div>
      <PageHeader title="Sales Invoices" description={vatEnabled ? 'VAT-ready sales to Sundry Debtors (Customers)' : 'Internal sales records for bookkeeping'}
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Sale</Button>} />
      <PageContent>
        <BulkDraftVoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} />
      </PageContent>
      <InvoiceForm type="Sales" open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
    </div>
  )
}

// ─── Purchase ─────────────────────────────────────────────────────────────────
export function PurchasePage() {
  const vouchers = useVouchersByType('Purchase')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  useCreateEntryRequest(setOpen)
  return (
    <div>
      <PageHeader title="Purchase Bills" description="Goods bought from Sundry Creditors (Suppliers)"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Purchase</Button>} />
      <PageContent>
        <BulkDraftVoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} />
      </PageContent>
      <InvoiceForm type="Purchase" open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
    </div>
  )
}

function ReturnPage({ type }: { type: 'Sales Return' | 'Purchase Return' }) {
  const vatEnabled = useAppStore(s => s.company?.vat_enabled ?? true)
  const vouchers = useVouchersByType(type)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  const isSales = type === 'Sales Return'
  const title = vatEnabled ? (isSales ? 'Sales Returns / Credit Notes' : 'Purchase Returns / Debit Notes') : `${type}s`
  return (
    <div>
      <PageHeader title={title} description={isSales ? 'Goods returned by Sundry Debtors (Customers)' : 'Goods returned to Sundry Creditors (Suppliers)'}
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New {isSales ? 'Sales' : 'Purchase'} Return</Button>} />
      <PageContent><BulkDraftVoucherTable vouchers={vouchers} onEdit={voucher => { setEditing(voucher); setOpen(true) }} /></PageContent>
      <ReturnForm type={type} open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
    </div>
  )
}

export function SalesReturnPage() { return <ReturnPage type="Sales Return" /> }
export function PurchaseReturnPage() { return <ReturnPage type="Purchase Return" /> }

// ─── Receipts ─────────────────────────────────────────────────────────────────
export function ReceiptsPage() {
  const vouchers = useVouchersByType('Receipt')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  useCreateEntryRequest(setOpen)
  return (
    <div>
      <PageHeader title="Receipts" description="Money received from Sundry Debtors (Customers)"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Receipt</Button>} />
      <PageContent>
        <BulkDraftVoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} />
      </PageContent>
      <ReceiptPaymentForm type="Receipt" open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
    </div>
  )
}

// ─── Payments ─────────────────────────────────────────────────────────────────
export function PaymentsPage() {
  const vouchers = useVouchersByType('Payment')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  useCreateEntryRequest(setOpen)
  return (
    <div>
      <PageHeader title="Payments" description="Money paid to Sundry Creditors (Suppliers)"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Payment</Button>} />
      <PageContent>
        <BulkDraftVoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} />
      </PageContent>
      <ReceiptPaymentForm type="Payment" open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
    </div>
  )
}

// ─── Journal ──────────────────────────────────────────────────────────────────
export function JournalPage() {
  const vouchers = useVouchersByType('Journal')
  const accounts = useAppStore(state => state.rawAccounts)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  const editingSimpleType = editing ? voucherSimpleEntryType(editing, accounts) : null
  const editingContra = editing ? voucherIsContra(editing) : false
  useCreateEntryRequest(setOpen)
  return (
    <div>
      <PageHeader title="Journal Entries" description="Manual adjustments — depreciation, write-offs, opening balances"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Journal</Button>} />
      <PageContent>
        <BulkDraftVoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} />
      </PageContent>
      {open && editingContra ? <ContraForm open voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} /> : open && editingSimpleType ? <SimpleEntryForm entryType={editingSimpleType} open voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} /> : <JournalForm open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />}
    </div>
  )
}

export function DraftVouchersPage() {
  const allVouchers = useAppStore(s => s.vouchers)
  const company = useAppStore(s => s.company)
  const fiscalStart = selectedFiscalYearStartBs(company)
  const vouchers = useMemo(
    () => vouchersInFiscalYear(allVouchers, fiscalStart)
      .filter(voucher => voucher.status === 'Draft')
      .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq),
    [allVouchers, fiscalStart],
  )
  const [editing, setEditing] = useState<Voucher | null>(null)
  const accounts = useAppStore(state => state.rawAccounts)
  const editingSimpleType = editing ? voucherSimpleEntryType(editing, accounts) : null
  const editingContra = editing ? voucherIsContra(editing) : false
  return (
    <div>
      <PageHeader title="Draft Vouchers" description="Saved but not posted to ledgers, inventory, reports, or dashboard totals" />
      <PageContent><BulkDraftVoucherTable vouchers={vouchers} onEdit={setEditing} draftOnly /></PageContent>
      {editing && (editing.type === 'Sales' || editing.type === 'Purchase') && <InvoiceForm type={editing.type} open voucher={editing} onClose={() => setEditing(null)} />}
      {editing && (editing.type === 'Receipt' || editing.type === 'Payment') && <ReceiptPaymentForm type={editing.type} open voucher={editing} onClose={() => setEditing(null)} />}
      {editing?.type === 'Journal' && editingContra && <ContraForm open voucher={editing} onClose={() => setEditing(null)} />}
      {editing?.type === 'Journal' && !editingContra && editingSimpleType && <SimpleEntryForm entryType={editingSimpleType} open voucher={editing} onClose={() => setEditing(null)} />}
      {editing?.type === 'Journal' && !editingContra && !editingSimpleType && <JournalForm open voucher={editing} onClose={() => setEditing(null)} />}
      {editing && (editing.type === 'Sales Return' || editing.type === 'Purchase Return') && <ReturnForm type={editing.type} open voucher={editing} onClose={() => setEditing(null)} />}
      {editing?.type === 'Stock Adjustment' && <StockAdjustmentForm open voucher={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
