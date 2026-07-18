// ─── Shared report helpers ────────────────────────────────────────────────────
import { Fragment, useEffect, useState, useMemo, type ReactNode } from 'react'
import { AlertTriangle, Boxes, ChevronDown, ChevronRight, Layers3, Search, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { computeTrialBalance, computeProfitAndLoss, computeBalanceSheet, computeStockConditionSummary, computeVatReport, computeStockSummary, normalSide, recomputeAllBalances, recomputeFiscalTrialAccounts, recomputeStock, round2 } from '@/lib/engine'
import { buildAccountReportTree, computeDetailedProfitLoss, fiscalYearStartBs, groupReportAccounts, saveSelectedFiscalYear, selectedFiscalYearEndBs, selectedFiscalYearStartBs, type AccountReportTreeNode } from '@/lib/reports'
import { dashboardFiscalYearOptions, dashboardFiscalYearRange, dashboardVouchersInRange, dashboardVouchersThrough, isPostedDashboardVoucher } from '@/lib/dashboard'
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
import { FormalReportPrintFooter, FormalReportPrintHeader } from '@/components/reports/FormalReportPrint'
import { ReportDateFilters, type ReportRange } from '@/components/reports/ReportDateFilters'
import { ExpandCollapseControls } from '@/components/ExpandCollapseControls'
import { Badge } from '@/components/ui/misc'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { normalizeSearch } from '@/lib/search'
import { categoryDescendantIds, categoryOptionLabel, categoryPath } from '@/lib/categoryHierarchy'
import type { Account, AccountType, InventoryValuationMethod, Item, StockCondition, StockEntry } from '@/types'

// ─── Trial Balance ────────────────────────────────────────────────────────────
function LedgerLink({ account }: { account: Account }) {
  const navigate = useNavigate()
  return account.company_id ? <button type="button" onClick={() => navigate(`/reports/ledger?account=${encodeURIComponent(account.id)}`)} className="max-w-full truncate text-left text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{account.name}</button> : <span>{account.name}</span>
}

function useExpandedGroups() {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  return { expanded, setExpanded, toggle }
}

const reportTreeKeys = (nodes: AccountReportTreeNode[]): string[] => nodes.flatMap(node => [node.key, ...reportTreeKeys(node.children)])
type ExpansionCommand = { version: number; expand: boolean }

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

interface TrialPeriodValues {
  opening: number
  debit: number
  credit: number
  closing: number
}

const TRIAL_TYPE_ORDER: AccountType[] = ['Equity', 'Liability', 'Asset', 'Income', 'Expense']

function signedDebitBalance(account: Account) {
  const balance = account.balance || 0
  return round2(normalSide(account.type) === 'debit' ? balance : -balance)
}

function trialBalanceLabel(value: number) {
  if (Math.abs(value) < 0.005) return '—'
  return `${fmtMoney(Math.abs(value))} ${value > 0 ? 'Dr' : 'Cr'}`
}

function trialNodeValues(node: AccountReportTreeNode, values: Map<string, TrialPeriodValues>): TrialPeriodValues {
  const rows = [...node.directAccounts.map(account => values.get(account.id)), ...node.children.map(child => trialNodeValues(child, values))].filter((row): row is TrialPeriodValues => !!row)
  return rows.reduce((total, row) => ({ opening: round2(total.opening + row.opening), debit: round2(total.debit + row.debit), credit: round2(total.credit + row.credit), closing: round2(total.closing + row.closing) }), { opening: 0, debit: 0, credit: 0, closing: 0 })
}

function TrialNodeRows({ node, values, expanded, toggle }: { node: AccountReportTreeNode; values: Map<string, TrialPeriodValues>; expanded: Set<string>; toggle: (key: string) => void }) {
  const open = expanded.has(node.key)
  const totals = trialNodeValues(node, values)
  return <Fragment><tr className="border-t bg-muted/10 font-semibold hover:bg-muted/30"><td className="report-td" style={{ paddingLeft: `${0.75 + (node.depth - 1) * 1.25}rem` }}><GroupButton groupKey={node.key} name={node.name} count={node.totalCount} type={node.type} expanded={open} toggle={toggle} /></td><td className="report-td whitespace-nowrap text-right num">{trialBalanceLabel(totals.opening)}</td><td className="report-td text-right num debit-amt">{totals.debit ? fmtMoney(totals.debit) : '—'}</td><td className="report-td text-right num credit-amt">{totals.credit ? fmtMoney(totals.credit) : '—'}</td><td className="report-td whitespace-nowrap text-right num">{trialBalanceLabel(totals.closing)}</td></tr>{open && node.directAccounts.map(account => { const row = values.get(account.id)!; return <tr key={account.id} className="border-t hover:bg-muted/20"><td className="report-td" style={{ paddingLeft: `${2.5 + (node.depth - 1) * 1.25}rem` }}><LedgerLink account={account} /></td><td className="report-td whitespace-nowrap text-right num">{trialBalanceLabel(row.opening)}</td><td className="report-td text-right num">{row.debit ? fmtMoney(row.debit) : '—'}</td><td className="report-td text-right num">{row.credit ? fmtMoney(row.credit) : '—'}</td><td className="report-td whitespace-nowrap text-right num">{trialBalanceLabel(row.closing)}</td></tr>})}{open && node.children.map(child => <TrialNodeRows key={child.key} node={child} values={values} expanded={expanded} toggle={toggle} />)}</Fragment>
}

function HierarchicalTrialTable({ accounts, categories, values, openingDebit, openingCredit, movementDebit, movementCredit, closingDebit, closingCredit }: { accounts: Account[]; categories: import('@/types').AccountCategory[]; values: Map<string, TrialPeriodValues>; openingDebit: number; openingCredit: number; movementDebit: number; movementCredit: number; closingDebit: number; closingCredit: number }) {
  const nodes = useMemo(() => buildAccountReportTree(accounts, categories).sort((left, right) => TRIAL_TYPE_ORDER.indexOf(left.type) - TRIAL_TYPE_ORDER.indexOf(right.type) || left.name.localeCompare(right.name)), [accounts, categories])
  const { expanded, setExpanded, toggle } = useExpandedGroups()
  const expandableKeys = reportTreeKeys(nodes)
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every(key => expanded.has(key))
  return <><ExpandCollapseControls className="border-b px-2 py-1" expanded={allExpanded} onToggle={() => setExpanded(allExpanded ? new Set() : new Set(expandableKeys))} /><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/50"><tr><th rowSpan={2} className="report-th text-left align-middle">Category / Ledger</th><th rowSpan={2} className="report-th text-right align-middle">Opening Balance</th><th colSpan={2} className="report-th border-b text-center">Current Transactions</th><th rowSpan={2} className="report-th text-right align-middle">Closing Balance</th></tr><tr><th className="report-th text-right">Debit</th><th className="report-th text-right">Credit</th></tr></thead><tbody>{nodes.map(node => <TrialNodeRows key={node.key} node={node} values={values} expanded={expanded} toggle={toggle} />)}</tbody><tfoot><tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td">Total</td><td className="report-td text-right num"><span className="block">{fmtMoney(openingDebit)} Dr</span><span className="block">{fmtMoney(openingCredit)} Cr</span></td><td className="report-td text-right num">{fmtMoney(movementDebit)}</td><td className="report-td text-right num">{fmtMoney(movementCredit)}</td><td className="report-td text-right num"><span className="block">{fmtMoney(closingDebit)} Dr</span><span className="block">{fmtMoney(closingCredit)} Cr</span></td></tr></tfoot></table></div></>
}

function TrialBalancePrintNodeRows({ node, values, depth = 0 }: { node: AccountReportTreeNode; values: Map<string, TrialPeriodValues>; depth?: number }) {
  const totals = trialNodeValues(node, values)
  return <Fragment>
    <tr className="trial-balance-print-group">
      <td style={{ paddingLeft: `${depth * 12}px` }}>{node.name}</td><td>{trialBalanceLabel(totals.opening)}</td><td>{totals.debit ? fmtMoney(totals.debit) : ''}</td><td>{totals.credit ? fmtMoney(totals.credit) : ''}</td><td>{trialBalanceLabel(totals.closing)}</td>
    </tr>
    {node.directAccounts.map(account => {
      const row = values.get(account.id)!
      return <tr key={account.id} className="trial-balance-print-ledger"><td style={{ paddingLeft: `${(depth + 1) * 12}px` }}>{account.name}</td><td>{trialBalanceLabel(row.opening)}</td><td>{row.debit ? fmtMoney(row.debit) : ''}</td><td>{row.credit ? fmtMoney(row.credit) : ''}</td><td>{trialBalanceLabel(row.closing)}</td></tr>
    })}
    {node.children.map(child => <TrialBalancePrintNodeRows key={child.key} node={child} values={values} depth={depth + 1} />)}
  </Fragment>
}

function TrialBalancePrintTable({ accounts, categories, values, movementDebit, movementCredit }: { accounts: Account[]; categories: import('@/types').AccountCategory[]; values: Map<string, TrialPeriodValues>; movementDebit: number; movementCredit: number }) {
  const nodes = buildAccountReportTree(accounts, categories)
    .sort((left, right) => TRIAL_TYPE_ORDER.indexOf(left.type) - TRIAL_TYPE_ORDER.indexOf(right.type) || left.name.localeCompare(right.name))
    .flatMap(node => /^(assets?|liabilit(?:y|ies)|equity|incomes?|expenses?)$/i.test(node.name) && !node.directAccounts.length ? node.children : [node])
  return <table className="trial-balance-print-table">
    <colgroup><col className="trial-balance-print-particulars" /><col /><col /><col /><col /></colgroup>
    <thead><tr><th rowSpan={2}>Particulars</th><th rowSpan={2}>Opening<br />Balance</th><th colSpan={2}>Transactions</th><th rowSpan={2}>Closing<br />Balance</th></tr><tr><th>Debit</th><th>Credit</th></tr></thead>
    <tbody>{nodes.map(node => <TrialBalancePrintNodeRows key={node.key} node={node} values={values} />)}</tbody>
    <tfoot><tr><td>Grand Total</td><td /><td>{fmtMoney(movementDebit)}</td><td>{fmtMoney(movementCredit)}</td><td /></tr></tfoot>
  </table>
}

function AmountNodeRows({ node, expanded, toggle }: { node: AccountReportTreeNode; expanded: Set<string>; toggle: (key: string) => void }) {
  const open = expanded.has(node.key)
  return <Fragment><tr className="border-t bg-muted/10 font-semibold hover:bg-muted/30"><td className="report-td" style={{ paddingLeft: `${0.75 + (node.depth - 1) * 1.25}rem` }}><GroupButton groupKey={node.key} name={node.name} count={node.totalCount} expanded={open} toggle={toggle} /></td><td className="report-td text-right num">{fmtMoney(node.balance)}</td></tr>{open && node.directAccounts.map(account => {
    const closingStock = account.id === 'balance-sheet:closing-stock'
    return <tr key={account.id} className={`border-t ${closingStock ? 'bg-amber-50/70' : 'hover:bg-muted/20'}`}><td className="report-td" style={{ paddingLeft: `${2.5 + (node.depth - 1) * 1.25}rem` }}>{closingStock ? <span className="font-medium">Closing Stock <span className="ml-1 text-xs font-normal text-muted-foreground">Calculated</span></span> : <LedgerLink account={account} />}</td><td className="report-td text-right num">{fmtMoney(account.balance)}</td></tr>
  })}{open && node.children.map(child => <AmountNodeRows key={child.key} node={child} expanded={expanded} toggle={toggle} />)}</Fragment>
}

function BalanceSheetAccountRows({ accounts, categories, emptyLabel, command }: { accounts: Account[]; categories: import('@/types').AccountCategory[]; emptyLabel: string; command: ExpansionCommand }) {
  const nodes = useMemo(() => buildAccountReportTree(accounts, categories), [accounts, categories])
  const { expanded, setExpanded, toggle } = useExpandedGroups()
  useEffect(() => { if (command.version) setExpanded(command.expand ? new Set(reportTreeKeys(nodes)) : new Set()) }, [command, nodes, setExpanded])
  if (!nodes.length) return <tr className="border-t"><td colSpan={2} className="px-4 py-6 text-sm text-muted-foreground">{emptyLabel}</td></tr>
  return <>{nodes.map(node => <AmountNodeRows key={node.key} node={node} expanded={expanded} toggle={toggle} />)}</>
}

function BalanceSheetProfitLossRows({ amount, command }: { amount: number; command: ExpansionCommand }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (command.version) setOpen(command.expand) }, [command])
  return <Fragment>
    <tr className="border-t bg-muted/10 font-semibold hover:bg-muted/30">
      <td className="report-td"><button type="button" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} Profit & Loss A/c`} onClick={() => setOpen(value => !value)} className="flex max-w-full items-center gap-2 text-left"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-muted">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span><span>Profit &amp; Loss A/c</span><span className="text-xs font-normal text-muted-foreground">1</span></button></td>
      <td className={`report-td whitespace-nowrap text-right font-semibold num ${amount < 0 ? 'text-destructive' : ''}`}>{fmtMoney(amount)}</td>
    </tr>
    {open && <tr className="border-t bg-muted/5"><td className="report-td pl-12 italic">Current Period</td><td className={`report-td whitespace-nowrap text-right num ${amount < 0 ? 'text-destructive' : ''}`}>{fmtMoney(amount)}</td></tr>}
  </Fragment>
}

function BalanceSheetStatementSide({ title, total, children, className = '' }: { title: string; total: number; children: ReactNode; className?: string }) {
  return <section className={`flex min-w-0 flex-col ${className}`}>
    <table className="w-full table-fixed text-sm">
      <colgroup><col /><col className="w-[9.5rem]" /></colgroup>
      <thead><tr className="border-b bg-[#f4f0e5]"><th className="report-th text-left uppercase tracking-[0.2em] text-[#675c49]">{title}</th><th className="report-th text-right">Amount</th></tr></thead>
      <tbody>{children}</tbody>
    </table>
    <div aria-hidden="true" className="min-h-20 flex-1 border-t bg-card" />
    <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] border-t-2 bg-[#1B2A4A] font-semibold text-white">
      <span className="px-4 py-3">Grand Total</span>
      <span className="whitespace-nowrap px-4 py-3 text-right num">{fmtMoney(total)}</span>
    </div>
  </section>
}

function BalanceSheetPrintNodeRows({ node, depth = 0 }: { node: AccountReportTreeNode; depth?: number }) {
  return <Fragment>
    <tr className="balance-sheet-print-group"><td style={{ paddingLeft: `${depth * 12}px` }}>{node.name}</td><td>{fmtMoney(node.balance)}</td></tr>
    {node.directAccounts.map(account => <tr key={account.id} className="balance-sheet-print-ledger"><td style={{ paddingLeft: `${(depth + 1) * 12}px` }}>{account.name}</td><td>{fmtMoney(account.balance)}</td></tr>)}
    {node.children.map(child => <BalanceSheetPrintNodeRows key={child.key} node={child} depth={depth + 1} />)}
  </Fragment>
}

function BalanceSheetPrintSide({ title, asOf, accounts, categories, total, profitLoss }: { title: string; asOf: string; accounts: Account[]; categories: import('@/types').AccountCategory[]; total: number; profitLoss?: number }) {
  const roots = buildAccountReportTree(accounts, categories).flatMap(node => /^(assets?|liabilit(?:y|ies)|equity)$/i.test(node.name) && !node.directAccounts.length ? node.children : [node])
  return <section className="balance-sheet-print-side">
    <div className="balance-sheet-print-side-title"><strong>{title}</strong><span>as at {fmtDate(asOf)}</span></div>
    <table><tbody>{roots.map(node => <BalanceSheetPrintNodeRows key={node.key} node={node} />)}{profitLoss !== undefined && <><tr className="balance-sheet-print-group"><td>Profit &amp; Loss A/c</td><td>{fmtMoney(profitLoss)}</td></tr><tr className="balance-sheet-print-ledger"><td style={{ paddingLeft: '12px' }}>Current Period</td><td>{fmtMoney(profitLoss)}</td></tr></>}</tbody></table>
    <div className="balance-sheet-print-spacer" />
    <div className="balance-sheet-print-total"><strong>Total</strong><b>{fmtMoney(total)}</b></div>
  </section>
}

function ProfitLossPrintAccountRows({ accounts, categories }: { accounts: Account[]; categories: import('@/types').AccountCategory[] }) {
  const roots = buildAccountReportTree(accounts, categories).flatMap(node => /^(incomes?|expenses?)$/i.test(node.name) && !node.directAccounts.length ? node.children : [node])
  return <>{roots.map(node => <BalanceSheetPrintNodeRows key={node.key} node={node} />)}</>
}

function ProfitLossPrintStockRows({ label, entries, items }: { label: string; entries: StockEntry[]; items: Item[] }) {
  const visible = entries.filter(entry => Math.abs(entry.qty) >= 0.00005 || Math.abs(entry.value) >= 0.005)
  const total = visible.reduce((sum, entry) => sum + entry.value, 0)
  return <Fragment>
    <tr className="balance-sheet-print-group"><td>{label}</td><td>{fmtMoney(total)}</td></tr>
    {visible.map(entry => {
      const item = items.find(candidate => candidate.id === entry.id)
      return <tr key={entry.id} className="balance-sheet-print-ledger"><td style={{ paddingLeft: '12px' }}>{item?.name || entry.name}</td><td>{fmtMoney(entry.value)}</td></tr>
    })}
  </Fragment>
}

function ProfitLossPrintResultRow({ label, amount }: { label: string; amount: number }) {
  return <tr className="profit-loss-print-result"><td>{label}</td><td>{fmtMoney(Math.abs(amount))}</td></tr>
}

function ProfitLossPrintSection({ total, children, showSubtotal = true }: { total: number; children: ReactNode; showSubtotal?: boolean }) {
  return <section className="profit-loss-print-section">
    <table><tbody>{children}</tbody></table>
    <div className="profit-loss-print-spacer" />
    {showSubtotal && <div className="profit-loss-print-subtotal"><span /><b>{fmtMoney(total)}</b></div>}
  </section>
}

function ProfitLossNodeRows({ node, depth, expanded, toggle }: { node: AccountReportTreeNode; depth: number; expanded: Set<string>; toggle: (key: string) => void }) {
  const open = expanded.has(node.key)
  return <Fragment>
    <tr className="border-t bg-muted/10 font-semibold hover:bg-muted/25">
      <td className="report-td" style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}><GroupButton groupKey={node.key} name={node.name} count={node.totalCount} expanded={open} toggle={toggle} /></td>
      <td className="report-td whitespace-nowrap text-right num">{fmtMoney(node.balance)}</td>
    </tr>
    {open && node.directAccounts.map(account => <tr key={account.id} className="border-t hover:bg-muted/20"><td className="report-td" style={{ paddingLeft: `${2.75 + depth * 1.1}rem` }}><LedgerLink account={account} /></td><td className="report-td whitespace-nowrap text-right num">{fmtMoney(account.balance || 0)}</td></tr>)}
    {open && node.children.map(child => <ProfitLossNodeRows key={child.key} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} />)}
  </Fragment>
}

function ProfitLossAccountRows({ accounts, categories, command }: { accounts: Account[]; categories: import('@/types').AccountCategory[]; command: ExpansionCommand }) {
  const nodes = useMemo(() => {
    const roots = buildAccountReportTree(accounts, categories)
    return roots.flatMap(node => /^(income|incomes|expense|expenses)$/i.test(node.name) && !node.directAccounts.length ? node.children : [node])
  }, [accounts, categories])
  const { expanded, setExpanded, toggle } = useExpandedGroups()
  useEffect(() => { if (command.version) setExpanded(command.expand ? new Set(reportTreeKeys(nodes)) : new Set()) }, [command, nodes, setExpanded])
  return <>{nodes.map(node => <ProfitLossNodeRows key={node.key} node={node} depth={0} expanded={expanded} toggle={toggle} />)}</>
}

function ProfitLossStockRows({ label, entries, items, command }: { label: string; entries: StockEntry[]; items: Item[]; command: ExpansionCommand }) {
  const [open, setOpen] = useState(false)
  const itemMap = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
  const visible = entries.filter(entry => Math.abs(entry.qty) >= 0.00005 || Math.abs(entry.value) >= 0.005)
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  useEffect(() => { if (command.version) setOpen(command.expand && visible.length > 0) }, [command, visible.length])
  return <Fragment>
    <tr className="border-t bg-amber-50/70 font-semibold hover:bg-amber-50">
      <td className="report-td"><button type="button" disabled={!visible.length} aria-expanded={visible.length ? open : undefined} aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} onClick={() => setOpen(value => !value)} className="flex max-w-full items-center gap-2 text-left disabled:cursor-default"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-amber-100">{visible.length ? open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : null}</span><span>{label}</span><span className="text-xs font-normal text-muted-foreground">{visible.length} item{visible.length === 1 ? '' : 's'}</span></button></td>
      <td className="report-td whitespace-nowrap text-right font-semibold num">{fmtMoney(total)}</td>
    </tr>
    {open && visible.map(entry => {
      const item = itemMap.get(entry.id)
      return <tr key={`${label}-${entry.id}`} className="border-t hover:bg-muted/20"><td className="report-td pl-12"><span className="font-medium">{item?.name || entry.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item ? formatStockQuantity(entry.qty, item) : `${entry.qty} ${entry.unit}`} @ {fmtMoney(entry.avg_cost)}</span></td><td className="report-td whitespace-nowrap text-right num">{fmtMoney(entry.value)}</td></tr>
    })}
  </Fragment>
}

function ProfitLossSectionRow({ label }: { label: string }) {
  return <tr className="border-y bg-[#f4f0e5]"><td colSpan={2} className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#675c49]">{label}</td></tr>
}

function ProfitLossResultRow({ label, amount, tone = 'default' }: { label: string; amount: number; tone?: 'default' | 'profit' | 'loss' }) {
  const toneClass = tone === 'profit' ? 'text-forest' : tone === 'loss' ? 'text-destructive' : ''
  return <tr className={`border-t font-semibold ${toneClass}`}><td className="report-td italic">{label}</td><td className="report-td whitespace-nowrap text-right num">{fmtMoney(Math.abs(amount))}</td></tr>
}

function ProfitLossSubtotalRow({ label, amount }: { label: string; amount: number }) {
  return <tr className="border-y-2 bg-muted/25 font-semibold"><td className="report-td">{label}</td><td className="report-td whitespace-nowrap text-right num">{fmtMoney(amount)}</td></tr>
}

function ProfitLossStatementSection({ label, totalLabel, totalAmount, children, showHeader = false, className = '' }: { label: string; totalLabel: string; totalAmount: number; children: ReactNode; showHeader?: boolean; className?: string }) {
  return <section className={`flex min-w-0 flex-col ${className}`}>
    <table className="w-full table-fixed text-sm">
      <colgroup><col /><col className="w-[9.5rem]" /></colgroup>
      {showHeader && <thead><tr className="border-b"><th className="report-th text-left">Particulars</th><th className="report-th text-right">Amount</th></tr></thead>}
      <tbody><ProfitLossSectionRow label={label} />{children}</tbody>
    </table>
    <div aria-hidden="true" className="min-h-10 flex-1 border-t bg-card" />
    <table className="w-full table-fixed text-sm">
      <colgroup><col /><col className="w-[9.5rem]" /></colgroup>
      <tbody><ProfitLossSubtotalRow label={totalLabel} amount={totalAmount} /></tbody>
    </table>
  </section>
}

function ProfitLossGrandTotal({ amount, className = '' }: { amount: number; className?: string }) {
  return <div className={`grid grid-cols-[minmax(0,1fr)_9.5rem] border-t-2 bg-[#1B2A4A] font-semibold text-white ${className}`}>
    <span className="px-4 py-3">Grand Total</span>
    <span className="whitespace-nowrap px-4 py-3 text-right num">{fmtMoney(amount)}</span>
  </div>
}

export function TrialBalancePage() {
  const { company, rawAccounts, accountCategories, items, vouchers } = useAppStore()
  const fiscalStart = selectedFiscalYearStartBs(company)
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(fiscalStart)
  const [to, setTo] = useState(() => selectedFiscalYearEndBs(company))
  useEffect(() => { if (range === 'fiscal') { setFrom(fiscalStart); setTo(selectedFiscalYearEndBs(company)) } }, [company, fiscalStart, range])
  const postedVouchers = useMemo(() => vouchers.filter(isPostedDashboardVoucher), [vouchers])
  const reportFiscalStart = useMemo(() => {
    const monthDay = fiscalStart.slice(5)
    const fromYear = Number(from.slice(0, 4))
    return `${from.slice(5) >= monthDay ? fromYear : fromYear - 1}-${monthDay}`
  }, [fiscalStart, from])
  const retainedCategoryId = accountCategories.find(category => category.account_type === 'Equity' && category.name === 'Reserves & Surplus')?.id
  const currentAssetsCategoryId = accountCategories.find(category => category.account_type === 'Asset' && category.name === 'Current Assets')?.id
  const valuationMethod = company?.inventory_valuation_method || 'weighted_average'
  const beforeFrom = useMemo(() => dashboardVouchersThrough(postedVouchers, from, false), [postedVouchers, from])
  const periodVouchers = useMemo(() => dashboardVouchersInRange(postedVouchers, from, to), [postedVouchers, from, to])
  const throughTo = useMemo(() => dashboardVouchersThrough(postedVouchers, to), [postedVouchers, to])
  const openingAccounts = useMemo(() => recomputeFiscalTrialAccounts(rawAccounts, beforeFrom, reportFiscalStart, company?.id || '', retainedCategoryId, items, valuationMethod, currentAssetsCategoryId), [rawAccounts, beforeFrom, reportFiscalStart, company?.id, retainedCategoryId, items, valuationMethod, currentAssetsCategoryId])
  const closingAccounts = useMemo(() => recomputeFiscalTrialAccounts(rawAccounts, throughTo, reportFiscalStart, company?.id || '', retainedCategoryId, items, valuationMethod, currentAssetsCategoryId), [rawAccounts, throughTo, reportFiscalStart, company?.id, retainedCategoryId, items, valuationMethod, currentAssetsCategoryId])
  const movements = useMemo(() => {
    const byAccount = new Map<string, { debit: number; credit: number }>()
    for (const voucher of periodVouchers) for (const line of voucher.lines || []) {
      const row = byAccount.get(line.account_id) || { debit: 0, credit: 0 }
      row.debit = round2(row.debit + (line.debit || 0))
      row.credit = round2(row.credit + (line.credit || 0))
      byAccount.set(line.account_id, row)
    }
    return byAccount
  }, [periodVouchers])
  const openingById = useMemo(() => new Map(openingAccounts.map(account => [account.id, account])), [openingAccounts])
  const values = useMemo(() => new Map(closingAccounts.map(account => {
    const openingAccount = openingById.get(account.id) || account
    const movement = movements.get(account.id) || { debit: 0, credit: 0 }
    return [account.id, { opening: signedDebitBalance(openingAccount), debit: movement.debit, credit: movement.credit, closing: signedDebitBalance(account) } satisfies TrialPeriodValues]
  })), [closingAccounts, movements, openingById])
  const visibleAccounts = useMemo(() => closingAccounts.filter(account => { const row = values.get(account.id)!; return Math.abs(row.opening) >= 0.005 || row.debit >= 0.005 || row.credit >= 0.005 || Math.abs(row.closing) >= 0.005 }), [closingAccounts, values])
  const openingTb = useMemo(() => computeTrialBalance(openingAccounts), [openingAccounts])
  const closingTb = useMemo(() => computeTrialBalance(closingAccounts), [closingAccounts])
  const movementDebit = round2([...movements.values()].reduce((sum, row) => sum + row.debit, 0))
  const movementCredit = round2([...movements.values()].reduce((sum, row) => sum + row.credit, 0))
  const exportCsv = () => downloadCsv(`trial-balance-${from}-to-${to}.csv`, ['Ledger', 'Category', 'Opening Balance', 'Debit', 'Credit', 'Closing Balance'], [...visibleAccounts].sort((left, right) => TRIAL_TYPE_ORDER.indexOf(left.type) - TRIAL_TYPE_ORDER.indexOf(right.type) || left.name.localeCompare(right.name)).map(account => {
    const row = values.get(account.id)!
    return [account.name, categoryPath(accountCategories, account.category_id), trialBalanceLabel(row.opening), row.debit || '', row.credit || '', trialBalanceLabel(row.closing)]
  }))

  return (
    <div className="report-page trial-balance-report-page">
      <PageHeader title="Trial Balance" description="Opening balances, period movements, and closing balances" action={<ReportActions onExport={exportCsv} />} />
      <PageContent className="report-content space-y-4">
        <FormalReportPrintHeader company={company} title="Trial Balance" periodLabel={`${fmtDate(from)} to ${fmtDate(to)}`} />
        <Card className="report-controls"><CardContent className="p-4"><ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} /></CardContent></Card>
        <div className="trial-balance-simple-print hidden" aria-hidden="true">
          <header className="balance-sheet-print-heading">
            <h1>{company?.name || 'Our Company'}</h1>
            {company?.address && <p>{company.address}</p>}
            <h2>Trial Balance</h2>
            <p>{from === to ? `For ${fmtDate(to)}` : `For ${fmtDate(from)} to ${fmtDate(to)}`}</p>
          </header>
          <TrialBalancePrintTable accounts={visibleAccounts} categories={accountCategories} values={values} movementDebit={movementDebit} movementCredit={movementCredit} />
        </div>
        <Card className="trial-balance-screen-statement report-table-card">
          <HierarchicalTrialTable accounts={visibleAccounts} categories={accountCategories} values={values} openingDebit={openingTb.total_debit} openingCredit={openingTb.total_credit} movementDebit={movementDebit} movementCredit={movementCredit} closingDebit={closingTb.total_debit} closingCredit={closingTb.total_credit} />
          {closingTb.balanced
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
  const { company, rawAccounts, accountCategories, items, vouchers } = useAppStore()
  const fiscalStart = selectedFiscalYearStartBs(company)
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(fiscalStart)
  const [to, setTo] = useState(() => selectedFiscalYearEndBs(company))
  const [expansionCommand, setExpansionCommand] = useState<ExpansionCommand>({ version: 0, expand: false })
  useEffect(() => { if (range === 'fiscal') { setFrom(fiscalStart); setTo(selectedFiscalYearEndBs(company)) } }, [company, fiscalStart, range])
  const postedVouchers = useMemo(() => vouchers.filter(isPostedDashboardVoucher), [vouchers])
  const periodVouchers = useMemo(() => dashboardVouchersInRange(postedVouchers, from, to), [postedVouchers, from, to])
  const beforeFrom = useMemo(() => dashboardVouchersThrough(postedVouchers, from, false), [postedVouchers, from])
  const throughTo = useMemo(() => dashboardVouchersThrough(postedVouchers, to), [postedVouchers, to])
  const periodAccounts = useMemo(() => recomputeAllBalances(rawAccounts.map(account => ({ ...account, opening_balance: 0, balance: 0 })), periodVouchers), [rawAccounts, periodVouchers])
  const valuationMethod = company?.inventory_valuation_method || 'weighted_average'
  const openingStock = useMemo(() => recomputeStock(items, beforeFrom, valuationMethod), [items, beforeFrom, valuationMethod])
  const closingStock = useMemo(() => recomputeStock(items, throughTo, valuationMethod), [items, throughTo, valuationMethod])
  const statement = useMemo(() => computeDetailedProfitLoss(company?.id || '', periodAccounts, accountCategories, openingStock, closingStock), [company?.id, periodAccounts, accountCategories, openingStock, closingStock])
  const exportCsv = () => {
    const accountRows = (section: string, accounts: Account[]) => accounts.map(account => [section, account.name, categoryPath(accountCategories, account.category_id), account.balance || 0])
    const stockRows = (section: string, entries: StockEntry[]) => entries.filter(entry => Math.abs(entry.qty) >= 0.00005 || Math.abs(entry.value) >= 0.005).map(entry => {
      const item = items.find(candidate => candidate.id === entry.id)
      return [section, item?.name || entry.name, item ? `${formatStockQuantity(entry.qty, item)} @ ${fmtMoney(entry.avg_cost)}` : `${entry.qty} ${entry.unit}`, entry.value]
    })
    downloadCsv(`profit-and-loss-${from}-to-${to}.csv`, ['Section', 'Ledger / Item', 'Category / Quantity', 'Amount'], [
      ['Trading - Debit', 'Opening Stock', '', statement.openingStockValue],
      ...stockRows('Opening Stock Detail', statement.openingStock),
      ...accountRows('Direct Expense', statement.directExpenses),
      ...(statement.grossProfit >= 0 ? [['Trading - Debit', 'Gross Profit c/o', '', statement.grossProfit]] : []),
      ...accountRows('Direct Income', statement.directIncome),
      ['Trading - Credit', 'Closing Stock', '', statement.closingStockValue],
      ...stockRows('Closing Stock Detail', statement.closingStock),
      ...(statement.grossProfit < 0 ? [['Trading - Credit', 'Gross Loss c/o', '', Math.abs(statement.grossProfit)]] : []),
      ...(statement.grossProfit < 0 ? [['Profit & Loss - Debit', 'Gross Loss b/f', '', Math.abs(statement.grossProfit)]] : []),
      ...accountRows('Indirect Expense', statement.indirectExpenses),
      ...(statement.netProfit >= 0 ? [['Profit & Loss - Debit', 'Net Profit', '', statement.netProfit]] : []),
      ...(statement.grossProfit >= 0 ? [['Profit & Loss - Credit', 'Gross Profit b/f', '', statement.grossProfit]] : []),
      ...accountRows('Indirect Income', statement.indirectIncome),
      ...(statement.netProfit < 0 ? [['Profit & Loss - Credit', 'Net Loss', '', Math.abs(statement.netProfit)]] : []),
      ['', 'Grand Total', '', statement.debitTotal],
    ])
  }

  return (
    <div className="report-page profit-loss-report-page">
      <PageHeader title="Profit & Loss"
        description="Trading and profit statement with period opening and closing inventory" action={<ReportActions onExport={exportCsv} />} />
      <PageContent className="report-content space-y-4">
        <FormalReportPrintHeader company={company} title="Profit & Loss Statement" periodLabel={`${fmtDate(from)} to ${fmtDate(to)}`} detailLabel={valuationMethod.replace('_', ' ')} />
        <Card className="report-controls"><CardContent className="p-4"><ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} /></CardContent></Card>
        <div className="profit-loss-simple-print hidden" aria-hidden="true">
          <header className="balance-sheet-print-heading">
            <h1>{company?.name || 'Our Company'}</h1>
            {company?.address && <p>{company.address}</p>}
            <h2>Profit &amp; Loss Account</h2>
            <p>For {fmtDate(from)} to {fmtDate(to)}</p>
          </header>
          <div className="profit-loss-print-columns">
            <div className="balance-sheet-print-side-title"><strong>Particulars</strong><span>{from === to ? `For ${fmtDate(to)}` : `For ${fmtDate(from)} to ${fmtDate(to)}`}</span></div>
            <div className="balance-sheet-print-side-title"><strong>Particulars</strong><span>{from === to ? `For ${fmtDate(to)}` : `For ${fmtDate(from)} to ${fmtDate(to)}`}</span></div>
            <ProfitLossPrintSection total={statement.tradingTotal}>
              <ProfitLossPrintStockRows label="Opening Stock" entries={statement.openingStock} items={items} />
              <ProfitLossPrintAccountRows accounts={statement.directExpenses} categories={accountCategories} />
              {statement.grossProfit >= 0 && <ProfitLossPrintResultRow label="Gross Profit c/o" amount={statement.grossProfit} />}
            </ProfitLossPrintSection>
            <ProfitLossPrintSection total={statement.tradingTotal}>
              <ProfitLossPrintAccountRows accounts={statement.directIncome} categories={accountCategories} />
              <ProfitLossPrintStockRows label="Closing Stock" entries={statement.closingStock} items={items} />
              {statement.grossProfit < 0 && <ProfitLossPrintResultRow label="Gross Loss c/o" amount={statement.grossProfit} />}
            </ProfitLossPrintSection>
            <ProfitLossPrintSection total={statement.profitLossTotal} showSubtotal={false}>
              {statement.grossProfit < 0 && <ProfitLossPrintResultRow label="Gross Loss b/f" amount={statement.grossProfit} />}
              <ProfitLossPrintAccountRows accounts={statement.indirectExpenses} categories={accountCategories} />
              {statement.netProfit >= 0 && <ProfitLossPrintResultRow label="Net Profit" amount={statement.netProfit} />}
            </ProfitLossPrintSection>
            <ProfitLossPrintSection total={statement.profitLossTotal} showSubtotal={false}>
              {statement.grossProfit >= 0 && <ProfitLossPrintResultRow label="Gross Profit b/f" amount={statement.grossProfit} />}
              <ProfitLossPrintAccountRows accounts={statement.indirectIncome} categories={accountCategories} />
              {statement.netProfit < 0 && <ProfitLossPrintResultRow label="Net Loss" amount={statement.netProfit} />}
            </ProfitLossPrintSection>
            <div className="balance-sheet-print-total"><strong>Total</strong><b>{fmtMoney(statement.profitLossTotal)}</b></div>
            <div className="balance-sheet-print-total"><strong>Total</strong><b>{fmtMoney(statement.profitLossTotal)}</b></div>
          </div>
        </div>
        <Card className="profit-loss-screen-statement report-table-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2"><div className="min-w-0 flex-1 text-center"><p className="font-serif font-bold text-[#1B2A4A]">{company?.name || 'Our Company'}</p><p className="text-xs text-muted-foreground">For {fmtDate(from)} to {fmtDate(to)} · {valuationMethod.replace('_', ' ')}</p></div><ExpandCollapseControls expanded={expansionCommand.expand} onToggle={() => setExpansionCommand(current => ({ version: current.version + 1, expand: !current.expand }))} /></div>
          <div className="report-print-columns">
            <div className="grid grid-cols-1 items-stretch lg:grid-cols-2 print:grid-cols-2">
              <ProfitLossStatementSection label="Trading Account · Debit" totalLabel="Trading Total" totalAmount={statement.tradingTotal} showHeader>
                <ProfitLossStockRows label="Opening Stock" entries={statement.openingStock} items={items} command={expansionCommand} />
                <ProfitLossAccountRows accounts={statement.directExpenses} categories={accountCategories} command={expansionCommand} />
                {statement.grossProfit >= 0 && <ProfitLossResultRow label="Gross Profit c/o" amount={statement.grossProfit} tone="profit" />}
              </ProfitLossStatementSection>
              <ProfitLossStatementSection label="Trading Account · Credit" totalLabel="Trading Total" totalAmount={statement.tradingTotal} showHeader className="border-t lg:border-l lg:border-t-0 print:border-l print:border-t-0">
                <ProfitLossAccountRows accounts={statement.directIncome} categories={accountCategories} command={expansionCommand} />
                <ProfitLossStockRows label="Closing Stock" entries={statement.closingStock} items={items} command={expansionCommand} />
                {statement.grossProfit < 0 && <ProfitLossResultRow label="Gross Loss c/o" amount={statement.grossProfit} tone="loss" />}
              </ProfitLossStatementSection>
            </div>
            <div className="grid grid-cols-1 items-stretch lg:grid-cols-2 print:grid-cols-2">
              <ProfitLossStatementSection label="Profit & Loss Account · Debit" totalLabel="Profit & Loss Total" totalAmount={statement.profitLossTotal}>
                {statement.grossProfit < 0 && <ProfitLossResultRow label="Gross Loss b/f" amount={statement.grossProfit} tone="loss" />}
                <ProfitLossAccountRows accounts={statement.indirectExpenses} categories={accountCategories} command={expansionCommand} />
                {statement.netProfit >= 0 && <ProfitLossResultRow label="Net Profit" amount={statement.netProfit} tone="profit" />}
              </ProfitLossStatementSection>
              <ProfitLossStatementSection label="Profit & Loss Account · Credit" totalLabel="Profit & Loss Total" totalAmount={statement.profitLossTotal} className="border-t lg:border-l lg:border-t-0 print:border-l print:border-t-0">
                {statement.grossProfit >= 0 && <ProfitLossResultRow label="Gross Profit b/f" amount={statement.grossProfit} tone="profit" />}
                <ProfitLossAccountRows accounts={statement.indirectIncome} categories={accountCategories} command={expansionCommand} />
                {statement.netProfit < 0 && <ProfitLossResultRow label="Net Loss" amount={statement.netProfit} tone="loss" />}
              </ProfitLossStatementSection>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2">
              <ProfitLossGrandTotal amount={statement.debitTotal} />
              <ProfitLossGrandTotal amount={statement.creditTotal} className="lg:border-l print:border-l" />
            </div>
          </div>
        </Card>
      </PageContent>
    </div>
  )
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────
export function BalanceSheetPage() {
  const { company, rawAccounts, accountCategories, items, vouchers } = useAppStore()
  const currentFiscalStart = fiscalYearStartBs(company)
  const [selectedFiscalYear, setSelectedFiscalYear] = useState(() => Number(selectedFiscalYearStartBs(company).slice(0, 4)))
  const [asOf, setAsOf] = useState(() => selectedFiscalYearEndBs(company))
  const fiscalYearOptions = useMemo(() => dashboardFiscalYearOptions(vouchers, currentFiscalStart), [vouchers, currentFiscalStart])
  useEffect(() => {
    const year = Number(selectedFiscalYearStartBs(company).slice(0, 4))
    setSelectedFiscalYear(year)
    setAsOf(dashboardFiscalYearRange(year, currentFiscalStart).to)
  }, [company, currentFiscalStart])
  const fiscalStart = `${selectedFiscalYear}-${currentFiscalStart.slice(5)}`
  const changeFiscalYear = (value: string) => {
    const year = Number(value)
    saveSelectedFiscalYear(company, year)
    setSelectedFiscalYear(year)
    setAsOf(dashboardFiscalYearRange(year, currentFiscalStart).to)
  }
  const valuationMethod = company?.inventory_valuation_method || 'weighted_average'
  const retainedCategoryId = accountCategories.find(category => category.account_type === 'Equity' && category.name === 'Reserves & Surplus')?.id
  const currentAssetsCategory = accountCategories.find(category => category.account_type === 'Asset' && category.name.trim().toLowerCase() === 'current assets')
  const postedVouchers = useMemo(() => vouchers.filter(isPostedDashboardVoucher), [vouchers])
  const throughAsOf = useMemo(() => dashboardVouchersThrough(postedVouchers, asOf), [postedVouchers, asOf])
  const fiscalAccounts = useMemo(() => recomputeFiscalTrialAccounts(rawAccounts, throughAsOf, fiscalStart, company?.id || '', retainedCategoryId, items, valuationMethod, currentAssetsCategory?.id), [rawAccounts, throughAsOf, fiscalStart, company?.id, retainedCategoryId, items, valuationMethod, currentAssetsCategory?.id])
  const openingStockValue = fiscalAccounts.find(account => account.id === `${company?.id || ''}:opening-stock-report`)?.balance || 0
  const balanceSheetAccounts = useMemo(() => fiscalAccounts.filter(account => account.id !== `${company?.id || ''}:opening-stock-report`), [fiscalAccounts, company?.id])
  const closingStock = useMemo(() => recomputeStock(items, throughAsOf, valuationMethod), [items, throughAsOf, valuationMethod])
  const csv = round2(closingStock.reduce((sum, entry) => sum + entry.value, 0))
  const pnl = useMemo(() => computeProfitAndLoss(balanceSheetAccounts, round2(csv - openingStockValue)), [balanceSheetAccounts, csv, openingStockValue])
  const bs = useMemo(() => computeBalanceSheet(balanceSheetAccounts, pnl.net_profit, csv), [balanceSheetAccounts, pnl.net_profit, csv])
  const [expansionCommand, setExpansionCommand] = useState<ExpansionCommand>({ version: 0, expand: false })
  const realAssets = bs.assets.filter(account => !!account.company_id)
  const displayAssets: Account[] = [...realAssets, {
    id: 'balance-sheet:closing-stock', company_id: '', name: 'Closing Stock', type: 'Asset', group: 'Current Assets',
    is_system: true, is_party: false, opening_balance: 0, balance: csv, category_id: currentAssetsCategory?.id,
  }]
  const exportCsv = () => downloadCsv(`balance-sheet-as-of-${asOf}.csv`, ['Section', 'Ledger / Adjustment', 'Category', 'Amount'], [
    ...realAssets.map(account => ['Assets', account.name, categoryPath(accountCategories, account.category_id), account.balance || 0]),
    ...(csv ? [['Assets', 'Stock-in-Hand (Closing)', '', csv]] : []),
    ...bs.liabilities.map(account => ['Liabilities', account.name, categoryPath(accountCategories, account.category_id), account.balance || 0]),
    ...bs.equity.map(account => ['Equity', account.name, categoryPath(accountCategories, account.category_id), account.balance || 0]),
    ['Equity', `Net ${pnl.net_profit >= 0 ? 'Profit' : 'Loss'} (current)`, '', pnl.net_profit],
    ['', 'Total Assets', '', bs.total_assets], ['', 'Total Liabilities & Equity', '', bs.total_liabilities + bs.total_equity],
  ])

  return (
    <div className="report-page balance-sheet-report-page">
      <PageHeader title="Balance Sheet" description="Assets, liabilities and equity including closing stock and current profit" action={<div className="flex flex-wrap items-end gap-2"><div className="min-w-32 space-y-1"><Label>Fiscal Year</Label><SearchableSelect value={String(selectedFiscalYear)} onValueChange={changeFiscalYear} options={fiscalYearOptions} searchPlaceholder="Search fiscal year..." className="w-32" /></div><ReportActions onExport={exportCsv} /></div>} />
      <PageContent className="report-content space-y-4">
        <FormalReportPrintHeader company={company} title="Balance Sheet" periodLabel={`As of ${fmtDate(asOf)}`} detailLabel={`Fiscal Year ${selectedFiscalYear}/${String(selectedFiscalYear + 1).slice(-2)}`} />
        <div className="balance-sheet-simple-print hidden" aria-hidden="true">
          <header className="balance-sheet-print-heading">
            <h1>{company?.name || 'Our Company'}</h1>
            {company?.address && <p>{company.address}</p>}
            <h2>Balance Sheet</h2>
            <p>For {fmtDate(asOf)}</p>
          </header>
          <div className="balance-sheet-print-columns">
            <BalanceSheetPrintSide title="Liabilities" asOf={asOf} accounts={[...bs.liabilities, ...bs.equity]} categories={accountCategories} total={bs.total_liabilities + bs.total_equity} profitLoss={pnl.net_profit} />
            <BalanceSheetPrintSide title="Assets" asOf={asOf} accounts={displayAssets} categories={accountCategories} total={bs.total_assets} />
          </div>
        </div>
        <Card className="balance-sheet-screen-statement report-table-card overflow-hidden">
          <div className="balance-sheet-screen-heading flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2"><div className="min-w-0 flex-1 text-center"><p className="font-serif font-bold text-[#1B2A4A]">{company?.name || 'Our Company'}</p><p className="text-xs text-muted-foreground">As of {fmtDate(asOf)}</p></div><ExpandCollapseControls expanded={expansionCommand.expand} onToggle={() => setExpansionCommand(current => ({ version: current.version + 1, expand: !current.expand }))} /></div>
          <div className="report-print-columns grid grid-cols-1 items-stretch lg:grid-cols-2 print:grid-cols-2">
            <BalanceSheetStatementSide title="Liabilities & Equity" total={bs.total_liabilities + bs.total_equity}>
              <BalanceSheetAccountRows accounts={[...bs.liabilities, ...bs.equity]} categories={accountCategories} emptyLabel="No liability or equity ledgers" command={expansionCommand} />
              <BalanceSheetProfitLossRows amount={pnl.net_profit} command={expansionCommand} />
            </BalanceSheetStatementSide>
            <BalanceSheetStatementSide title="Assets" total={bs.total_assets} className="border-t lg:border-l lg:border-t-0 print:border-l print:border-t-0">
              <BalanceSheetAccountRows accounts={displayAssets} categories={accountCategories} emptyLabel="No asset ledgers" command={expansionCommand} />
            </BalanceSheetStatementSide>
          </div>
        </Card>
        {bs.balanced
          ? <p className="balance-sheet-status text-sm text-forest font-semibold">✓ Balanced — {fmtMoney(bs.total_assets)} = {fmtMoney(bs.total_liabilities + bs.total_equity)}</p>
          : <p className="balance-sheet-status text-sm text-destructive">⚠ Balance sheet is out of balance. Check recent entries.</p>
        }
        <FormalReportPrintFooter />
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
  const fiscalStart = selectedFiscalYearStartBs(company)
  const [range, setRange] = useState<ReportRange>('fiscal')
  const [from, setFrom] = useState(fiscalStart)
  const [to, setTo] = useState(() => selectedFiscalYearEndBs(company))
  const [stockCondition, setStockCondition] = useState<StockCondition>('saleable')
  const [showDetails, setShowDetails] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [status, setStatus] = useState<'all' | 'in' | 'low' | 'out'>('all')
  const [methodError, setMethodError] = useState('')
  const method = company?.inventory_valuation_method || 'weighted_average'
  useEffect(() => { if (range === 'fiscal') { setFrom(fiscalStart); setTo(selectedFiscalYearEndBs(company)) } }, [company, fiscalStart, range])
  const conditionSummaries = useMemo(() => ({
    saleable: computeStockConditionSummary(items, vouchers, 'saleable', method, from, to),
    damaged: computeStockConditionSummary(items, vouchers, 'damaged', method, from, to),
    expired: computeStockConditionSummary(items, vouchers, 'expired', method, from, to),
  }), [items, vouchers, method, from, to])
  const movements = conditionSummaries[stockCondition]
  const conditionValues = useMemo(() => {
    const valueFor = (condition: StockCondition) => conditionSummaries[condition].reduce((sum, row) => sum + row.closing_value, 0)
    const saleable = round2(valueFor('saleable'))
    const damaged = round2(valueFor('damaged'))
    const expired = round2(valueFor('expired'))
    return { saleable, damaged, expired, combined: round2(saleable + damaged + expired) }
  }, [conditionSummaries])
  const movementByItem = useMemo(() => new Map(movements.map(entry => [entry.id, entry])), [movements])
  const allowedCategories = useMemo(() => categoryId === 'all' ? null : new Set([categoryId, ...categoryDescendantIds(itemCategories, categoryId)]), [categoryId, itemCategories])
  const query = normalizeSearch(search)
  const rows = items.map(item => {
    const movement = movementByItem.get(item.id) || { id: item.id, opening_qty: 0, opening_value: 0, inward_qty: 0, inward_value: 0, outward_qty: 0, outward_value: 0, closing_qty: 0, closing_rate: 0, closing_value: 0 }
    const rowStatus: 'in' | 'low' | 'out' = movement.closing_qty <= 0 ? 'out' : stockCondition === 'saleable' && item.reorder_level != null && movement.closing_qty <= item.reorder_level ? 'low' : 'in'
    return { item, movement, category: categoryPath(itemCategories, item.category_id), status: rowStatus }
  }).filter(row => stockCondition === 'saleable' || Math.abs(row.movement.opening_qty) >= 0.0001 || Math.abs(row.movement.inward_qty) >= 0.0001 || Math.abs(row.movement.outward_qty) >= 0.0001 || Math.abs(row.movement.closing_qty) >= 0.0001)
    .filter(row => !query || normalizeSearch(`${row.item.name} ${row.category} ${row.item.sku || ''} ${row.item.barcode || ''} ${row.item.unit} ${row.item.alternate_unit || ''}`).includes(query))
    .filter(row => !allowedCategories || (!!row.item.category_id && allowedCategories.has(row.item.category_id)))
    .filter(row => status === 'all' || row.status === status)
    .sort((left, right) => left.item.name.localeCompare(right.item.name))
  const totalValue = rows.reduce((sum, row) => sum + row.movement.closing_value, 0)
  const lowStockCount = rows.filter(row => row.status === 'low').length
  const categoryCount = new Set(rows.map(row => row.item.category_id).filter(Boolean)).size
  const sameUnit = new Set(rows.map(row => row.item.unit.toLowerCase())).size <= 1
  const totals = rows.reduce((sum, row) => ({ opening: sum.opening + row.movement.opening_qty, inward: sum.inward + row.movement.inward_qty, outward: sum.outward + row.movement.outward_qty, closing: sum.closing + row.movement.closing_qty }), { opening: 0, inward: 0, outward: 0, closing: 0 })
  const methodLabel = method === 'fifo' ? 'FIFO' : method === 'lifo' ? 'LIFO' : 'Weighted Average'
  const conditionLabel = stockCondition === 'saleable' ? 'Saleable Stock' : stockCondition === 'damaged' ? 'Damaged Stock' : 'Expired Stock'
  const qty = (value: number, item: typeof items[number]) => <><span className="block whitespace-nowrap num">{value.toLocaleString('en-NP', { maximumFractionDigits: 4 })} {item.unit}</span>{item.alternate_unit && <span className="block whitespace-nowrap text-[11px] text-muted-foreground">({(value * Number(item.alternate_conversion || 0)).toLocaleString('en-NP', { maximumFractionDigits: 4 })} {item.alternate_unit})</span>}</>
  const badge = (value: 'in' | 'low' | 'out') => value === 'in' ? <Badge className={stockCondition === 'saleable' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : stockCondition === 'damaged' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700'}>{stockCondition === 'saleable' ? 'In Stock' : stockCondition === 'damaged' ? 'Damaged' : 'Expired'}</Badge> : value === 'low' ? <Badge className="border-amber-200 bg-amber-50 text-amber-700">Low</Badge> : <Badge className="border-red-200 bg-red-50 text-red-700">Out</Badge>
  const changeMethod = async (value: string) => {
    const next = value as InventoryValuationMethod
    if (next === method || !window.confirm('Changing the valuation method will recalculate all historical stock values and may change Profit & Loss and Balance Sheet totals. Continue?')) return
    setMethodError('')
    try { await saveCompany({ inventory_valuation_method: next }) } catch (error: unknown) { setMethodError((error as Error).message) }
  }
  const headings = showDetails ? ['Item', 'Category', 'Unit', 'Opening', 'Inward', 'Outward', 'Closing', 'Avg Rate', 'Value', 'Status'] : ['Item', 'Category', 'Unit', 'Closing', 'Avg Rate', 'Value', 'Status']
  const exportCsv = () => downloadCsv(`${stockCondition}-stock-summary-${from}-to-${to}.csv`, headings, rows.map(row => showDetails
    ? [row.item.name, row.category, row.item.unit, row.movement.opening_qty, row.movement.inward_qty, row.movement.outward_qty, row.movement.closing_qty, row.movement.closing_rate, row.movement.closing_value, row.status]
    : [row.item.name, row.category, row.item.unit, row.movement.closing_qty, row.movement.closing_rate, row.movement.closing_value, row.status]))

  return <div className="report-page stock-summary-report-page">
    <PageHeader title="Stock Summary" description={`${conditionLabel} movement and closing quantities with ${methodLabel} valuation`} action={<ReportActions onExport={exportCsv} />} />
    <PageContent className="report-content space-y-5">
      <FormalReportPrintHeader company={company} title={`${conditionLabel} Summary`} periodLabel={`${fmtDate(from)} to ${fmtDate(to)}`} detailLabel={`${methodLabel} valuation`} />
      <Card className="report-controls"><CardContent className="p-4"><ReportDateFilters company={company} range={range} from={from} to={to} onRangeChange={setRange} onFromChange={setFrom} onToChange={setTo} /></CardContent></Card>
      <div className="report-summary grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Saleable Stock Value" value={conditionValues.saleable} Icon={Boxes} color="positive" />
        <StatCard label="Damaged Stock Value" value={conditionValues.damaged} Icon={AlertTriangle} color="warning" />
        <StatCard label="Expired Stock Value" value={conditionValues.expired} Icon={AlertTriangle} color="negative" />
        <StatCard label="Combined Stock Value" value={conditionValues.combined} Icon={TrendingUp} />
      </div>
      <Tabs value={stockCondition} onValueChange={value => { setStockCondition(value as StockCondition); setStatus('all') }}><TabsList className="w-full justify-start overflow-x-auto sm:w-auto"><TabsTrigger value="saleable">Saleable Stock</TabsTrigger><TabsTrigger value="damaged">Damaged Stock</TabsTrigger><TabsTrigger value="expired">Expired Stock</TabsTrigger></TabsList></Tabs>
      <div className="report-summary grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Items" value={String(rows.length)} Icon={Boxes} />
        <StatCard label={`Stock Value (${methodLabel})`} value={totalValue} Icon={TrendingUp} color="positive" />
         <StatCard label={stockCondition === 'saleable' ? 'Low Stock Items' : `${conditionLabel} Items`} value={String(stockCondition === 'saleable' ? lowStockCount : rows.filter(row => row.movement.closing_qty > 0).length)} Icon={AlertTriangle} color="warning" />
        <StatCard label="Categories" value={String(categoryCount)} Icon={Layers3} />
      </div>
      <div className="report-controls flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search items…" className="w-full pl-8" /></div>
        <SearchableSelect className="w-full lg:w-56" value={categoryId} onValueChange={setCategoryId} options={[{ value: 'all', label: 'All Categories' }, ...itemCategories.map(category => ({ value: category.id, label: categoryOptionLabel(itemCategories, category.id), searchText: categoryPath(itemCategories, category.id) }))]} />
         <SearchableSelect className="w-full lg:w-40" value={status} onValueChange={value => setStatus(value as typeof status)} options={[{ value: 'all', label: 'All Status' }, { value: 'in', label: 'In Stock' }, ...(stockCondition === 'saleable' ? [{ value: 'low', label: 'Low Stock' }] : []), { value: 'out', label: 'Out of Stock' }]} />
        <SearchableSelect className="w-full lg:w-52" value={method} onValueChange={changeMethod} options={[{ value: 'weighted_average', label: 'Weighted Average' }, { value: 'fifo', label: 'FIFO' }, { value: 'lifo', label: 'LIFO' }]} />
        <Button size="sm" className="h-9" variant={showDetails ? 'default' : 'outline'} onClick={() => setShowDetails(value => !value)}>{showDetails ? 'Hide Details' : 'Show Details'}</Button>
      </div>
      {methodError && <p className="text-sm text-destructive">{methodError}</p>}
      <Card className="report-table-card overflow-hidden">{rows.length === 0 ? <div className="py-16 text-center text-muted-foreground"><Boxes className="mx-auto mb-3 h-8 w-8 opacity-30" /><p className="font-medium text-foreground">No matching stock items</p><p className="mt-1 text-sm">Try changing the search or filters.</p></div> : <div className="overflow-x-auto"><table className={`stock-summary-table w-full border-collapse text-sm ${showDetails ? 'stock-summary-detailed min-w-[1120px]' : 'stock-summary-compact min-w-[820px]'}`}>
        <thead><tr className="bg-muted/50">{headings.map((heading, index) => <th key={heading} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground ${index >= 3 && heading !== 'Status' ? 'text-right' : 'text-left'} ${heading === 'Category' || heading === 'Status' ? 'stock-summary-print-hide' : ''}`}>{heading}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.item.id} className="border-t border-border hover:bg-muted/20"><td className="px-4 py-3 font-medium">{row.item.name}</td><td className="stock-summary-print-hide px-4 py-3 text-muted-foreground">{row.category || '—'}</td><td className="px-4 py-3"><span className="block">{row.item.unit}</span>{row.item.alternate_unit && <span className="block text-[11px] text-muted-foreground">1 {row.item.unit} = {row.item.alternate_conversion} {row.item.alternate_unit}</span>}</td>{showDetails && <><td className="px-4 py-3 text-right">{qty(row.movement.opening_qty, row.item)}</td><td className="px-4 py-3 text-right text-emerald-600">{qty(row.movement.inward_qty, row.item)}</td><td className="px-4 py-3 text-right text-red-600">{qty(row.movement.outward_qty, row.item)}</td></>}<td className="px-4 py-3 text-right font-semibold">{qty(row.movement.closing_qty, row.item)}</td><td className="px-4 py-3 text-right num">{fmtMoney(row.movement.closing_rate)}</td><td className="px-4 py-3 text-right num font-semibold">{fmtMoney(row.movement.closing_value)}</td><td className="stock-summary-print-hide px-4 py-3">{badge(row.status)}</td></tr>)}</tbody>
        <tfoot><tr className="stock-summary-screen-total border-t-2 border-border bg-muted/30 font-semibold"><td className="px-4 py-3" colSpan={3}>Filtered Total ({rows.length} item{rows.length === 1 ? '' : 's'})</td>{showDetails && (['opening', 'inward', 'outward'] as const).map(key => <td key={key} className="px-4 py-3 text-right num">{sameUnit ? totals[key].toLocaleString('en-NP', { maximumFractionDigits: 4 }) : '—'}</td>)}<td className="px-4 py-3 text-right num">{sameUnit ? totals.closing.toLocaleString('en-NP', { maximumFractionDigits: 4 }) : '—'}</td><td></td><td className="px-4 py-3 text-right num">{fmtMoney(totalValue)}</td><td></td></tr><tr className="stock-summary-print-total hidden border-t-2 border-border bg-muted/30 font-semibold"><td className="px-4 py-3" colSpan={2}>Filtered Total ({rows.length} item{rows.length === 1 ? '' : 's'})</td>{showDetails && (['opening', 'inward', 'outward'] as const).map(key => <td key={key} className="px-4 py-3 text-right num">{sameUnit ? totals[key].toLocaleString('en-NP', { maximumFractionDigits: 4 }) : '—'}</td>)}<td className="px-4 py-3 text-right num">{sameUnit ? totals.closing.toLocaleString('en-NP', { maximumFractionDigits: 4 }) : '—'}</td><td></td><td className="px-4 py-3 text-right num">{fmtMoney(totalValue)}</td></tr></tfoot>
      </table></div>}</Card>
      <FormalReportPrintFooter />
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
          <div className="relative min-w-0 flex-1 sm:flex-none"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search stock…" className="w-full pl-8 sm:w-64" /></div>
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
