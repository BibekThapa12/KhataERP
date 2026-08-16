import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { voucherIsContra } from '@/lib/contra'
import { selectedFiscalYearStartBs, vouchersInFiscalYear } from '@/lib/reports'
import type { Voucher } from '@/types'
import { ContraForm } from '@/components/forms/ContraForm'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { BulkDraftVoucherTable } from '@/pages/Transactions'
import { Button } from '@/components/ui/button'

export function ContraPage() {
  const allVouchers = useAppStore(state => state.vouchers)
  const company = useAppStore(state => state.company)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  const vouchers = useMemo(() => vouchersInFiscalYear(allVouchers, selectedFiscalYearStartBs(company)).filter(voucher => voucher.type === 'Journal' && voucherIsContra(voucher)).sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq), [allVouchers, company])
  return <div>
    <PageHeader title="Contra Vouchers" description="Transfer money between Cash and Bank ledgers" action={<Button onClick={() => setOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Add Contra</Button>} />
    <PageContent><BulkDraftVoucherTable vouchers={vouchers} onEdit={voucher => { setEditing(voucher); setOpen(true) }} /></PageContent>
    <ContraForm open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
  </div>
}
