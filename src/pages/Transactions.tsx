import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { ReceiptPaymentForm, JournalForm } from '@/components/forms/OtherForms'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { VoucherType } from '@/types'

function useVouchersByType(type: VoucherType) {
  const allVouchers = useAppStore(s => s.vouchers)
  return useMemo(
    () => allVouchers
      .filter(v => v.type === type)
      .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq),
    [allVouchers, type]
  )
}

// ─── Sales ────────────────────────────────────────────────────────────────────
export function SalesPage() {
  const vouchers = useVouchersByType('Sales')
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
  const vouchers = useVouchersByType('Purchase')
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
  const vouchers = useVouchersByType('Receipt')
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
  const vouchers = useVouchersByType('Payment')
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
  const vouchers = useVouchersByType('Journal')
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
