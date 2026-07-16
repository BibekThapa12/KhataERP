import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Landmark, ReceiptText, ShoppingBag, TrendingDown, TrendingUp, Users, Wallet,
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { computeProfitAndLoss, recomputeAllBalances, recomputeStock, resolveSystemAccountId, round2, type SystemAccountKey } from '@/lib/engine'
import { todayBs } from '@/lib/nepaliDate'
import { bankAccounts } from '@/lib/banks'
import { computeCashFlow, fiscalYearStartBs, getDaybookRows } from '@/lib/reports'
import {
  accountBalance, buildDashboardSeries, dashboardVouchersInRange, dashboardVouchersThrough,
  isPostedDashboardVoucher, topSellingItems,
} from '@/lib/dashboard'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { VoucherDetail } from '@/components/tables/VoucherTable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Voucher } from '@/types'

const SalesPurchaseChart = lazy(() => import('@/components/dashboard/DashboardCharts').then(module => ({ default: module.SalesPurchaseChart })))
const CashFlowChart = lazy(() => import('@/components/dashboard/DashboardCharts').then(module => ({ default: module.CashFlowChart })))
const CHART_MODE_KEY = 'khata-dashboard-chart-mode'

function DashboardMetric({ label, value, Icon, tone = 'navy', sub, details }: {
  label: string
  value: number
  Icon: typeof Wallet
  tone?: 'navy' | 'green' | 'red' | 'orange' | 'blue' | 'violet'
  sub?: string
  details?: { id: string; label: string; value: number; archived?: boolean }[]
}) {
  const tones = {
    navy: 'border-slate-200 bg-slate-50 text-[#1B2A4A]', green: 'border-emerald-100 bg-emerald-50 text-emerald-700', red: 'border-red-100 bg-red-50 text-red-600',
    orange: 'border-orange-100 bg-orange-50 text-orange-700', blue: 'border-blue-100 bg-blue-50 text-blue-700', violet: 'border-violet-100 bg-violet-50 text-violet-700',
  }
  const card = <Card className="h-full border-border/80 shadow-none transition-[border-color,box-shadow] duration-200 hover:border-primary/20 hover:shadow-sm" tabIndex={details?.length ? 0 : undefined} aria-describedby={details?.length ? 'bank-balance-breakdown' : undefined}>
      <CardContent className="flex items-center gap-3.5 p-4 sm:p-5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-5 text-muted-foreground">{label}</p>
          <p className={`mt-0.5 truncate text-lg font-semibold leading-7 tabular-nums sm:text-xl ${value < 0 ? 'text-destructive' : 'text-primary'}`}>{fmtMoney(value)}</p>
          {sub && <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  if (!details?.length) return card
  return <div className="group relative min-w-0">
    {card}
    <div className="absolute left-0 top-full z-30 hidden w-full min-w-[16rem] pt-2 group-hover:block group-focus-within:block sm:left-auto sm:right-0 sm:w-72" role="tooltip" id="bank-balance-breakdown">
      <div className="rounded-md border bg-popover p-3 text-popover-foreground shadow-lg">
        <div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Bank closing balances</p><span className="text-[10px] text-muted-foreground">As of selected date</span></div>
        <div className="max-h-56 space-y-1 overflow-y-auto">{details.map(detail => <div key={detail.id} className="flex items-center justify-between gap-3 rounded px-1 py-1.5 text-sm hover:bg-muted/40"><span className="min-w-0 truncate font-medium">{detail.label}{detail.archived && <span className="ml-1 text-[10px] font-normal text-muted-foreground">Archived</span>}</span><span className={`shrink-0 num font-semibold ${detail.value < 0 ? 'text-red-600' : ''}`}>{fmtMoney(detail.value)}</span></div>)}</div>
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold"><span>Total</span><span className="num">{fmtMoney(value)}</span></div>
      </div>
    </div>
  </div>
}

function voucherBadge(type: Voucher['type']) {
  if (type === 'Sales' || type === 'Sales Return') return 'sales' as const
  if (type === 'Purchase' || type === 'Purchase Return') return 'purchase' as const
  if (type === 'Receipt') return 'receipt' as const
  if (type === 'Payment') return 'payment' as const
  return 'journal' as const
}

export function Dashboard() {
  const { company, rawAccounts, accountCategories, vouchers, parties, items } = useAppStore()
  const navigate = useNavigate()
  const fiscalStart = fiscalYearStartBs(company)
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(fiscalStart)
  const [to, setTo] = useState(todayBs())
  const [detail, setDetail] = useState<Voucher | null>(null)
  const [chartMode, setChartMode] = useState(() => {
    try { return localStorage.getItem(CHART_MODE_KEY) !== 'false' } catch { return true }
  })

  useEffect(() => {
    if (range === 'fiscal') setFrom(fiscalStart)
  }, [fiscalStart, range])
  useEffect(() => {
    try { localStorage.setItem(CHART_MODE_KEY, String(chartMode)) } catch { /* local storage may be unavailable */ }
  }, [chartMode])

  const valuationMethod = company?.inventory_valuation_method || 'weighted_average'
  const postedVouchers = useMemo(() => vouchers.filter(isPostedDashboardVoucher), [vouchers])
  const periodVouchers = useMemo(() => dashboardVouchersInRange(postedVouchers, from, to), [postedVouchers, from, to])
  const throughTo = useMemo(() => dashboardVouchersThrough(postedVouchers, to), [postedVouchers, to])
  const beforeFrom = useMemo(() => dashboardVouchersThrough(postedVouchers, from, false), [postedVouchers, from])

  const asOfAccounts = useMemo(() => recomputeAllBalances(rawAccounts, throughTo), [rawAccounts, throughTo])
  const periodAccounts = useMemo(() => recomputeAllBalances(
    rawAccounts.map(account => ({ ...account, opening_balance: 0, balance: 0 })), periodVouchers,
  ), [rawAccounts, periodVouchers])
  const asOfMap = useMemo(() => new Map(asOfAccounts.map(account => [account.id, account])), [asOfAccounts])
  const periodMap = useMemo(() => new Map(periodAccounts.map(account => [account.id, account])), [periodAccounts])

  const stockBefore = useMemo(() => recomputeStock(items, beforeFrom, valuationMethod), [items, beforeFrom, valuationMethod])
  const stockAsOf = useMemo(() => recomputeStock(items, throughTo, valuationMethod), [items, throughTo, valuationMethod])
  const openingStockValue = round2(stockBefore.reduce((sum, row) => sum + row.value, 0))
  const closingStockValue = round2(stockAsOf.reduce((sum, row) => sum + row.value, 0))
  const pnl = useMemo(() => computeProfitAndLoss(periodAccounts, round2(closingStockValue - openingStockValue)), [periodAccounts, closingStockValue, openingStockValue])

  const systemId = (key: SystemAccountKey) => company ? resolveSystemAccountId(rawAccounts, company.id, key) : ''
  const cash = accountBalance(asOfMap.get(systemId('cash')))
  const banks = bankAccounts(asOfAccounts, accountCategories, true)
  const totalBanks = round2(banks.reduce((sum, account) => sum + accountBalance(account), 0))
  const bankDetails = banks.map(account => ({ id: account.id, label: account.name, value: accountBalance(account), archived: !!account.is_archived })).sort((a, b) => a.label.localeCompare(b.label))
  const debtors = round2(parties.filter(party => party.type === 'customer').reduce((sum, party) => sum + accountBalance(asOfMap.get(party.account_id)), 0))
  const creditors = round2(parties.filter(party => party.type === 'supplier').reduce((sum, party) => sum + accountBalance(asOfMap.get(party.account_id)), 0))

  const salesId = systemId('sales')
  const salesReturnId = systemId('sales_return')
  const purchaseId = systemId('purchase')
  const purchaseReturnId = systemId('purchase_return')
  const totalSales = round2(accountBalance(periodMap.get(salesId)) - accountBalance(periodMap.get(salesReturnId)))
  const totalPurchases = round2(accountBalance(periodMap.get(purchaseId)) - accountBalance(periodMap.get(purchaseReturnId)))
  const excludedExpenseIds = new Set([purchaseId, salesReturnId])
  const totalExpenses = round2(periodAccounts.filter(account => account.type === 'Expense' && !excludedExpenseIds.has(account.id)).reduce((sum, account) => sum + (account.balance || 0), 0))

  const cashFlow = useMemo(() => company
    ? computeCashFlow(company.id, rawAccounts, accountCategories, postedVouchers, from, to)
    : null, [company, rawAccounts, accountCategories, postedVouchers, from, to])
  const cashMovements = useMemo(() => cashFlow?.sections.flatMap(section => section.rows.map(row => ({ voucher: row.voucher, amount: row.amount }))) || [], [cashFlow])
  const chartSeries = useMemo(() => buildDashboardSeries(postedVouchers, cashMovements, from, to), [postedVouchers, cashMovements, from, to])
  const topItems = useMemo(() => topSellingItems(postedVouchers, items, from, to), [postedVouchers, items, from, to])
  const stockMap = useMemo(() => new Map(stockAsOf.map(row => [row.id, row])), [stockAsOf])
  const lowStock = useMemo(() => items
    .filter(item => !item.is_archived && item.reorder_level != null && (stockMap.get(item.id)?.qty || 0) <= Number(item.reorder_level))
    .map(item => ({ item, qty: stockMap.get(item.id)?.qty || 0 }))
    .sort((left, right) => left.qty - right.qty || left.item.name.localeCompare(right.item.name))
    .slice(0, 5), [items, stockMap])

  const recentRows = useMemo(() => getDaybookRows(periodVouchers, rawAccounts, parties)
    .sort((left, right) => right.date_bs_key - left.date_bs_key || right.voucher.seq - left.voucher.seq)
    .slice(0, 8), [periodVouchers, rawAccounts, parties])

  const companySetupIncomplete = !!company && (company.name === 'My Trading Co.' || !company.address || !company.phone || !company.pan_vat)
  const rangeLabel = chartSeries.grouping === 'daily' ? 'Daily' : chartSeries.grouping === 'weekly' ? 'Weekly' : 'Monthly'

  return <div>
    <PageHeader title="Dashboard" description="Overview of your business" action={
      <button type="button" role="switch" aria-checked={chartMode} aria-label="Toggle chart mode" onClick={() => setChartMode(value => !value)} className="flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium text-[#1B2A4A] hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:justify-start">
        <span>Chart Mode</span><span aria-hidden className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${chartMode ? 'bg-blue-600' : 'bg-slate-300'}`}><span className={`block h-4 w-4 shrink-0 rounded-full bg-white shadow-sm transition-transform ${chartMode ? 'translate-x-4' : 'translate-x-0'}`} /></span>
      </button>
    } />
    <PageContent className="space-y-3">
      {companySetupIncomplete && <Card className="border-amber-200 bg-amber-50/50"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-amber-800">Complete company setup</p><p className="mt-0.5 text-xs text-amber-700">Add company name, address, phone, PAN/VAT, VAT mode, and fiscal year from Settings.</p></div><Button size="sm" onClick={() => navigate('/settings')}>Open Settings</Button></CardContent></Card>}

      <Card className="shadow-none"><CardContent className="p-3 sm:p-4"><ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} /></CardContent></Card>

      <section className="space-y-3" aria-labelledby="account-balance-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="account-balance-heading" className="font-serif text-lg font-bold text-primary">Account Balances</h2>
          <p className="text-xs font-medium text-muted-foreground">Closing balances as of {fmtDate(to)}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardMetric label="Total Debtors" value={debtors} Icon={Users} tone="green" />
          <DashboardMetric label="Total Creditors" value={creditors} Icon={Building2} tone="red" />
          <DashboardMetric label="Cash in Hand" value={cash} Icon={Wallet} tone="green" />
          <DashboardMetric label="Total in Banks" value={totalBanks} Icon={Landmark} tone="blue" sub={`${banks.length} bank account${banks.length === 1 ? '' : 's'}`} details={bankDetails} />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="performance-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="performance-heading" className="font-serif text-lg font-bold text-primary">Period Performance</h2>
          <p className="text-xs font-medium text-muted-foreground">{fmtDate(from)} to {fmtDate(to)}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardMetric label="Total Sales" value={totalSales} Icon={TrendingUp} tone="green" />
          <DashboardMetric label="Total Purchases" value={totalPurchases} Icon={ShoppingBag} tone="orange" />
          <DashboardMetric label="Net Profit / Loss" value={pnl.net_profit} Icon={pnl.net_profit >= 0 ? TrendingUp : TrendingDown} tone="violet" />
          <DashboardMetric label="Total Expenses" value={totalExpenses} Icon={ReceiptText} tone="navy" />
        </div>
      </section>

      {chartMode && <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12" aria-label="Dashboard analytics">
        <Card className="xl:col-span-6"><CardHeader className="flex-row items-center justify-between space-y-0 pb-1.5"><CardTitle className="text-sm">Sales vs Purchase</CardTitle><span className="text-xs text-muted-foreground">{rangeLabel}</span></CardHeader><CardContent className="h-56 px-2 pb-2"><Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading chart…</div>}><SalesPurchaseChart data={chartSeries.points} /></Suspense></CardContent></Card>
        <Card className="xl:col-span-6"><CardHeader className="flex-row items-center justify-between space-y-0 pb-1.5"><CardTitle className="text-sm">Cash Flow</CardTitle><span className="text-xs text-muted-foreground">Net {fmtMoney(cashFlow?.net_change || 0)}</span></CardHeader><CardContent className="h-56 px-2 pb-2"><Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading chart…</div>}><CashFlowChart data={chartSeries.points} /></Suspense></CardContent></Card>
        <Card className="lg:col-span-1 xl:col-span-6"><CardHeader className="flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-base">Top Selling Items</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/items')}>View All</Button></CardHeader><CardContent className="space-y-1 pb-4">{topItems.length ? topItems.map((row, index) => <div key={row.itemId} className="flex items-center gap-3 rounded-md px-1 py-2 text-sm hover:bg-muted/30"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span><span className="min-w-0 flex-1 truncate font-medium">{row.item?.name}</span><span className="num text-muted-foreground">{row.qty} {row.item?.unit}</span></div>) : <div className="py-8 text-center text-sm text-muted-foreground">No sales in this period.</div>}</CardContent></Card>
        <Card className="lg:col-span-1 xl:col-span-6"><CardHeader className="flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-base">Low Stock Alert</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/stock-report')}>View All</Button></CardHeader><CardContent className="space-y-1 pb-4">{lowStock.length ? lowStock.map(({ item, qty }) => { const severe = qty <= 0 || qty <= Number(item.reorder_level || 0) / 2; return <div key={item.id} className="flex items-center gap-3 rounded-md px-1 py-2 text-sm hover:bg-muted/30"><span className={`h-2.5 w-2.5 rounded-full ${severe ? 'bg-red-500' : 'bg-orange-400'}`} aria-label={severe ? 'Critical stock' : 'Low stock'} /><span className="min-w-0 flex-1 truncate font-medium">{item.name}</span><span className="text-right"><span className="num">{qty} {item.unit}</span><span className="block text-[10px] text-muted-foreground">Reorder {item.reorder_level}</span></span></div> }) : <div className="py-8 text-center text-sm text-muted-foreground">No low-stock items.</div>}</CardContent></Card>
      </section>}

      <Card className="border-border/80 shadow-none">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-base">Recent Transactions</CardTitle><Button variant="outline" size="sm" onClick={() => navigate('/reports/daybook')}>View All</Button></CardHeader>
        <CardContent className="p-0 pb-2"><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="border-y bg-muted/35"><th className="report-th text-left">Date</th><th className="report-th text-left">Voucher No.</th><th className="report-th text-left">Type</th><th className="report-th text-left">Party / Account</th><th className="report-th text-right">Amount</th><th className="report-th text-left">Status</th></tr></thead><tbody>{recentRows.length ? recentRows.map(row => <tr key={row.voucher.id} tabIndex={0} onClick={() => setDetail(row.voucher)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetail(row.voucher) } }} className="cursor-pointer border-t transition-colors hover:bg-muted/25 focus-visible:bg-muted/25 focus-visible:outline-none"><td className="report-td">{fmtDate(row.date_bs)}</td><td className="report-td font-mono">{row.voucher_no}</td><td className="report-td"><Badge variant={voucherBadge(row.voucher_type)}>{row.voucher_type}</Badge></td><td className="report-td font-medium">{row.particulars}</td><td className="report-td text-right num font-semibold">{fmtMoney(row.total)}</td><td className="report-td"><Badge variant="sales" className="bg-emerald-50 text-emerald-700">Active</Badge></td></tr>) : <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No posted transactions in this period.</td></tr>}</tbody></table></div></CardContent>
      </Card>
    </PageContent>

    <Dialog open={!!detail} onOpenChange={open => !open && setDetail(null)}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{detail?.type} {detail?.invoice_no ? `· ${detail.invoice_no}` : ''}</DialogTitle></DialogHeader>{detail && <VoucherDetail voucher={detail} />}</DialogContent></Dialog>
  </div>
}
