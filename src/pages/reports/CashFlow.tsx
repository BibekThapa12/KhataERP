import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, WalletCards } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { computeCashFlow, selectedFiscalYearEndBs, selectedFiscalYearStartBs, type CashFlowSection } from '@/lib/reports'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { downloadCsv } from '@/lib/csv'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { ReportActions } from '@/components/reports/ReportActions'
import { StatCard } from '@/components/StatCard'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { ExpandCollapseControls } from '@/components/ExpandCollapseControls'
import { Badge } from '@/components/ui/misc'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Voucher } from '@/types'

function CashFlowSectionTable({ section, expanded, onToggle, onVoucherClick }: {
  section: CashFlowSection
  expanded: boolean
  onToggle: () => void
  onVoucherClick: (voucher: Voucher) => void
}) {
  const navigate = useNavigate()

  return (
    <Card className="report-table-card overflow-hidden">
      <button type="button" aria-expanded={expanded} onClick={onToggle} className="report-section-header flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="font-serif font-bold">{section.label}</span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">In {fmtMoney(section.inflow)} | Out {fmtMoney(section.outflow)}</span>
        <span className={`num min-w-28 text-right font-semibold ${section.net >= 0 ? 'text-forest' : 'text-terracotta'}`}>{fmtMoney(section.net)}</span>
      </button>
      <div className={expanded ? '' : 'hidden print:block'}>
        {
        section.rows.length ? (
          <div className="overflow-x-auto border-t">
            <table className="w-full min-w-[850px] text-sm">
              <thead><tr className="bg-muted/50"><th className="report-th text-left">Date</th><th className="report-th text-left">Voucher</th><th className="report-th text-left">Particulars</th><th className="report-th text-left">Cash / Bank</th><th className="report-th text-right">Inflow</th><th className="report-th text-right">Outflow</th></tr></thead>
              <tbody>{section.rows.map((row, index) => (
                <tr key={`${row.voucher.id}:${row.account_id}:${index}`} className="border-t hover:bg-muted/20">
                  <td className="report-td whitespace-nowrap text-muted-foreground">{fmtDate(row.voucher.date_bs)}</td>
                  <td className="report-td"><button type="button" onClick={() => onVoucherClick(row.voucher)} className="font-medium text-primary hover:underline">{row.voucher.invoice_no || row.voucher.seq}</button><Badge variant="outline" className="ml-2">{row.voucher.type}</Badge></td>
                  <td className="report-td"><button type="button" onClick={() => navigate(`/reports/ledger?account=${encodeURIComponent(row.account_id)}`)} className="text-left font-medium hover:text-primary hover:underline">{row.account_name}</button>{row.voucher.narration && <div className="mt-0.5 max-w-[280px] truncate text-xs text-muted-foreground">{row.voucher.narration}</div>}</td>
                  <td className="report-td text-muted-foreground">{row.cash_accounts}</td>
                  <td className="report-td text-right num text-forest">{row.amount > 0 ? fmtMoney(row.amount) : '-'}</td>
                  <td className="report-td text-right num text-terracotta">{row.amount < 0 ? fmtMoney(-row.amount) : '-'}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td" colSpan={4}>Net cash from {section.label.toLowerCase()}</td><td className="report-td text-right num">{fmtMoney(section.inflow)}</td><td className="report-td text-right num">{fmtMoney(section.outflow)}</td></tr></tfoot>
            </table>
          </div>
        ) : <div className="border-t px-4 py-8 text-center text-sm text-muted-foreground">No cash movement in this section.</div>
        }
      </div>
    </Card>
  )
}

export function CashFlowPage() {
  const { company, rawAccounts, accountCategories, vouchers } = useAppStore()
  const initialFrom = selectedFiscalYearStartBs(company)
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(() => selectedFiscalYearEndBs(company))
  const [expanded, setExpanded] = useState(() => new Set(['operating', 'investing', 'financing']))
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null)

  useEffect(() => { if (range === 'fiscal') { setFrom(selectedFiscalYearStartBs(company)); setTo(selectedFiscalYearEndBs(company)) } }, [company, range])

  const report = useMemo(() => computeCashFlow(company?.id || '', rawAccounts, accountCategories, vouchers, from, to), [company?.id, rawAccounts, accountCategories, vouchers, from, to])
  const cashAccountNames = report.cash_accounts.map(account => account.name).join(', ') || 'Cash and Bank'
  const allExpanded = report.sections.length > 0 && report.sections.every(section => expanded.has(section.activity))
  const toggleSection = (activity: string) => setExpanded(current => {
    const next = new Set(current)
    if (next.has(activity)) next.delete(activity)
    else next.add(activity)
    return next
  })
  const exportCsv = () => downloadCsv('cash-flow.csv', ['Activity', 'Date', 'Voucher', 'Type', 'Particulars', 'Cash / Bank', 'Inflow', 'Outflow'], report.sections.flatMap(section => section.rows.map(row => [section.label, row.voucher.date_bs, row.voucher.invoice_no || row.voucher.seq, row.voucher.type, row.account_name, row.cash_accounts, row.amount > 0 ? row.amount : '', row.amount < 0 ? -row.amount : ''])))

  return (
    <div className="report-page">
      <PageHeader title="Cash Flow" description="Cash and bank movement by operating, investing and financing activities" action={<ReportActions onExport={exportCsv} />} />
      <PageContent className="report-content space-y-4">
        <div className="report-print-header hidden"><h1>{company?.name || 'KhataERP'}</h1><p>Cash Flow | {fmtDate(from)} to {fmtDate(to)}</p></div>
        <Card className="report-controls"><CardContent className="p-4"><ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} /></CardContent></Card>

        <div className="report-summary grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Opening Cash + Bank" value={report.opening_balance} sub={cashAccountNames} Icon={WalletCards} />
          <StatCard label="Total Inflow" value={report.total_inflow} color="positive" Icon={ArrowDownToLine} />
          <StatCard label="Total Outflow" value={report.total_outflow} color="negative" Icon={ArrowUpFromLine} />
          <StatCard label="Closing Cash + Bank" value={report.closing_balance} color={report.closing_balance >= 0 ? 'default' : 'negative'} sub={`Net change ${fmtMoney(report.net_change)}`} Icon={WalletCards} />
        </div>

        <ExpandCollapseControls expanded={allExpanded} onToggle={() => setExpanded(allExpanded ? new Set() : new Set(report.sections.map(section => section.activity)))} />
        {report.sections.map(section => <CashFlowSectionTable key={section.activity} section={section} expanded={expanded.has(section.activity)} onToggle={() => toggleSection(section.activity)} onVoucherClick={setSelectedVoucher} />)}

        <Card className="report-table-card"><CardContent className="p-4"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium">Opening balance + net cash movement</span><span className="num font-semibold">{fmtMoney(report.opening_balance)} + {fmtMoney(report.net_change)} = {fmtMoney(report.closing_balance)}</span></div></CardContent></Card>
      </PageContent>

      <Dialog open={!!selectedVoucher} onOpenChange={open => !open && setSelectedVoucher(null)}>
        <DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>Voucher details</DialogTitle></DialogHeader>{selectedVoucher && <VoucherTable vouchers={[selectedVoucher]} />}</DialogContent>
      </Dialog>
    </div>
  )
}
