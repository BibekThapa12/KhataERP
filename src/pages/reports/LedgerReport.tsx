import { useEffect, useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { categoryOptionLabel, categoryPath } from '@/lib/categoryHierarchy'
import { downloadCsv } from '@/lib/csv'
import { getGroupReport } from '@/lib/managementReports'
import { fiscalYearStartBs, formatLedgerBalance, getLedgerRows } from '@/lib/reports'
import { todayBs } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Voucher } from '@/types'

type Mode = 'ledger' | 'group'
type View = 'summary' | 'transactions'

export function LedgerReportPage() {
  const { company, rawAccounts, accountCategories, vouchers, parties } = useAppStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMode: Mode = searchParams.get('mode') === 'group' ? 'group' : 'ledger'
  const [mode, setMode] = useState<Mode>(initialMode)
  const [view, setView] = useState<View>(initialMode === 'group' ? 'summary' : 'transactions')
  const sortedAccounts = useMemo(() => [...rawAccounts].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)), [rawAccounts])
  const categories = useMemo(() => accountCategories.filter(category => !category.is_archived).sort((a, b) => a.account_type.localeCompare(b.account_type) || categoryPath(accountCategories, a.id).localeCompare(categoryPath(accountCategories, b.id))), [accountCategories])
  const [targetId, setTargetId] = useState(() => initialMode === 'group' ? searchParams.get('category') || '' : searchParams.get('account') || '')
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(() => fiscalYearStartBs(company))
  const [to, setTo] = useState(todayBs())
  const [showCancelled, setShowCancelled] = useState(false)
  const [selected, setSelected] = useState<Voucher | null>(null)

  useEffect(() => {
    const choices = mode === 'ledger' ? sortedAccounts : categories
    if (!choices.some(choice => choice.id === targetId)) setTargetId(choices[0]?.id || '')
  }, [mode, targetId, sortedAccounts, categories])
  useEffect(() => { if (range === 'fiscal') setFrom(fiscalYearStartBs(company)) }, [company, range])
  useEffect(() => {
    if (!targetId) return
    setSearchParams(mode === 'ledger' ? { account: targetId } : { mode: 'group', category: targetId }, { replace: true })
  }, [mode, targetId, setSearchParams])

  const ledger = useMemo(() => getLedgerRows(mode === 'ledger' ? targetId : '', rawAccounts, vouchers, from, to, showCancelled), [mode, targetId, rawAccounts, vouchers, from, to, showCancelled])
  const group = useMemo(() => getGroupReport(mode === 'group' ? targetId : '', accountCategories, rawAccounts, vouchers, from, to, showCancelled), [mode, targetId, accountCategories, rawAccounts, vouchers, from, to, showCancelled])
  const partyByAccount = useMemo(() => new Map(parties.map(party => [party.account_id, party])), [parties])
  const title = mode === 'ledger' ? ledger.account?.name || 'Ledger' : group.category?.name || 'Account Group'
  const opening = mode === 'ledger' ? ledger.opening_balance : group.opening
  const debit = mode === 'ledger' ? ledger.total_debit : group.total_debit
  const credit = mode === 'ledger' ? ledger.total_credit : group.total_credit
  const closing = mode === 'ledger' ? ledger.closing_balance : group.closing
  const balanceAccount = mode === 'ledger' ? ledger.account : group.summary[0]?.account || null

  const exportCsv = () => {
    if (mode === 'group' && view === 'summary') {
      downloadCsv(`group-${title}.csv`, ['Ledger','Opening','Debit','Credit','Closing'], group.summary.map(row => [row.account.name, row.opening, row.debit, row.credit, row.closing]))
      return
    }
    const rows = mode === 'ledger' ? ledger.rows.map(row => ({ ...row, account: ledger.account })) : group.transactions
    downloadCsv(`${mode}-${title}.csv`, ['Date','Ledger','Voucher Type','Voucher No.','Particulars','Narration','Debit','Credit','Running Balance'], rows.map(row => [row.date_bs, row.account?.name || '', row.voucher_type, row.voucher_no, row.particulars, row.narration, row.debit, row.credit, 'group_running_balance' in row ? row.group_running_balance : row.running_balance]))
  }

  const switchMode = (next: Mode) => { setMode(next); setTargetId(''); setView(next === 'group' ? 'summary' : 'transactions') }
  return <div className="report-page">
    <PageHeader title="Ledger / Account Group" description="Ledger movements and recursive category reports" action={<div className="flex gap-2"><Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />CSV</Button><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button></div>} />
    <PageContent className="report-content space-y-4">
      <div className="report-print-header hidden"><h1>{company?.name || 'KhataERP'}</h1><p>{title} | {fmtDate(from)} to {fmtDate(to)}</p></div>
      <Card className="report-controls"><CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2"><Button size="sm" variant={mode === 'ledger' ? 'default' : 'outline'} onClick={() => switchMode('ledger')}>Ledger</Button><Button size="sm" variant={mode === 'group' ? 'default' : 'outline'} onClick={() => switchMode('group')}>Group</Button>{mode === 'group' && <><span className="mx-1 border-l" /><Button size="sm" variant={view === 'summary' ? 'default' : 'outline'} onClick={() => setView('summary')}>Summary</Button><Button size="sm" variant={view === 'transactions' ? 'default' : 'outline'} onClick={() => setView('transactions')}>Transactions</Button></>}</div>
        <div className="max-w-xl space-y-1.5"><Label>{mode === 'ledger' ? 'Ledger Account' : 'Account Category'}</Label><SearchableSelect value={targetId} onValueChange={setTargetId} placeholder={mode === 'ledger' ? 'Select ledger account' : 'Select account group'} searchPlaceholder="Search..." options={mode === 'ledger' ? sortedAccounts.map(account => ({ value: account.id, label: account.name, group: account.type, searchText: `${categoryPath(accountCategories, account.category_id)} ${account.group} ${partyByAccount.get(account.id)?.name || ''}` })) : categories.map(category => ({ value: category.id, label: categoryOptionLabel(accountCategories, category.id), group: category.account_type, searchText: categoryPath(accountCategories, category.id) }))} /></div>
        <div className="flex flex-wrap items-end justify-between gap-4"><ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} /><label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={showCancelled} onChange={event => setShowCancelled(event.target.checked)} className="h-4 w-4 accent-primary" />Show cancelled</label></div>
      </CardContent></Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 report-summary"><Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Opening</p><p className="mt-1 font-serif text-lg font-bold num">{formatLedgerBalance(opening, balanceAccount)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Movement</p><p className="mt-1 text-sm num">Dr {fmtMoney(debit)} / Cr {fmtMoney(credit)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Closing</p><p className="mt-1 font-serif text-lg font-bold num">{formatLedgerBalance(closing, balanceAccount)}</p></CardContent></Card></div>
      <Card className="report-table-card overflow-hidden"><div className="overflow-x-auto">
        {mode === 'group' && view === 'summary' ? <table className="w-full min-w-[720px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Ledger</th><th className="report-th text-left">Type</th><th className="report-th text-right">Opening</th><th className="report-th text-right">Debit</th><th className="report-th text-right">Credit</th><th className="report-th text-right">Closing</th></tr></thead><tbody>{group.summary.map(row => <tr key={row.account.id} className="border-t hover:bg-muted/30"><td className="report-td font-medium"><a href={`/reports/ledger?account=${encodeURIComponent(row.account.id)}`} className="hover:underline">{row.account.name}</a></td><td className="report-td text-muted-foreground">{row.account.type}</td><td className="report-td text-right num">{formatLedgerBalance(row.opening, row.account)}</td><td className="report-td text-right num">{fmtMoney(row.debit)}</td><td className="report-td text-right num">{fmtMoney(row.credit)}</td><td className="report-td text-right num font-semibold">{formatLedgerBalance(row.closing, row.account)}</td></tr>)}</tbody></table> : <TransactionTable rows={mode === 'ledger' ? ledger.rows.map(row => ({ ...row, account: ledger.account, displayBalance: row.running_balance })) : group.transactions.map(row => ({ ...row, displayBalance: row.group_running_balance }))} onSelect={setSelected} />}
      </div></Card>
    </PageContent>
    <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>Voucher actions</DialogTitle></DialogHeader>{selected && <VoucherTable vouchers={[selected]} />}</DialogContent></Dialog>
  </div>
}

function TransactionTable({ rows, onSelect }: { rows: Array<ReturnType<typeof getLedgerRows>['rows'][number] & { account?: { name: string } | null; displayBalance: number }>; onSelect: (voucher: Voucher) => void }) {
  return <table className="w-full min-w-[1000px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Date</th><th className="report-th text-left">Ledger</th><th className="report-th text-left">Voucher</th><th className="report-th text-left">Particulars</th><th className="report-th text-left">Narration</th><th className="report-th text-right">Debit</th><th className="report-th text-right">Credit</th><th className="report-th text-right">Balance</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.voucher.id}-${row.account?.name}-${index}`} onClick={() => onSelect(row.voucher)} className={`cursor-pointer border-t hover:bg-muted/30 ${row.cancelled ? 'opacity-50 line-through' : ''}`}><td className="report-td">{fmtDate(row.date_bs)}</td><td className="report-td font-medium">{row.account?.name}</td><td className="report-td">{row.voucher_type} {row.voucher_no}</td><td className="report-td">{row.particulars}</td><td className="report-td text-muted-foreground">{row.narration || '-'}</td><td className="report-td text-right num">{row.debit ? fmtMoney(row.debit) : '-'}</td><td className="report-td text-right num">{row.credit ? fmtMoney(row.credit) : '-'}</td><td className="report-td text-right num font-semibold">{fmtMoney(row.displayBalance)}</td></tr>)}{!rows.length && <tr><td colSpan={8} className="px-4 py-14 text-center text-muted-foreground">No movements in the selected period.</td></tr>}</tbody></table>
}
