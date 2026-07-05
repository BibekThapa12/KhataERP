// ─── Shared report helpers ────────────────────────────────────────────────────
import { useState, useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { computeTrialBalance, computeProfitAndLoss, computeBalanceSheet, computeVatReport } from '@/lib/engine'
import { fmtMoney } from '@/lib/utils'
import { firstOfCurrentBsMonth, todayBs } from '@/lib/nepaliDate'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/StatCard'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import type { Account } from '@/types'

function ReportTable({
  rows, totalLeft, totalRight, leftLabel = 'Debit', rightLabel = 'Credit',
}: {
  rows: { label: string; left?: number; right?: number }[]
  totalLeft: number
  totalRight: number
  leftLabel?: string
  rightLabel?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{leftLabel}</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{rightLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border hover:bg-muted/20">
              <td className="px-4 py-2.5">{r.label}</td>
              <td className="px-4 py-2.5 text-right num">
                {r.left != null && r.left !== 0 ? <span className="debit-amt">{fmtMoney(r.left)}</span> : '—'}
              </td>
              <td className="px-4 py-2.5 text-right num">
                {r.right != null && r.right !== 0 ? <span className="credit-amt">{fmtMoney(r.right)}</span> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/30 font-semibold">
            <td className="px-4 py-2.5">Total</td>
            <td className="px-4 py-2.5 text-right num">{fmtMoney(totalLeft)}</td>
            <td className="px-4 py-2.5 text-right num">{fmtMoney(totalRight)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function AccountList({ accounts, total, emptyLabel }: { accounts: Account[]; total: number; emptyLabel: string }) {
  if (accounts.length === 0) return <p className="text-sm text-muted-foreground px-4 py-3">{emptyLabel}</p>
  return (
    <table className="w-full text-sm border-collapse">
      <tbody>
        {accounts.map(a => (
          <tr key={a.id} className="border-t border-border hover:bg-muted/20">
            <td className="px-4 py-2.5">{a.name}</td>
            <td className="px-4 py-2.5 text-right num">{fmtMoney(a.balance)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-border bg-muted/30 font-semibold">
          <td className="px-4 py-2.5">Total</td>
          <td className="px-4 py-2.5 text-right num">{fmtMoney(total)}</td>
        </tr>
      </tbody>
    </table>
  )
}

// ─── Trial Balance ────────────────────────────────────────────────────────────
export function TrialBalancePage() {
  const accounts = useAppStore(s => s.accounts)
  const tb = useMemo(() => computeTrialBalance(accounts), [accounts])

  return (
    <div>
      <PageHeader title="Trial Balance" description="All account balances — debits must equal credits" />
      <PageContent>
        <Card>
          <ReportTable
            rows={tb.rows.map(r => ({ label: r.name, left: r.debit || undefined, right: r.credit || undefined }))}
            totalLeft={tb.total_debit}
            totalRight={tb.total_credit}
          />
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
  const { accounts, closingStockValue } = useAppStore()
  const csv = closingStockValue()
  const pnl = useMemo(() => computeProfitAndLoss(accounts, csv), [accounts, csv])

  return (
    <div>
      <PageHeader title="Profit & Loss"
        description="Income vs expenses, adjusted for closing stock so profit reflects only goods actually sold" />
      <PageContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Total Income" value={pnl.total_income} color="positive" />
          <StatCard label="Total Expense" value={pnl.total_expense} color="negative"
            sub={csv > 0 ? `After closing stock deduction of ${fmtMoney(csv)}` : undefined} />
          <StatCard label={pnl.net_profit >= 0 ? 'Net Profit' : 'Net Loss'} value={Math.abs(pnl.net_profit)}
            color={pnl.net_profit >= 0 ? 'positive' : 'negative'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Income</CardTitle></CardHeader>
            <CardContent className="p-0 pb-1">
              <AccountList accounts={pnl.income} total={pnl.total_income} emptyLabel="No income accounts" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Expense</CardTitle></CardHeader>
            <CardContent className="p-0 pb-1">
              <table className="w-full text-sm border-collapse">
                <tbody>
                  {pnl.expense.map(a => (
                    <tr key={a.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-2.5">{a.name}</td>
                      <td className="px-4 py-2.5 text-right num">{fmtMoney(a.balance)}</td>
                    </tr>
                  ))}
                  {csv > 0 && (
                    <tr className="border-t border-border hover:bg-muted/20 text-forest">
                      <td className="px-4 py-2.5 italic">Less: Closing Stock</td>
                      <td className="px-4 py-2.5 text-right num">- {fmtMoney(csv)}</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="px-4 py-2.5">Total (adjusted)</td>
                    <td className="px-4 py-2.5 text-right num">{fmtMoney(pnl.total_expense)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </div>
  )
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────
export function BalanceSheetPage() {
  const { accounts, closingStockValue } = useAppStore()
  const csv = closingStockValue()
  const pnl = useMemo(() => computeProfitAndLoss(accounts, csv), [accounts, csv])
  const bs = useMemo(() => computeBalanceSheet(accounts, pnl.net_profit, csv), [accounts, pnl.net_profit, csv])

  return (
    <div>
      <PageHeader title="Balance Sheet" description="Assets, liabilities and equity including closing stock and current profit" />
      <PageContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Assets</CardTitle></CardHeader>
            <CardContent className="p-0 pb-1">
              <AccountList accounts={bs.assets} total={bs.total_assets} emptyLabel="No assets" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Liabilities & Equity</CardTitle></CardHeader>
            <CardContent className="p-0 pb-1">
              <table className="w-full text-sm border-collapse">
                <tbody>
                  {bs.liabilities.map(a => (
                    <tr key={a.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-2.5">{a.name}</td>
                      <td className="px-4 py-2.5 text-right num">{fmtMoney(a.balance)}</td>
                    </tr>
                  ))}
                  {bs.equity.map(a => (
                    <tr key={a.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-2.5">{a.name}</td>
                      <td className="px-4 py-2.5 text-right num">{fmtMoney(a.balance)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2.5 italic text-muted-foreground">Net {pnl.net_profit >= 0 ? 'Profit' : 'Loss'} (current)</td>
                    <td className="px-4 py-2.5 text-right num">{fmtMoney(pnl.net_profit)}</td>
                  </tr>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right num">{fmtMoney(bs.total_liabilities + bs.total_equity)}</td>
                  </tr>
                </tbody>
              </table>
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
  const [from, setFrom] = useState(firstOfCurrentBsMonth())
  const [to, setTo] = useState(todayBs())
  const [applied, setApplied] = useState({ from: firstOfCurrentBsMonth(), to: todayBs() })

  const vat = useMemo(() => computeVatReport(vouchers, applied.from, applied.to), [vouchers, applied])

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
            sub={`Taxable sales: ${fmtMoney(vat.taxable_sales)}`} />
          <StatCard label="Input VAT (on Purchases)" value={vat.input_vat}
            sub={`Taxable purchases: ${fmtMoney(vat.taxable_purchases)}`} />
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
              vouchers={[...vat.sales, ...vat.purchases].sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq)}
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
  const { items, stock } = useAppStore()
  const rows = items
    .map(item => ({ item, s: stock.find(e => e.id === item.id) ?? { qty: 0, avg_cost: 0, value: 0 } }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name))
  const totalValue = rows.reduce((s, r) => s + r.s.value, 0)

  return (
    <div>
      <PageHeader title="Stock Summary" description="Current quantities at weighted-average cost" />
      <PageContent>
        <Card>
          {rows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-3xl mb-3 opacity-30">▣</p>
              <p className="font-medium text-foreground">No items yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
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
                      <td className="px-4 py-2.5 text-right num font-semibold">{s.qty}</td>
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
              </table>
            </div>
          )}
        </Card>
      </PageContent>
    </div>
  )
}
