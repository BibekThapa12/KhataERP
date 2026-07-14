import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { downloadCsv } from '@/lib/csv'
import { getOutstandingReport, type OutstandingKind } from '@/lib/managementReports'
import { todayBs } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

type View = 'summary' | 'outstanding' | 'aging'
export function ReceivablesPayablesPage() {
  const { company, parties, rawAccounts, vouchers } = useAppStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindParam = searchParams.get('kind')
  const viewParam = searchParams.get('view')
  const kind: OutstandingKind = kindParam === 'payable' ? 'payable' : 'receivable'
  const view: View = viewParam === 'outstanding' || viewParam === 'aging' ? viewParam : 'summary'
  const [asOf, setAsOf] = useState(todayBs())
  const setReportState = (nextKind: OutstandingKind, nextView: View) => setSearchParams({ kind: nextKind, view: nextView })
  const report = useMemo(() => getOutstandingReport(kind, parties, rawAccounts, vouchers, asOf), [kind, parties, rawAccounts, vouchers, asOf])
  const title = kind === 'receivable' ? 'Receivables' : 'Payables'
  const exportCsv = () => view === 'summary'
    ? downloadCsv(`${title}.csv`, ['Party','Outstanding','Unapplied','Adjustments','Ledger Balance','Documents'], report.summaries.map(row => [row.party.name,row.outstanding,row.unapplied,row.unallocated_adjustment,row.ledger_balance,row.document_count]))
    : downloadCsv(`${title}-outstanding.csv`, ['Party','Invoice','Invoice Date','Due Date','Original','Returns','Settled','Outstanding','Age','Bucket'], report.documents.map(row => [row.party.name,row.voucher.invoice_no || row.voucher.seq,row.voucher.date_bs,row.due_date_bs,row.original_amount,row.returns,row.settled,row.outstanding,row.age_days,row.bucket]))
  return <div className="report-page"><PageHeader title="Receivables & Payables" description="Party balances, outstanding documents, unapplied amounts, and aging" action={<div className="flex gap-2"><Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />CSV</Button><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button></div>} /><PageContent className="report-content space-y-4">
    <div className="report-print-header hidden"><h1>{company?.name}</h1><p>{title} as of {fmtDate(asOf)}</p></div>
    <Card className="report-controls"><CardContent className="flex flex-wrap items-end gap-3 p-4"><div className="flex gap-2"><Button size="sm" variant={kind === 'receivable' ? 'default' : 'outline'} onClick={() => setReportState('receivable', view)}>Receivables</Button><Button size="sm" variant={kind === 'payable' ? 'default' : 'outline'} onClick={() => setReportState('payable', view)}>Payables</Button></div><div className="flex gap-2"><Button size="sm" variant={view === 'summary' ? 'default' : 'outline'} onClick={() => setReportState(kind, 'summary')}>Party Summary</Button><Button size="sm" variant={view === 'outstanding' ? 'default' : 'outline'} onClick={() => setReportState(kind, 'outstanding')}>Outstanding</Button><Button size="sm" variant={view === 'aging' ? 'default' : 'outline'} onClick={() => setReportState(kind, 'aging')}>Aging</Button></div><div className="ml-auto space-y-1"><Label>As of</Label><NepaliDateInput value={asOf} onChange={setAsOf} className="w-40" /></div></CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-3"><Metric label={`Total ${title}`} value={report.total_outstanding} /><Metric label="Unapplied" value={report.total_unapplied} /><Metric label="Parties" value={report.summaries.length} money={false} /></div>
    {view === 'aging' ? <div className="grid gap-3 sm:grid-cols-5">{Object.entries(report.buckets).map(([bucket, amount]) => <Metric key={bucket} label={bucket} value={amount} />)}</div> : <Card className="overflow-hidden"><div className="overflow-x-auto">{view === 'summary' ? <table className="w-full min-w-[800px] text-sm"><thead><tr className="bg-muted/50"><Th>Party</Th><Th right>Outstanding</Th><Th right>Unapplied</Th><Th right>Opening / Journal</Th><Th right>Ledger Balance</Th><Th right>Documents</Th></tr></thead><tbody>{report.summaries.map(row => <tr key={row.party.id} className="border-t"><Td>{row.party.name}</Td><Td right>{fmtMoney(row.outstanding)}</Td><Td right>{fmtMoney(row.unapplied)}</Td><Td right>{fmtMoney(row.unallocated_adjustment)}</Td><Td right><a className="font-semibold hover:underline" href={`/reports/ledger?account=${encodeURIComponent(row.party.account_id)}`}>{fmtMoney(row.ledger_balance)}</a></Td><Td right>{row.document_count}</Td></tr>)}</tbody></table> : <table className="w-full min-w-[1000px] text-sm"><thead><tr className="bg-muted/50"><Th>Party</Th><Th>Invoice</Th><Th>Date</Th><Th>Due</Th><Th right>Original</Th><Th right>Returns</Th><Th right>Settled</Th><Th right>Outstanding</Th><Th>Aging</Th></tr></thead><tbody>{report.documents.map(row => <tr key={row.voucher.id} className="border-t"><Td>{row.party.name}</Td><Td>{row.voucher.invoice_no || row.voucher.seq}</Td><Td>{fmtDate(row.voucher.date_bs)}</Td><Td>{fmtDate(row.due_date_bs)}</Td><Td right>{fmtMoney(row.original_amount)}</Td><Td right>{fmtMoney(row.returns)}</Td><Td right>{fmtMoney(row.settled)}</Td><Td right>{fmtMoney(row.outstanding)}</Td><Td>{row.bucket}</Td></tr>)}</tbody></table>}</div></Card>}
  </PageContent></div>
}
function Metric({ label, value, money = true }: { label: string; value: number; money?: boolean }) { return <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="mt-1 font-serif text-xl font-bold num">{money ? `Rs ${fmtMoney(value)}` : value}</p></CardContent></Card> }
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) { return <th className={`report-th ${right ? 'text-right' : 'text-left'}`}>{children}</th> }
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) { return <td className={`report-td ${right ? 'text-right num' : ''}`}>{children}</td> }
