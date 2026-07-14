// ─── Shared report helpers ────────────────────────────────────────────────────
import { Fragment, useState, useMemo } from 'react'
import { AlertTriangle, Boxes, ChevronDown, ChevronRight, Layers3, Search, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { computeTrialBalance, computeProfitAndLoss, computeBalanceSheet, computeVatReport, computeStockSummary, normalSide } from '@/lib/engine'
import { buildAccountReportTree, groupReportAccounts, type AccountReportTreeNode } from '@/lib/reports'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { downloadCsv } from '@/lib/csv'
import { firstOfCurrentBsMonth, todayBs } from '@/lib/nepaliDate'
import { formatStockQuantity } from '@/lib/units'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/StatCard'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { ReportActions } from '@/components/reports/ReportActions'
import { Badge } from '@/components/ui/misc'
import { normalizeSearch } from '@/lib/search'
import { categoryDescendantIds, categoryOptionLabel, categoryPath } from '@/lib/categoryHierarchy'
import type { Account, InventoryValuationMethod } from '@/types'

// ─── Trial Balance ────────────────────────────────────────────────────────────
function LedgerLink({ account }: { account: Account }) {
  const navigate = useNavigate()
  return account.company_id ? <button type="button" onClick={() => navigate(`/reports/ledger?account=${encodeURIComponent(account.id)}`)} className="max-w-full truncate text-left text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{account.name}</button> : <span>{account.name}</span>
}

function useExpandedGroups() {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  return { expanded, toggle }
}

function GroupButton({ groupKey, name, count, type, expanded, toggle }: { groupKey: string; name: string; count: number; type?: string; expanded: boolean; toggle: (key: string) => void }) {
  return <button type="button" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`} onClick={() => toggle(groupKey)} className="flex max-w-full items-center gap-2 text-left"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-muted">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span><span className="truncate">{name}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">{type ? `${type} · ` : ''}{count}</span></button>
}

function GroupedTrialTable({ accounts, totalDebit, totalCredit }: { accounts: Account[]; totalDebit: number; totalCredit: number }) {
  const groups = useMemo(() => groupReportAccounts(accounts.filter(account => Math.abs(account.balance || 0) >= 0.005)), [accounts])
  const { expanded, toggle } = useExpandedGroups()
  return <div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Account Group</th><th className="report-th text-right">Debit</th><th className="report-th text-right">Credit</th></tr></thead><tbody>{groups.map(group => <Fragment key={group.key}><tr className="border-t bg-muted/10 font-semibold hover:bg-muted/30"><td className="report-td"><GroupButton groupKey={group.key} name={group.name} count={group.accounts.length} type={group.type} expanded={expanded.has(group.key)} toggle={toggle} /></td><td className="report-td text-right num debit-amt">{group.debit ? fmtMoney(group.debit) : '—'}</td><td className="report-td text-right num credit-amt">{group.credit ? fmtMoney(group.credit) : '—'}</td></tr>{expanded.has(group.key) && group.accounts.map(account => { const side = normalSide(account.type); const balance = account.balance || 0; const debit = (side === 'debit' ? balance > 0 : balance < 0) ? Math.abs(balance) : 0; const credit = (side === 'credit' ? balance > 0 : balance < 0) ? Math.abs(balance) : 0; return <tr key={account.id} className="border-t hover:bg-muted/20"><td className="report-td pl-12"><LedgerLink account={account} /></td><td className="report-td text-right num">{debit ? <span className="debit-amt">{fmtMoney(debit)}</span> : '—'}</td><td className="report-td text-right num">{credit ? <span className="credit-amt">{fmtMoney(credit)}</span> : '—'}</td></tr> })}</Fragment>)}</tbody><tfoot><tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td">Total</td><td className="report-td text-right num">{fmtMoney(totalDebit)}</td><td className="report-td text-right num">{fmtMoney(totalCredit)}</td></tr></tfoot></table></div>
}

function GroupedAmountTable({ accounts, total, emptyLabel, totalLabel = 'Total', adjustments = [] }: { accounts: Account[]; total: number; emptyLabel: string; totalLabel?: string; adjustments?: { label: string; amount: number; className?: string }[] }) {
  const groups = useMemo(() => groupReportAccounts(accounts), [accounts])
  const { expanded, toggle } = useExpandedGroups()
  if (!groups.length && !adjustments.length) return <p className="px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
  return <table className="w-full border-collapse text-sm"><tbody>{groups.map(group => <Fragment key={group.key}><tr className="border-t bg-muted/10 font-semibold hover:bg-muted/30"><td className="report-td"><GroupButton groupKey={group.key} name={group.name} count={group.accounts.length} expanded={expanded.has(group.key)} toggle={toggle} /></td><td className="report-td text-right num">{fmtMoney(group.balance)}</td></tr>{expanded.has(group.key) && group.accounts.map(account => <tr key={account.id} className="border-t hover:bg-muted/20"><td className="report-td pl-12"><LedgerLink account={account} /></td><td className="report-td text-right num">{fmtMoney(account.balance)}</td></tr>)}</Fragment>)}{adjustments.map(row => <tr key={row.label} className={`border-t hover:bg-muted/20 ${row.className || ''}`}><td className="report-td italic">{row.label}</td><td className="report-td text-right num">{fmtMoney(row.amount)}</td></tr>)}<tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td">{totalLabel}</td><td className="report-td text-right num">{fmtMoney(total)}</td></tr></tbody></table>
}

function TrialNodeRows({ node, expanded, toggle }: { node: AccountReportTreeNode; expanded: Set<string>; toggle: (key: string) => void }) {
  const open = expanded.has(node.key)
  return <Fragment><tr className="border-t bg-muted/10 font-semibold hover:bg-muted/30"><td className="report-td" style={{ paddingLeft: `${0.75 + (node.depth - 1) * 1.25}rem` }}><GroupButton groupKey={node.key} name={node.name} count={node.totalCount} type={node.type} expanded={open} toggle={toggle} /></td><td className="report-td text-right num debit-amt">{node.debit ? fmtMoney(node.debit) : '—'}</td><td className="report-td text-right num credit-amt">{node.credit ? fmtMoney(node.credit) : '—'}</td></tr>{open && node.directAccounts.map(account => { const side = normalSide(account.type); const balance = account.balance || 0; const debit = (side === 'debit' ? balance > 0 : balance < 0) ? Math.abs(balance) : 0; const credit = (side === 'credit' ? balance > 0 : balance < 0) ? Math.abs(balance) : 0; return <tr key={account.id} className="border-t hover:bg-muted/20"><td className="report-td" style={{ paddingLeft: `${2.5 + (node.depth - 1) * 1.25}rem` }}><LedgerLink account={account} /></td><td className="report-td text-right num">{debit ? fmtMoney(debit) : '—'}</td><td className="report-td text-right num">{credit ? fmtMoney(credit) : '—'}</td></tr>})}{open && node.children.map(child => <TrialNodeRows key={child.key} node={child} expanded={expanded} toggle={toggle} />)}</Fragment>
}

function HierarchicalTrialTable({ accounts, categories, totalDebit, totalCredit }: { accounts: Account[]; categories: import('@/types').AccountCategory[]; totalDebit: number; totalCredit: number }) {
  const nodes = useMemo(() => buildAccountReportTree(accounts.filter(account => Math.abs(account.balance || 0) >= 0.005), categories), [accounts, categories])
  const { expanded, toggle } = useExpandedGroups()
  return <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Category / Ledger</th><th className="report-th text-right">Debit</th><th className="report-th text-right">Credit</th></tr></thead><tbody>{nodes.map(node => <TrialNodeRows key={node.key} node={node} expanded={expanded} toggle={toggle} />)}</tbody><tfoot><tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td">Total</td><td className="report-td text-right num">{fmtMoney(totalDebit)}</td><td className="report-td text-right num">{fmtMoney(totalCredit)}</td></tr></tfoot></table></div>
}

function AmountNodeRows({ node, expanded, toggle }: { node: AccountReportTreeNode; expanded: Set<string>; toggle: (key: string) => void }) {
  const open = expanded.has(node.key)
  return <Fragment><tr className="border-t bg-muted/10 font-semibold hover:bg-muted/30"><td className="report-td" style={{ paddingLeft: `${0.75 + (node.depth - 1) * 1.25}rem` }}><GroupButton groupKey={node.key} name={node.name} count={node.totalCount} expanded={open} toggle={toggle} /></td><td className="report-td text-right num">{fmtMoney(node.balance)}</td></tr>{open && node.directAccounts.map(account => <tr key={account.id} className="border-t hover:bg-muted/20"><td className="report-td" style={{ paddingLeft: `${2.5 + (node.depth - 1) * 1.25}rem` }}><LedgerLink account={account} /></td><td className="report-td text-right num">{fmtMoney(account.balance)}</td></tr>)}{open && node.children.map(child => <AmountNodeRows key={child.key} node={child} expanded={expanded} toggle={toggle} />)}</Fragment>
}

function HierarchicalAmountTable({ accounts, categories, total, emptyLabel, totalLabel = 'Total', adjustments = [] }: { accounts: Account[]; categories: import('@/types').AccountCategory[]; total: number; emptyLabel: string; totalLabel?: string; adjustments?: { label: string; amount: number; className?: string }[] }) {
  const nodes = useMemo(() => buildAccountReportTree(accounts, categories), [accounts, categories])
  const { expanded, toggle } = useExpandedGroups()
  if (!nodes.length && !adjustments.length) return <p className="p-4 text-sm text-muted-foreground">{emptyLabel}</p>
  return <table className="w-full text-sm"><tbody>{nodes.map(node => <AmountNodeRows key={node.key} node={node} expanded={expanded} toggle={toggle} />)}{adjustments.map(row => <tr key={row.label} className={`border-t ${row.className || ''}`}><td className="report-td italic">{row.label}</td><td className="report-td text-right num">{fmtMoney(row.amount)}</td></tr>)}<tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td">{totalLabel}</td><td className="report-td text-right num">{fmtMoney(total)}</td></tr></tbody></table>
}

export function TrialBalancePage() {
  const { company, accounts, accountCategories } = useAppStore()
  const tb = useMemo(() => computeTrialBalance(accounts), [accounts])
  const exportCsv = () => downloadCsv('trial-balance.csv', ['Ledger', 'Category', 'Debit', 'Credit'], accounts.filter(account => Math.abs(account.balance || 0) >= 0.005).map(account => {
    const balance = account.balance || 0
    const side = normalSide(account.type)
    const debit = (side === 'debit' ? balance > 0 : balance < 0) ? Math.abs(balance) : 0
    const credit = (side === 'credit' ? balance > 0 : balance < 0) ? Math.abs(balance) : 0
    return [account.name, categoryPath(accountCategories, account.category_id), debit || '', credit || '']
  }))

  return (
    <div className="report-page">
      <PageHeader title="Trial Balance" description="All account balances — debits must equal credits" action={<ReportActions onExport={exportCsv} />} />
      <PageContent className="report-content">
        <div className="report-print-header hidden"><h1>{company?.name || 'KhataERP'}</h1><p>Trial Balance | As of {fmtDate(todayBs())}</p></div>
        <Card className="report-table-card">
          <HierarchicalTrialTable accounts={accounts} categories={accountCategories} totalDebit={tb.total_debit} totalCredit={tb.total_credit} />
          {tb.balanced
            ? <p className="px-4 py-3 text-sm text-forest font-semibold">✓ Balanced</p>
            : <p className="px-4 py-3 text-sm text-destructive">⚠ Not balanced — check recent journal entries</p>
          }
        </Card>
      </PageContent>
    </div>
  )
}

// ─── Profit & Loss ────────────────────────────────────────────────────────────
export function ProfitLossPage() {
  const { company, accounts, accountCategories, closingStockValue } = useAppStore()
  const csv = closingStockValue()
  const pnl = useMemo(() => computeProfitAndLoss(accounts, csv), [accounts, csv])
  const exportCsv = () => downloadCsv('profit-and-loss.csv', ['Section', 'Ledger / Adjustment', 'Category', 'Amount'], [
    ...pnl.income.map(account => ['Income', account.name, categoryPath(accountCategories, account.category_id), account.balance || 0]),
    ...pnl.expense.map(account => ['Expense', account.name, categoryPath(accountCategories, account.category_id), account.balance || 0]),
    ...(csv ? [['Expense', 'Less: Closing Stock', '', -csv]] : []),
    ['', 'Total Income', '', pnl.total_income], ['', 'Total Expense', '', pnl.total_expense], ['', pnl.net_profit >= 0 ? 'Net Profit' : 'Net Loss', '', Math.abs(pnl.net_profit)],
  ])

  return (
    <div className="report-page">
      <PageHeader title="Profit & Loss"
        description="Income vs expenses, adjusted for closing stock so profit reflects only goods actually sold" action={<ReportActions onExport={exportCsv} />} />
      <PageContent className="report-content space-y-4">
        <div className="report-print-header hidden"><h1>{company?.name || 'KhataERP'}</h1><p>Profit & Loss | As of {fmtDate(todayBs())}</p></div>
        <div className="report-summary grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Total Income" value={pnl.total_income} color="positive" />
          <StatCard label="Total Expense" value={pnl.total_expense} color="negative"
            sub={csv > 0 ? `After closing stock deduction of ${fmtMoney(csv)}` : undefined} />
          <StatCard label={pnl.net_profit >= 0 ? 'Net Profit' : 'Net Loss'} value={Math.abs(pnl.net_profit)}
            color={pnl.net_profit >= 0 ? 'positive' : 'negative'} />
        </div>

        <div className="report-print-columns grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="report-table-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Income</CardTitle></CardHeader>
            <CardContent className="p-0 pb-1">
              <HierarchicalAmountTable accounts={pnl.income} categories={accountCategories} total={pnl.total_income} emptyLabel="No income accounts" />
            </CardContent>
          </Card>
          <Card className="report-table-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Expense</CardTitle></CardHeader>
            <CardContent className="p-0 pb-1">
              <HierarchicalAmountTable accounts={pnl.expense} categories={accountCategories} total={pnl.total_expense} totalLabel="Total (adjusted)" emptyLabel="No expense accounts" adjustments={csv > 0 ? [{ label: 'Less: Closing Stock', amount: -csv, className: 'text-forest' }] : []} />
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </div>
  )
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────
export function BalanceSheetPage() {
  const { company, accounts, accountCategories, closingStockValue } = useAppStore()
  const csv = closingStockValue()
  const pnl = useMemo(() => computeProfitAndLoss(accounts, csv), [accounts, csv])
  const bs = useMemo(() => computeBalanceSheet(accounts, pnl.net_profit, csv), [accounts, pnl.net_profit, csv])
  const realAssets = bs.assets.filter(account => !!account.company_id)
  const exportCsv = () => downloadCsv('balance-sheet.csv', ['Section', 'Ledger / Adjustment', 'Category', 'Amount'], [
    ...realAssets.map(account => ['Assets', account.name, categoryPath(accountCategories, account.category_id), account.balance || 0]),
    ...(csv ? [['Assets', 'Stock-in-Hand (Closing)', '', csv]] : []),
    ...bs.liabilities.map(account => ['Liabilities', account.name, categoryPath(accountCategories, account.category_id), account.balance || 0]),
    ...bs.equity.map(account => ['Equity', account.name, categoryPath(accountCategories, account.category_id), account.balance || 0]),
    ['Equity', `Net ${pnl.net_profit >= 0 ? 'Profit' : 'Loss'} (current)`, '', pnl.net_profit],
    ['', 'Total Assets', '', bs.total_assets], ['', 'Total Liabilities & Equity', '', bs.total_liabilities + bs.total_equity],
  ])

  return (
    <div className="report-page">
      <PageHeader title="Balance Sheet" description="Assets, liabilities and equity including closing stock and current profit" action={<ReportActions onExport={exportCsv} />} />
      <PageContent className="report-content space-y-4">
        <div className="report-print-header hidden"><h1>{company?.name || 'KhataERP'}</h1><p>Balance Sheet | As of {fmtDate(todayBs())}</p></div>
        <div className="report-print-columns grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="report-table-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Assets</CardTitle></CardHeader>
            <CardContent className="p-0 pb-1">
              <HierarchicalAmountTable accounts={realAssets} categories={accountCategories} total={bs.total_assets} emptyLabel="No assets" adjustments={csv !== 0 ? [{ label: 'Stock-in-Hand (Closing)', amount: csv }] : []} />
            </CardContent>
          </Card>
          <Card className="report-table-card">
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Liabilities & Equity</CardTitle></CardHeader>
            <CardContent className="p-0 pb-1">
              <HierarchicalAmountTable accounts={[...bs.liabilities, ...bs.equity]} categories={accountCategories} total={bs.total_liabilities + bs.total_equity} emptyLabel="No liabilities or equity" adjustments={[{ label: `Net ${pnl.net_profit >= 0 ? 'Profit' : 'Loss'} (current)`, amount: pnl.net_profit, className: 'text-muted-foreground' }]} />
            </CardContent>
          </Card>
        </div>
        {bs.balanced
          ? <p className="text-sm text-forest font-semibold">✓ Balanced — {fmtMoney(bs.total_assets)} = {fmtMoney(bs.total_liabilities + bs.total_equity)}</p>
          : <p className="text-sm text-destructive">⚠ Balance sheet is out of balance. Check recent entries.</p>
        }
      </PageContent>
    </div>
  )
}

// ─── VAT Report ───────────────────────────────────────────────────────────────
export function VatReportPage() {
  const vouchers = useAppStore(s => s.vouchers)
  const company = useAppStore(s => s.company)
  const [from, setFrom] = useState(firstOfCurrentBsMonth())
  const [to, setTo] = useState(todayBs())
  const [applied, setApplied] = useState({ from: firstOfCurrentBsMonth(), to: todayBs() })

  const vat = useMemo(() => computeVatReport(vouchers, applied.from, applied.to), [vouchers, applied])

  if (company?.vat_enabled === false) {
    return (
      <div>
        <PageHeader title="VAT Report" description="VAT mode is disabled for this company" />
        <PageContent>
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              This company is using internal bookkeeping mode, so VAT reporting is not active.
              You can enable VAT Mode from Settings if you need VAT invoices and reports.
            </CardContent>
          </Card>
        </PageContent>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="VAT Report" description="Output vs input VAT for a date range — for filing your monthly/trimester return" />
      <PageContent className="space-y-5">
        {/* Date filter */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>From</Label>
                <NepaliDateInput value={from} onChange={setFrom} className="w-40" />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <NepaliDateInput value={to} onChange={setTo} className="w-40" />
              </div>
              <Button onClick={() => setApplied({ from, to })}>Apply</Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Output VAT (on Sales)" value={vat.output_vat}
            sub={`Net taxable sales: ${fmtMoney(vat.taxable_sales)} | Returns VAT: ${fmtMoney(vat.sales_return_vat)}`} />
          <StatCard label="Input VAT (on Purchases)" value={vat.input_vat}
            sub={`Net taxable purchases: ${fmtMoney(vat.taxable_purchases)} | Returns VAT: ${fmtMoney(vat.purchase_return_vat)}`} />
          <StatCard
            label={vat.net_payable >= 0 ? 'Net VAT Payable' : 'Net VAT Credit'}
            value={Math.abs(vat.net_payable)}
            color={vat.net_payable > 0 ? 'negative' : 'positive'}
          />
        </div>

        {/* Transaction list */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Transactions in range</CardTitle></CardHeader>
          <CardContent className="p-0 pb-2">
            <VoucherTable
              vouchers={[...vat.sales, ...vat.purchases, ...vat.sales_returns, ...vat.purchase_returns].sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq)}
              showActions={false}
            />
          </CardContent>
        </Card>
      </PageContent>
    </div>
  )
}

// ─── Stock Report ─────────────────────────────────────────────────────────────
export function StockReportPage() {
  const { company, items, vouchers, itemCategories, saveCompany } = useAppStore()
  const [showDetails, setShowDetails] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [status, setStatus] = useState<'all' | 'in' | 'low' | 'out'>('all')
  const [methodError, setMethodError] = useState('')
  const method = company?.inventory_valuation_method || 'weighted_average'
  const movements = useMemo(() => computeStockSummary(items, vouchers, method), [items, vouchers, method])
  const movementByItem = useMemo(() => new Map(movements.map(entry => [entry.id, entry])), [movements])
  const allowedCategories = useMemo(() => categoryId === 'all' ? null : new Set([categoryId, ...categoryDescendantIds(itemCategories, categoryId)]), [categoryId, itemCategories])
  const query = normalizeSearch(search)
  const rows = items.map(item => {
    const movement = movementByItem.get(item.id) || { id: item.id, opening_qty: 0, opening_value: 0, inward_qty: 0, inward_value: 0, outward_qty: 0, outward_value: 0, closing_qty: 0, closing_rate: 0, closing_value: 0 }
    const rowStatus: 'in' | 'low' | 'out' = movement.closing_qty <= 0 ? 'out' : item.reorder_level != null && movement.closing_qty <= item.reorder_level ? 'low' : 'in'
    return { item, movement, category: categoryPath(itemCategories, item.category_id), status: rowStatus }
  }).filter(row => !query || normalizeSearch(`${row.item.name} ${row.category} ${row.item.sku || ''} ${row.item.barcode || ''} ${row.item.unit} ${row.item.alternate_unit || ''}`).includes(query))
    .filter(row => !allowedCategories || (!!row.item.category_id && allowedCategories.has(row.item.category_id)))
    .filter(row => status === 'all' || row.status === status)
    .sort((left, right) => left.item.name.localeCompare(right.item.name))
  const totalValue = rows.reduce((sum, row) => sum + row.movement.closing_value, 0)
  const lowStockCount = rows.filter(row => row.status === 'low').length
  const categoryCount = new Set(rows.map(row => row.item.category_id).filter(Boolean)).size
  const sameUnit = new Set(rows.map(row => row.item.unit.toLowerCase())).size <= 1
  const totals = rows.reduce((sum, row) => ({ opening: sum.opening + row.movement.opening_qty, inward: sum.inward + row.movement.inward_qty, outward: sum.outward + row.movement.outward_qty, closing: sum.closing + row.movement.closing_qty }), { opening: 0, inward: 0, outward: 0, closing: 0 })
  const methodLabel = method === 'fifo' ? 'FIFO' : method === 'lifo' ? 'LIFO' : 'Weighted Average'
  const qty = (value: number, item: typeof items[number]) => <><span className="block whitespace-nowrap num">{value.toLocaleString('en-NP', { maximumFractionDigits: 4 })} {item.unit}</span>{item.alternate_unit && <span className="block whitespace-nowrap text-[11px] text-muted-foreground">({(value * Number(item.alternate_conversion || 0)).toLocaleString('en-NP', { maximumFractionDigits: 4 })} {item.alternate_unit})</span>}</>
  const badge = (value: 'in' | 'low' | 'out') => value === 'in' ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">In Stock</Badge> : value === 'low' ? <Badge className="border-amber-200 bg-amber-50 text-amber-700">Low</Badge> : <Badge className="border-red-200 bg-red-50 text-red-700">Out</Badge>
  const changeMethod = async (value: string) => {
    const next = value as InventoryValuationMethod
    if (next === method || !window.confirm('Changing the valuation method will recalculate all historical stock values and may change Profit & Loss and Balance Sheet totals. Continue?')) return
    setMethodError('')
    try { await saveCompany({ inventory_valuation_method: next }) } catch (error: unknown) { setMethodError((error as Error).message) }
  }
  const headings = showDetails ? ['Item', 'Category', 'Unit', 'Opening', 'Inward', 'Outward', 'Closing', 'Avg Rate', 'Value', 'Status'] : ['Item', 'Category', 'Unit', 'Closing', 'Avg Rate', 'Value', 'Status']
  const exportCsv = () => downloadCsv('stock-summary.csv', headings, rows.map(row => showDetails
    ? [row.item.name, row.category, row.item.unit, row.movement.opening_qty, row.movement.inward_qty, row.movement.outward_qty, row.movement.closing_qty, row.movement.closing_rate, row.movement.closing_value, row.status]
    : [row.item.name, row.category, row.item.unit, row.movement.closing_qty, row.movement.closing_rate, row.movement.closing_value, row.status]))

  return <div className="report-page">
    <PageHeader title="Stock Summary" description={`Current inventory status with ${methodLabel} valuation`} action={<ReportActions onExport={exportCsv} />} />
    <PageContent className="report-content space-y-5">
      <div className="report-print-header hidden"><h1>{company?.name || 'KhataERP'}</h1><p>Stock Summary | As of {fmtDate(todayBs())} | {methodLabel}</p></div>
      <div className="report-summary grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Items" value={String(rows.length)} Icon={Boxes} />
        <StatCard label={`Stock Value (${methodLabel})`} value={totalValue} Icon={TrendingUp} color="positive" />
        <StatCard label="Low Stock Items" value={String(lowStockCount)} Icon={AlertTriangle} color="warning" />
        <StatCard label="Categories" value={String(categoryCount)} Icon={Layers3} />
      </div>
      <div className="report-controls flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search items…" className="w-full pl-8" /></div>
        <SearchableSelect className="w-full lg:w-56" value={categoryId} onValueChange={setCategoryId} options={[{ value: 'all', label: 'All Categories' }, ...itemCategories.map(category => ({ value: category.id, label: categoryOptionLabel(itemCategories, category.id), searchText: categoryPath(itemCategories, category.id) }))]} />
        <SearchableSelect className="w-full lg:w-40" value={status} onValueChange={value => setStatus(value as typeof status)} options={[{ value: 'all', label: 'All Status' }, { value: 'in', label: 'In Stock' }, { value: 'low', label: 'Low Stock' }, { value: 'out', label: 'Out of Stock' }]} />
        <SearchableSelect className="w-full lg:w-52" value={method} onValueChange={changeMethod} options={[{ value: 'weighted_average', label: 'Weighted Average' }, { value: 'fifo', label: 'FIFO' }, { value: 'lifo', label: 'LIFO' }]} />
        <Button size="sm" variant={showDetails ? 'default' : 'outline'} onClick={() => setShowDetails(value => !value)}>{showDetails ? 'Hide Details' : 'Show Details'}</Button>
      </div>
      {methodError && <p className="text-sm text-destructive">{methodError}</p>}
      <Card className="report-table-card overflow-hidden">{rows.length === 0 ? <div className="py-16 text-center text-muted-foreground"><Boxes className="mx-auto mb-3 h-8 w-8 opacity-30" /><p className="font-medium text-foreground">No matching stock items</p><p className="mt-1 text-sm">Try changing the search or filters.</p></div> : <div className="overflow-x-auto"><table className={`w-full border-collapse text-sm ${showDetails ? 'min-w-[1120px]' : 'min-w-[820px]'}`}>
        <thead><tr className="bg-muted/50">{headings.map((heading, index) => <th key={heading} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground ${index >= 3 && heading !== 'Status' ? 'text-right' : 'text-left'}`}>{heading}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.item.id} className="border-t border-border hover:bg-muted/20"><td className="px-4 py-3 font-medium">{row.item.name}</td><td className="px-4 py-3 text-muted-foreground">{row.category || '—'}</td><td className="px-4 py-3"><span className="block">{row.item.unit}</span>{row.item.alternate_unit && <span className="block text-[11px] text-muted-foreground">1 {row.item.unit} = {row.item.alternate_conversion} {row.item.alternate_unit}</span>}</td>{showDetails && <><td className="px-4 py-3 text-right">{qty(row.movement.opening_qty, row.item)}</td><td className="px-4 py-3 text-right text-emerald-600">{qty(row.movement.inward_qty, row.item)}</td><td className="px-4 py-3 text-right text-red-600">{qty(row.movement.outward_qty, row.item)}</td></>}<td className="px-4 py-3 text-right font-semibold">{qty(row.movement.closing_qty, row.item)}</td><td className="px-4 py-3 text-right num">{fmtMoney(row.movement.closing_rate)}</td><td className="px-4 py-3 text-right num font-semibold">{fmtMoney(row.movement.closing_value)}</td><td className="px-4 py-3">{badge(row.status)}</td></tr>)}</tbody>
        <tfoot><tr className="border-t-2 border-border bg-muted/30 font-semibold"><td className="px-4 py-3" colSpan={3}>Filtered Total ({rows.length} item{rows.length === 1 ? '' : 's'})</td>{showDetails && (['opening', 'inward', 'outward'] as const).map(key => <td key={key} className="px-4 py-3 text-right num">{sameUnit ? totals[key].toLocaleString('en-NP', { maximumFractionDigits: 4 }) : '—'}</td>)}<td className="px-4 py-3 text-right num">{sameUnit ? totals.closing.toLocaleString('en-NP', { maximumFractionDigits: 4 }) : '—'}</td><td></td><td className="px-4 py-3 text-right num">{fmtMoney(totalValue)}</td><td></td></tr></tfoot>
      </table></div>}</Card>
    </PageContent>
  </div>
}

export function LegacyStockReportPage() {
  const { items, stock, vouchers, itemCategories } = useAppStore()
  const [showDetails, setShowDetails] = useState(false)
  const [search, setSearch] = useState('')
  const q = normalizeSearch(search)
  const movements = useMemo(() => computeStockSummary(items, vouchers), [items, vouchers])
  const rows = items
    .filter(item => !q || normalizeSearch(`${item.name} ${categoryPath(itemCategories, item.category_id)} ${item.sku || ''} ${item.barcode || ''} ${item.unit} ${item.alternate_unit || ''}`).includes(q))
    .map(item => ({
      item,
      s: stock.find(e => e.id === item.id) ?? { qty: 0, avg_cost: 0, value: 0 },
      movement: movements.find(entry => entry.id === item.id)!,
    }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name))
  const totalValue = rows.reduce((s, r) => s + r.s.value, 0)
  const canTotalQuantities = new Set(rows.map(row => row.item.unit.toLowerCase())).size <= 1
  const movementTotals = rows.reduce((totals, row) => ({
    openingQty: totals.openingQty + row.movement.opening_qty,
    openingValue: totals.openingValue + row.movement.opening_value,
    inwardQty: totals.inwardQty + row.movement.inward_qty,
    inwardValue: totals.inwardValue + row.movement.inward_value,
    outwardQty: totals.outwardQty + row.movement.outward_qty,
    outwardValue: totals.outwardValue + row.movement.outward_value,
    closingQty: totals.closingQty + row.movement.closing_qty,
    closingValue: totals.closingValue + row.movement.closing_value,
  }), { openingQty: 0, openingValue: 0, inwardQty: 0, inwardValue: 0, outwardQty: 0, outwardValue: 0, closingQty: 0, closingValue: 0 })

  return (
    <div>
      <PageHeader title="Stock Summary" description={showDetails ? 'Opening, inward, outward and closing stock at weighted-average cost' : 'Current quantities at weighted-average cost'} />
      <PageContent className="space-y-3">
        <div className="flex flex-wrap justify-end gap-2">
          <div className="relative min-w-0 flex-1 sm:flex-none"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search stock…" className="w-full pl-8 sm:w-64" /></div>
          <Button size="sm" variant={showDetails ? 'default' : 'outline'} onClick={() => setShowDetails(value => !value)}>
            {showDetails ? 'Hide Details' : 'Show Details'}
          </Button>
        </div>
        <Card>
          {rows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-3xl mb-3 opacity-30">▣</p>
              <p className="font-medium text-foreground">{search ? 'No matching stock items' : 'No items yet'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {!showDetails ? <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Item</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Qty</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unit</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg Cost</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, s }) => (
                    <tr key={item.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{item.name}</td>
                      <td className="px-4 py-2.5 text-right num font-semibold">{formatStockQuantity(s.qty, item)}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{item.unit}</td>
                      <td className="px-4 py-2.5 text-right num">{fmtMoney(s.avg_cost)}</td>
                      <td className="px-4 py-2.5 text-right num font-semibold">{fmtMoney(s.value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="px-4 py-2.5" colSpan={4}>Total Stock Value</td>
                    <td className="px-4 py-2.5 text-right num">{fmtMoney(totalValue)}</td>
                  </tr>
                </tfoot>
              </table> : <table className="w-full min-w-[900px] text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th rowSpan={2} className="border-r border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Item</th>
                    {['Opening', 'Inward', 'Outward', 'Closing'].map(label => <th key={label} colSpan={2} className="border-r border-border px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</th>)}
                  </tr>
                  <tr className="bg-muted/30 border-b border-border">
                    {['opening', 'inward', 'outward', 'closing'].flatMap(group => [
                      <th key={`${group}-qty`} className="border-r border-border px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Qty</th>,
                      <th key={`${group}-value`} className="border-r border-border px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Value</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, movement }) => <tr key={item.id} className="border-b border-border hover:bg-muted/20">
                    <td className="border-r border-border px-4 py-2.5 font-medium">{item.name}<span className="ml-1.5 text-xs font-normal text-muted-foreground">({item.unit})</span></td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{movement.opening_qty}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{fmtMoney(movement.opening_value)}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{movement.inward_qty}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{fmtMoney(movement.inward_value)}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{movement.outward_qty}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{fmtMoney(movement.outward_value)}</td>
                    <td className={`border-r border-border px-3 py-2.5 text-right num font-semibold ${movement.closing_qty < 0 ? 'text-destructive' : ''}`}>{movement.closing_qty}{item.alternate_unit && <span className="block text-[10px] font-normal text-muted-foreground">{formatStockQuantity(movement.closing_qty, item)}</span>}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num font-semibold">{fmtMoney(movement.closing_value)}</td>
                  </tr>)}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="border-r border-border px-4 py-2.5 text-center">Total</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{canTotalQuantities ? movementTotals.openingQty : '—'}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{fmtMoney(movementTotals.openingValue)}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{canTotalQuantities ? movementTotals.inwardQty : '—'}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{fmtMoney(movementTotals.inwardValue)}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{canTotalQuantities ? movementTotals.outwardQty : '—'}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{fmtMoney(movementTotals.outwardValue)}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{canTotalQuantities ? movementTotals.closingQty : '—'}</td>
                    <td className="border-r border-border px-3 py-2.5 text-right num">{fmtMoney(movementTotals.closingValue)}</td>
                  </tr>
                </tfoot>
              </table>}
            </div>
          )}
        </Card>
      </PageContent>
    </div>
  )
}
