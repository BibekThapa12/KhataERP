import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { ReceiptPaymentForm, JournalForm } from '@/components/forms/OtherForms'
import { ReturnForm } from '@/components/forms/ReturnForm'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { selectedFiscalYearStartBs, vouchersInFiscalYear } from '@/lib/reports'
import type { Voucher, VoucherType } from '@/types'

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
        <Card><VoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} /></Card>
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
        <Card><VoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} /></Card>
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
      <PageContent><Card><VoucherTable vouchers={vouchers} onEdit={voucher => { setEditing(voucher); setOpen(true) }} /></Card></PageContent>
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
        <Card><VoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} /></Card>
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
        <Card><VoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} /></Card>
      </PageContent>
      <ReceiptPaymentForm type="Payment" open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
    </div>
  )
}

// ─── Journal ──────────────────────────────────────────────────────────────────
export function JournalPage() {
  const vouchers = useVouchersByType('Journal')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  useCreateEntryRequest(setOpen)
  return (
    <div>
      <PageHeader title="Journal Entries" description="Manual adjustments — depreciation, write-offs, opening balances"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Journal</Button>} />
      <PageContent>
        <Card><VoucherTable vouchers={vouchers} onEdit={v => { setEditing(v); setOpen(true) }} /></Card>
      </PageContent>
      <JournalForm open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
    </div>
  )
}
