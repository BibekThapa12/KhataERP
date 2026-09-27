import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { selectedFiscalYearStartBs, vouchersInFiscalYear } from '@/lib/reports'
import type { SimpleEntryType, Voucher } from '@/types'
import { voucherSimpleEntryType } from '@/lib/simpleEntries'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { BulkDraftVoucherTable } from '@/pages/Transactions'
import { SimpleEntryForm } from '@/components/forms/SimpleEntryForm'
import { Button } from '@/components/ui/button'
import { useGlobalCreateShortcut } from '@/lib/globalCreateShortcut'
import { CreateShortcutHint } from '@/components/ui/shortcut-hint'

function SimpleEntriesPage({ entryType }: { entryType: SimpleEntryType }) {
  const allVouchers = useAppStore(state => state.vouchers)
  const accounts = useAppStore(state => state.rawAccounts)
  const company = useAppStore(state => state.company)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  useGlobalCreateShortcut({ active: true, onCreate: () => { setEditing(null); setOpen(true) } })
  const vouchers = useMemo(() => vouchersInFiscalYear(allVouchers, selectedFiscalYearStartBs(company)).filter(voucher => voucher.type === 'Journal' && voucherSimpleEntryType(voucher, accounts) === entryType).sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq), [allVouchers, accounts, company, entryType])
  return <div>
    <PageHeader title={`${entryType} Entries`} description={entryType === 'Income' ? 'Record money received without debit and credit terminology' : 'Record money spent without debit and credit terminology'} action={<Button onClick={() => setOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Add {entryType}<CreateShortcutHint /></Button>} />
    <PageContent><BulkDraftVoucherTable vouchers={vouchers} onEdit={voucher => { setEditing(voucher); setOpen(true) }} /></PageContent>
    <SimpleEntryForm entryType={entryType} open={open} voucher={editing} onClose={() => { setOpen(false); setEditing(null) }} />
  </div>
}

export function IncomeEntriesPage() { return <SimpleEntriesPage entryType="Income" /> }
export function ExpenseEntriesPage() { return <SimpleEntriesPage entryType="Expense" /> }
