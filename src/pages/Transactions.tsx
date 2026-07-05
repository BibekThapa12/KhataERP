import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { ReceiptPaymentForm, JournalForm } from '@/components/forms/OtherForms'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// ─── Sales ────────────────────────────────────────────────────────────────────
export function SalesPage() {
  const vouchers = useAppStore(s => s.vouchers.filter(v => v.type === 'Sales'))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.seq - a.seq)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <PageHeader title="Sales Invoices" description="VAT-ready sales to customers"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Sale</Button>} />
      <PageContent>
        <Card><VoucherTable vouchers={vouchers} /></Card>
      </PageContent>
      <InvoiceForm type="Sales" open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

// ─── Purchase ─────────────────────────────────────────────────────────────────
export function PurchasePage() {
  const vouchers = useAppStore(s => s.vouchers.filter(v => v.type === 'Purchase'))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.seq - a.seq)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <PageHeader title="Purchase Bills" description="Goods bought from suppliers"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Purchase</Button>} />
      <PageContent>
        <Card><VoucherTable vouchers={vouchers} /></Card>
      </PageContent>
      <InvoiceForm type="Purchase" open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

// ─── Receipts ─────────────────────────────────────────────────────────────────
export function ReceiptsPage() {
  const vouchers = useAppStore(s => s.vouchers.filter(v => v.type === 'Receipt'))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.seq - a.seq)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <PageHeader title="Receipts" description="Money received from customers"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Receipt</Button>} />
      <PageContent>
        <Card><VoucherTable vouchers={vouchers} /></Card>
      </PageContent>
      <ReceiptPaymentForm type="Receipt" open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

// ─── Payments ─────────────────────────────────────────────────────────────────
export function PaymentsPage() {
  const vouchers = useAppStore(s => s.vouchers.filter(v => v.type === 'Payment'))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.seq - a.seq)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <PageHeader title="Payments" description="Money paid to suppliers"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Payment</Button>} />
      <PageContent>
        <Card><VoucherTable vouchers={vouchers} /></Card>
      </PageContent>
      <ReceiptPaymentForm type="Payment" open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

// ─── Journal ──────────────────────────────────────────────────────────────────
export function JournalPage() {
  const vouchers = useAppStore(s => s.vouchers.filter(v => v.type === 'Journal'))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.seq - a.seq)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <PageHeader title="Journal Entries" description="Manual adjustments — depreciation, write-offs, opening balances"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Journal</Button>} />
      <PageContent>
        <Card><VoucherTable vouchers={vouchers} /></Card>
      </PageContent>
      <JournalForm open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
