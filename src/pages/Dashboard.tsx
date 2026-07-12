import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, TrendingDown, Wallet, Package } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { computeProfitAndLoss, recomputeAllBalances } from '@/lib/engine'
import { resolveSystemAccountId, type SystemAccountKey } from '@/lib/engine'
import { adToBs, firstOfCurrentBsMonth, makeBsKey, todayBs } from '@/lib/nepaliDate'
import { fmtMoney } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { StatCard } from '@/components/StatCard'
import { VoucherTable } from '@/components/tables/VoucherTable'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { ReceiptPaymentForm, JournalForm } from '@/components/forms/OtherForms'
import { ReturnForm } from '@/components/forms/ReturnForm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import type { Voucher } from '@/types'
import { bankAccounts } from '@/lib/banks'

export function Dashboard() {
  const { company, accounts, rawAccounts, accountCategories, vouchers, stock, parties, closingStockValue } = useAppStore()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Voucher | null>(null)
  const vatEnabled = company?.vat_enabled ?? true
  const currentBs = todayBs()
  const fiscalStartMonthDay = company?.fiscal_year_start ? adToBs(company.fiscal_year_start).slice(5) : firstOfCurrentBsMonth().slice(5)
  const fiscalStartThisYear = `${currentBs.slice(0, 4)}-${fiscalStartMonthDay}`
  const fiscalStartBs = makeBsKey(currentBs) >= makeBsKey(fiscalStartThisYear)
    ? fiscalStartThisYear
    : `${Number(currentBs.slice(0, 4)) - 1}-${fiscalStartMonthDay}`
  const [range, setRange] = useState<'today' | 'month' | 'fiscal' | 'custom'>('fiscal')
  const [from, setFrom] = useState(fiscalStartBs)
  const [to, setTo] = useState(todayBs())

  useEffect(() => {
    if (range !== 'fiscal') return
    setFrom(fiscalStartBs)
    setTo(todayBs())
  }, [fiscalStartBs, range])

  const applyPreset = (preset: 'today' | 'month' | 'fiscal') => {
    setRange(preset)
    if (preset === 'today') {
      setFrom(todayBs())
      setTo(todayBs())
    } else if (preset === 'month') {
      setFrom(firstOfCurrentBsMonth())
      setTo(todayBs())
    } else {
      setFrom(fiscalStartBs)
      setTo(todayBs())
    }
  }

  const filteredVouchers = useMemo(() => {
    const fromKey = makeBsKey(from)
    const toKey = makeBsKey(to)
    return vouchers.filter(v => {
      const key = v.date_bs_key || makeBsKey(v.date_bs)
      return key >= fromKey && key <= toKey
    })
  }, [vouchers, from, to])

  const periodAccounts = useMemo(() => recomputeAllBalances(rawAccounts, filteredVouchers), [rawAccounts, filteredVouchers])
  const pnl = useMemo(() => computeProfitAndLoss(periodAccounts, closingStockValue()), [periodAccounts, closingStockValue])

  const systemBalance = (key: SystemAccountKey) => {
    if (!company) return 0
    return accounts.find(a => a.id === resolveSystemAccountId(accounts, company.id, key))?.balance ?? 0
  }

  const cash = systemBalance('cash')
  const bank = bankAccounts(accounts, accountCategories, true).reduce((sum, account) => sum + (account.balance || 0), 0)

  const debtorsTotal = parties
    .filter(p => p.type === 'customer')
    .reduce((s, p) => s + (accounts.find(a => a.id === p.account_id)?.balance ?? 0), 0)

  const creditorsTotal = parties
    .filter(p => p.type === 'supplier')
    .reduce((s, p) => s + (accounts.find(a => a.id === p.account_id)?.balance ?? 0), 0)

  const totalStockValue = stock.reduce((s, e) => s + e.value, 0)

  const vatPayable = systemBalance('vat_payable')
  const vatReceivable = systemBalance('vat_receivable')
  const netVat = vatPayable - vatReceivable

  const recent = [...filteredVouchers].filter(v => !v.cancelled)
    .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq)
    .slice(0, 10)

  const lowStockItems = useAppStore(s => s.items).filter(item => {
    const s = stock.find(e => e.id === item.id)
    return item.reorder_level != null && (s?.qty ?? 0) <= item.reorder_level
  })

  const closeEdit = () => setEditing(null)
  const companySetupIncomplete = !!company && (
    company.name === 'My Trading Co.' ||
    !company.address ||
    !company.phone ||
    !company.pan_vat
  )

  return (
    <div>
      <PageHeader title="Dashboard" description="Your business at a glance" />
      <PageContent className="space-y-5">
        {companySetupIncomplete && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-800">Complete company setup</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Add company name, address, phone, PAN/VAT, VAT mode, and fiscal year from Settings.
                </p>
              </div>
              <Button size="sm" onClick={() => navigate('/settings')}>Open Settings</Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex gap-2">
                <Button variant={range === 'today' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('today')}>Today</Button>
                <Button variant={range === 'month' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('month')}>This Month</Button>
                <Button variant={range === 'fiscal' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('fiscal')}>Fiscal Year</Button>
                <Button variant={range === 'custom' ? 'default' : 'outline'} size="sm" onClick={() => setRange('custom')}>Custom</Button>
              </div>
              <div className="space-y-1.5">
                <Label>From</Label>
                <NepaliDateInput value={from} onChange={v => { setFrom(v); setRange('custom') }} className="w-40" />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <NepaliDateInput value={to} onChange={v => { setTo(v); setRange('custom') }} className="w-40" />
              </div>
            </div>
          </CardContent>
        </Card>
        {/* Stat grid */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          <StatCard label="Cash + Bank" value={cash + bank} Icon={Wallet}
            color={cash + bank >= 0 ? 'default' : 'negative'} />
          <StatCard label="Sundry Debtors (Customers)" value={debtorsTotal} Icon={TrendingUp}
            color="positive" sub="Money Sundry Debtors owe you" />
          <StatCard label="Sundry Creditors (Suppliers)" value={creditorsTotal} Icon={TrendingDown}
            color="negative" sub="Money you owe Sundry Creditors" />
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
      <ReturnForm type="Sales Return" open={editing?.type === 'Sales Return'} voucher={editing?.type === 'Sales Return' ? editing : null} onClose={closeEdit} />
      <ReturnForm type="Purchase Return" open={editing?.type === 'Purchase Return'} voucher={editing?.type === 'Purchase Return' ? editing : null} onClose={closeEdit} />
    </div>
  )
}
