import { useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { fiscalYearStartBs, formatLedgerBalance, getLedgerRows } from '@/lib/reports'
import { todayBs } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Account, Voucher } from '@/types'

export function LedgerReportPage() {
  const { company, rawAccounts, vouchers } = useAppStore()
  const [searchParams] = useSearchParams()
  const sortedAccounts = useMemo(() => [...rawAccounts].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)), [rawAccounts])
  const [accountId, setAccountId] = useState(() => searchParams.get('account') || '')
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(() => fiscalYearStartBs(company))
  const [to, setTo] = useState(todayBs())
  const [showCancelled, setShowCancelled] = useState(false)
  const [selected, setSelected] = useState<Voucher | null>(null)

  useEffect(() => {
    if (!accountId && sortedAccounts.length) setAccountId(sortedAccounts[0].id)
  }, [accountId, sortedAccounts])

  useEffect(() => {
    if (range === 'fiscal') setFrom(fiscalYearStartBs(company))
  }, [company, range])

  const report = useMemo(
    () => getLedgerRows(accountId, rawAccounts, vouchers, from, to, showCancelled),
    [accountId, rawAccounts, vouchers, from, to, showCancelled],
  )
  const accountsByType = useMemo(() => sortedAccounts.reduce<Record<string, Account[]>>((groups, account) => {
    ;(groups[account.type] ||= []).push(account)
    return groups
  }, {}), [sortedAccounts])

  return (
    <div className="report-page">
      <PageHeader
        title="Ledger Report"
        description="Opening balance, account movements, and running balance"
        action={<Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>}
      />
      <PageContent className="report-content space-y-4">
        <div className="report-print-header hidden">
          <h1>{company?.name || 'KhataERP'}</h1>
          <p>{report.account?.name || 'Ledger'} | {fmtDate(from)} to {fmtDate(to)}</p>
        </div>
        <Card className="report-controls">
          <CardContent className="p-4 space-y-4">
            <div className="max-w-xl space-y-1.5">
              <Label htmlFor="ledger-account">Ledger Account</Label>
              <select
                id="ledger-account"
                value={accountId}
                onChange={event => setAccountId(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {Object.entries(accountsByType).map(([type, accounts]) => (
                  <optgroup key={type} label={type}>
                    {accounts.map(account => <option key={account.id} value={account.id}>{account.name} - {account.group}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} />
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={showCancelled} onChange={event => setShowCancelled(event.target.checked)} className="h-4 w-4 accent-primary" />
                Show cancelled
              </label>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 report-summary">
          <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Opening Balance</p><p className="mt-1 font-serif text-lg font-bold num">{formatLedgerBalance(report.opening_balance, report.account)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Period Movement</p><p className="mt-1 text-sm num"><span className="debit-amt">Dr {fmtMoney(report.total_debit)}</span> / <span className="credit-amt">Cr {fmtMoney(report.total_credit)}</span></p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Closing Balance</p><p className="mt-1 font-serif text-lg font-bold num">{formatLedgerBalance(report.closing_balance, report.account)}</p></CardContent></Card>
        </div>

        <Card className="report-table-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="report-th text-left">Date</th>
                  <th className="report-th text-left">Voucher Type</th>
                  <th className="report-th text-left">Voucher No.</th>
                  <th className="report-th text-left">Particulars</th>
                  <th className="report-th text-left">Narration</th>
                  <th className="report-th text-right">Debit</th>
                  <th className="report-th text-right">Credit</th>
                  <th className="report-th text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border bg-muted/20 font-medium">
                  <td className="report-td" colSpan={7}>Opening Balance</td>
                  <td className="report-td text-right num">{formatLedgerBalance(report.opening_balance, report.account)}</td>
                </tr>
                {report.rows.map(row => (
                  <tr key={`${row.voucher.id}-${row.voucher_no}`} onClick={() => setSelected(row.voucher)} className={`cursor-pointer border-t border-border hover:bg-muted/30 ${row.cancelled ? 'opacity-50 line-through' : ''}`}>
                    <td className="report-td whitespace-nowrap text-muted-foreground">{fmtDate(row.date_bs)}</td>
                    <td className="report-td">{row.voucher_type}{row.cancelled ? ' (Cancelled)' : ''}</td>
                    <td className="report-td num">{row.voucher_no}</td>
                    <td className="report-td font-medium">{row.particulars}</td>
                    <td className="report-td max-w-[200px] truncate text-muted-foreground">{row.narration || '-'}</td>
                    <td className="report-td text-right num">{row.debit ? fmtMoney(row.debit) : '-'}</td>
                    <td className="report-td text-right num">{row.credit ? fmtMoney(row.credit) : '-'}</td>
                    <td className="report-td text-right num font-semibold">{formatLedgerBalance(row.running_balance, report.account)}</td>
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-14 text-center text-muted-foreground">No movements for this ledger in the selected period.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="report-td" colSpan={5}>Closing Balance</td>
                  <td className="report-td text-right num">{fmtMoney(report.total_debit)}</td>
                  <td className="report-td text-right num">{fmtMoney(report.total_credit)}</td>
                  <td className="report-td text-right num">{formatLedgerBalance(report.closing_balance, report.account)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </PageContent>

      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Voucher actions</DialogTitle></DialogHeader>
          {selected && <VoucherTable vouchers={[selected]} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
