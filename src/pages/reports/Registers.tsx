import { useEffect, useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { downloadCsv } from '@/lib/csv'
import { getRegister, getTransactionRegister, type TransactionRegisterKind } from '@/lib/managementReports'
import { fiscalYearStartBs } from '@/lib/reports'
import { todayBs } from '@/lib/nepaliDate'
import { cn, fmtDate, fmtMoney } from '@/lib/utils'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type RegisterKind = 'sales' | 'purchase' | TransactionRegisterKind

const registerLabels: Record<RegisterKind, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  receipt: 'Receipt',
  payment: 'Payment',
  journal: 'Journal',
}

export function RegistersPage() {
  const { company, vouchers, parties, accounts } = useAppStore()
  const [kind, setKind] = useState<RegisterKind>('sales')
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(() => fiscalYearStartBs(company))
  const [to, setTo] = useState(todayBs())
  const [showCancelled, setShowCancelled] = useState(false)

  useEffect(() => { if (range === 'fiscal') setFrom(fiscalYearStartBs(company)) }, [company, range])

  const invoiceReport = useMemo(
    () => kind === 'sales' || kind === 'purchase' ? getRegister(kind, vouchers, parties, from, to, showCancelled) : null,
    [kind, vouchers, parties, from, to, showCancelled],
  )
  const transactionReport = useMemo(
    () => kind === 'receipt' || kind === 'payment' || kind === 'journal' ? getTransactionRegister(kind, vouchers, accounts, parties, from, to, showCancelled) : null,
    [kind, vouchers, accounts, parties, from, to, showCancelled],
  )
  const title = `${registerLabels[kind]} Register`

  const exportCsv = () => {
    if (invoiceReport) {
      downloadCsv(`${kind}-register.csv`, ['Date', 'Type', 'Voucher No.', 'Party / Cash', 'Subtotal', 'Discount', 'Taxable', 'VAT', 'Gross', 'Net'], invoiceReport.rows.map(row => [row.voucher.date_bs, row.voucher.type, row.voucher.invoice_no || row.voucher.seq, row.party, row.subtotal, row.discount, row.taxable, row.vat, row.gross, row.net]))
      return
    }
    if (transactionReport) downloadCsv(`${kind}-register.csv`, ['Date', 'Voucher No.', 'Type', 'Particulars', 'Narration', 'Debit', 'Credit', 'Amount', 'Status'], transactionReport.rows.map(row => [row.voucher.date_bs, row.voucher.invoice_no || row.voucher.seq, row.voucher.type, row.particulars, row.voucher.narration || '', row.debit, row.credit, row.amount, row.voucher.cancelled ? 'Cancelled' : 'Active']))
  }

  return (
    <div className="report-page">
      <PageHeader title="Transaction Registers" description="Sales, purchases, returns, receipts, payments, and journals" action={<div className="flex gap-2"><Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />CSV</Button><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button></div>} />
      <PageContent className="report-content space-y-4">
        <div className="report-print-header hidden"><h1>{company?.name}</h1><p>{title} | {fmtDate(from)} to {fmtDate(to)}</p></div>
        <Card className="report-controls">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Transaction register">
              {(Object.keys(registerLabels) as RegisterKind[]).map(value => <Button key={value} size="sm" role="tab" aria-selected={kind === value} variant={kind === value ? 'default' : 'outline'} onClick={() => setKind(value)}>{registerLabels[value]}</Button>)}
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showCancelled} onChange={event => setShowCancelled(event.target.checked)} />Show cancelled</label>
            </div>
          </CardContent>
        </Card>

        {invoiceReport ? <InvoiceRegisterTable report={invoiceReport} /> : transactionReport ? <TransactionRegisterTable report={transactionReport} /> : null}
      </PageContent>
    </div>
  )
}

function InvoiceRegisterTable({ report }: { report: ReturnType<typeof getRegister> }) {
  return <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-sm">
    <thead><tr className="bg-muted/50">{['Date', 'Type', 'Voucher No.', 'Party / Cash', 'Subtotal', 'Discount', 'Taxable', 'VAT', 'Gross', 'Net'].map((value, index) => <th key={value} className={cn('report-th', index > 3 ? 'text-right' : 'text-left')}>{value}</th>)}</tr></thead>
    <tbody>{report.rows.length ? report.rows.map(row => <tr key={row.voucher.id} className={cn('border-t', row.voucher.cancelled && 'opacity-50 line-through', row.voucher.type.includes('Return') && 'bg-muted/20')}>
      <td className="report-td">{fmtDate(row.voucher.date_bs)}</td><td className="report-td font-medium">{row.voucher.type}</td><td className="report-td num">{row.voucher.invoice_no || row.voucher.seq}</td><td className="report-td font-medium">{row.party}</td>
      {[row.subtotal, row.discount, row.taxable, row.vat, row.gross, row.net].map((value, index) => <td key={index} className="report-td text-right num">{value ? fmtMoney(value) : '-'}</td>)}
    </tr>) : <tr><td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">No transactions found for this period.</td></tr>}</tbody>
    <tfoot><tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td" colSpan={4}>Total</td>{[report.subtotal, report.discount, report.taxable, report.vat, report.gross, report.net].map((value, index) => <td key={index} className="report-td text-right num">{fmtMoney(value)}</td>)}</tr></tfoot>
  </table></div></Card>
}

function TransactionRegisterTable({ report }: { report: ReturnType<typeof getTransactionRegister> }) {
  return <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm">
    <thead><tr className="bg-muted/50">{['Date', 'Voucher No.', 'Type', 'Particulars', 'Narration', 'Debit', 'Credit', 'Amount', 'Status'].map((value, index) => <th key={value} className={cn('report-th', index >= 5 && index <= 7 ? 'text-right' : 'text-left')}>{value}</th>)}</tr></thead>
    <tbody>{report.rows.length ? report.rows.map(row => <tr key={row.voucher.id} className={cn('border-t', row.voucher.cancelled && 'opacity-50 line-through')}>
      <td className="report-td">{fmtDate(row.voucher.date_bs)}</td><td className="report-td num">{row.voucher.invoice_no || row.voucher.seq}</td><td className="report-td font-medium">{row.voucher.type}</td><td className="report-td">{row.particulars}</td><td className="report-td text-muted-foreground">{row.voucher.narration || '-'}</td><td className="report-td text-right num">{fmtMoney(row.debit)}</td><td className="report-td text-right num">{fmtMoney(row.credit)}</td><td className="report-td text-right num font-semibold">{fmtMoney(row.amount)}</td><td className="report-td">{row.voucher.cancelled ? 'Cancelled' : 'Active'}</td>
    </tr>) : <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">No transactions found for this period.</td></tr>}</tbody>
    <tfoot><tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td" colSpan={5}>Total</td><td className="report-td text-right num">{fmtMoney(report.total_debit)}</td><td className="report-td text-right num">{fmtMoney(report.total_credit)}</td><td className="report-td text-right num">{fmtMoney(report.total_amount)}</td><td /></tr></tfoot>
  </table></div></Card>
}
