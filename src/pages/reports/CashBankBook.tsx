import { useEffect, useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { bankAccounts } from '@/lib/banks'
import { downloadCsv } from '@/lib/csv'
import { resolveSystemAccountId } from '@/lib/engine'
import { getCashBankBook } from '@/lib/managementReports'
import { fiscalYearStartBs } from '@/lib/reports'
import { todayBs } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

export function CashBankBookPage() {
  const { company, rawAccounts, accountCategories, vouchers } = useAppStore()
  const [accountId, setAccountId] = useState('all'), [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(() => fiscalYearStartBs(company)), [to, setTo] = useState(todayBs()), [showCancelled, setShowCancelled] = useState(false)
  useEffect(() => { if (range === 'fiscal') setFrom(fiscalYearStartBs(company)) }, [company, range])
  const moneyAccounts = useMemo(() => company ? [rawAccounts.find(account => account.id === resolveSystemAccountId(rawAccounts, company.id, 'cash')), ...bankAccounts(rawAccounts, accountCategories, true)].filter(Boolean) as typeof rawAccounts : [], [company, rawAccounts, accountCategories])
  const report = useMemo(() => company ? getCashBankBook(company.id, accountId === 'all' ? null : accountId, rawAccounts, accountCategories, vouchers, from, to, showCancelled) : { accounts: [], opening: 0, rows: [], total_receipts: 0, total_payments: 0, closing: 0 }, [company,accountId,rawAccounts,accountCategories,vouchers,from,to,showCancelled])
  const csv = () => downloadCsv('cash-bank-book.csv',['Date','Voucher','Account','Activity','Receipts','Payments','Balance'],report.rows.map(row => [row.voucher.date_bs,row.voucher.invoice_no || row.voucher.seq,row.account_names,row.activity,row.receipts,row.payments,row.running_balance]))
  return <div className="report-page"><PageHeader title="Cash & Bank Book" description="Opening, receipts, payments, transfers, and closing balance" action={<div className="flex gap-2"><Button variant="outline" onClick={csv}><Download className="mr-2 h-4 w-4" />CSV</Button><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button></div>} /><PageContent className="report-content space-y-4"><div className="report-print-header hidden"><h1>{company?.name}</h1><p>Cash & Bank Book | {fmtDate(from)} to {fmtDate(to)}</p></div><Card className="report-controls"><CardContent className="space-y-4 p-4"><div className="max-w-md space-y-1"><Label>Money Account</Label><SearchableSelect value={accountId} onValueChange={setAccountId} options={[{value:'all',label:'All Cash & Bank Accounts'},...moneyAccounts.map(account => ({value:account.id,label:account.name}))]} /></div><div className="flex flex-wrap items-end justify-between gap-4"><ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} /><label className="flex gap-2 text-sm"><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} />Show cancelled</label></div></CardContent></Card><div className="grid gap-3 sm:grid-cols-4">{[['Opening',report.opening],['Receipts',report.total_receipts],['Payments',report.total_payments],['Closing',report.closing]].map(([label,value]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="mt-1 font-serif text-lg font-bold num">Rs {fmtMoney(Number(value))}</p></CardContent></Card>)}</div><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Date</th><th className="report-th text-left">Voucher</th><th className="report-th text-left">Account</th><th className="report-th text-left">Activity</th><th className="report-th text-right">Receipts</th><th className="report-th text-right">Payments</th><th className="report-th text-right">Balance</th></tr></thead><tbody>{report.rows.map((row,index) => <tr key={`${row.voucher.id}-${index}`} className={`border-t ${row.voucher.cancelled ? 'opacity-50 line-through' : ''}`}><td className="report-td">{fmtDate(row.voucher.date_bs)}</td><td className="report-td">{row.voucher.invoice_no || `${row.voucher.type} ${row.voucher.seq}`}</td><td className="report-td">{row.account_names}</td><td className="report-td">{row.activity}</td><td className="report-td text-right num">{row.receipts ? fmtMoney(row.receipts) : '-'}</td><td className="report-td text-right num">{row.payments ? fmtMoney(row.payments) : '-'}</td><td className="report-td text-right num font-semibold">{fmtMoney(row.running_balance)}</td></tr>)}</tbody></table></div></Card></PageContent></div>
}
