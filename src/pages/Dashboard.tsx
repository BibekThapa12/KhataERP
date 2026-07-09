import { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Wallet, Package } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { computeProfitAndLoss } from '@/lib/engine'
import { fmtMoney } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { StatCard } from '@/components/StatCard'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { ReceiptPaymentForm, JournalForm } from '@/components/forms/OtherForms'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'
import type { Voucher } from '@/types'

export function Dashboard() {
  const { company, accounts, vouchers, stock, parties, closingStockValue, getPartyByAccountId } = useAppStore()
  const [editing, setEditing] = useState<Voucher | null>(null)
  const vatEnabled = company?.vat_enabled ?? true

  const pnl = useMemo(() => computeProfitAndLoss(accounts, closingStockValue()), [accounts, closingStockValue])

  const cash = accounts.find(a => a.id === 'cash')?.balance ?? 0
  const bank = accounts.find(a => a.id === 'bank')?.balance ?? 0

  const debtorsTotal = parties
    .filter(p => p.type === 'customer')
    .reduce((s, p) => s + (accounts.find(a => a.id === p.account_id)?.balance ?? 0), 0)

  const creditorsTotal = parties
    .filter(p => p.type === 'supplier')
    .reduce((s, p) => s + (accounts.find(a => a.id === p.account_id)?.balance ?? 0), 0)

  const totalStockValue = stock.reduce((s, e) => s + e.value, 0)

  const vatPayable = accounts.find(a => a.id === 'vat_payable')?.balance ?? 0
  const vatReceivable = accounts.find(a => a.id === 'vat_receivable')?.balance ?? 0
  const netVat = vatPayable - vatReceivable

  const recent = [...vouchers].filter(v => !v.cancelled)
    .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq)
    .slice(0, 10)

  const lowStockItems = useAppStore(s => s.items).filter(item => {
    const s = stock.find(e => e.id === item.id)
    return item.reorder_level != null && (s?.qty ?? 0) <= item.reorder_level
  })

  const closeEdit = () => setEditing(null)

  return (
    <div>
      <PageHeader title="Dashboard" description="Your business at a glance" />
      <PageContent className="space-y-5">
        {/* Stat grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Cash + Bank" value={cash + bank} Icon={Wallet}
            color={cash + bank >= 0 ? 'default' : 'negative'} />
          <StatCard label="Receivable (Debtors)" value={debtorsTotal} Icon={TrendingUp}
            color="positive" sub="Money customers owe you" />
          <StatCard label="Payable (Creditors)" value={creditorsTotal} Icon={TrendingDown}
            color="negative" sub="Money you owe suppliers" />
          <StatCard label="Stock Value" value={totalStockValue} Icon={Package}
            sub={`${useAppStore.getState().items.length} item(s)`} />
        </div>

        <div className={`grid grid-cols-1 ${vatEnabled ? 'lg:grid-cols-2' : ''} gap-4`}>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Net Profit / Loss</p>
              <p className={`font-serif text-2xl font-bold mt-2 num ${pnl.net_profit >= 0 ? 'text-[#2D5F4C]' : 'text-[#B5482E]'}`}>
                {fmtMoney(pnl.net_profit)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Income {fmtMoney(pnl.total_income)} − Expense {fmtMoney(pnl.total_expense)}
              </p>
            </CardContent>
          </Card>
          {vatEnabled && (
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">VAT Position</p>
              <p className={`font-serif text-2xl font-bold mt-2 num ${netVat > 0 ? 'text-[#B5482E]' : 'text-[#2D5F4C]'}`}>
                {fmtMoney(Math.abs(netVat))} {netVat > 0 ? 'payable' : 'credit'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Output {fmtMoney(vatPayable)} − Input {fmtMoney(vatReceivable)}
              </p>
            </CardContent>
          </Card>
          )}
        </div>

        {/* Low stock alerts */}
        {lowStockItems.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-amber-700 mb-2">⚠ Low Stock Alert</p>
              <div className="flex flex-wrap gap-2">
                {lowStockItems.map(item => {
                  const s = stock.find(e => e.id === item.id)
                  return (
                    <Badge key={item.id} variant="outline" className="border-amber-300 text-amber-700">
                      {item.name} — {s?.qty ?? 0} {item.unit} left
                    </Badge>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <VoucherTable vouchers={recent} onEdit={setEditing} />
          </CardContent>
        </Card>
      </PageContent>

      <InvoiceForm
        type="Sales"
        open={editing?.type === 'Sales'}
        voucher={editing?.type === 'Sales' ? editing : null}
        onClose={closeEdit}
      />
      <InvoiceForm
        type="Purchase"
        open={editing?.type === 'Purchase'}
        voucher={editing?.type === 'Purchase' ? editing : null}
        onClose={closeEdit}
      />
      <ReceiptPaymentForm
        type="Receipt"
        open={editing?.type === 'Receipt'}
        voucher={editing?.type === 'Receipt' ? editing : null}
        onClose={closeEdit}
      />
      <ReceiptPaymentForm
        type="Payment"
        open={editing?.type === 'Payment'}
        voucher={editing?.type === 'Payment' ? editing : null}
        onClose={closeEdit}
      />
      <JournalForm
        open={editing?.type === 'Journal'}
        voucher={editing?.type === 'Journal' ? editing : null}
        onClose={closeEdit}
      />
    </div>
  )
}
