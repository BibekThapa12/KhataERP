import { useMemo, useState } from 'react'
import { Pencil, Search, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { cn, fmtDate, fmtMoney } from '@/lib/utils'
import { selectedFiscalYearStartBs, vouchersInFiscalYear } from '@/lib/reports'
import { normalizeSearch } from '@/lib/search'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { StockAdjustmentForm } from '@/components/forms/StockAdjustmentForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'
import type { StockCondition, Voucher } from '@/types'

export function StockAdjustmentsPage() {
  const company = useAppStore(state => state.company)
  const items = useAppStore(state => state.items)
  const vouchers = useAppStore(state => state.vouchers)
  const [search, setSearch] = useState('')
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [editingAdjustment, setEditingAdjustment] = useState<Voucher | null>(null)
  const query = normalizeSearch(search)
  const adjustments = useMemo(() => vouchersInFiscalYear(vouchers, selectedFiscalYearStartBs(company)).filter(voucher => voucher.type === 'Stock Adjustment').filter(voucher => {
    const line = voucher.stock_lines?.[0]
    const draft = voucher.status === 'Draft' ? voucher.draft_payload as Partial<{ itemId:string; mode:string; stockCondition:string; transferTo:string; narration:string }> | null : null
    const item = items.find(entry => entry.id === (line?.item_id || draft?.itemId))
    return !query || normalizeSearch(`${voucher.date_bs} ${item?.name || ''} ${voucher.narration || draft?.narration || ''} ${line?.direction || ''} ${draft?.mode || ''} ${draft?.stockCondition || ''} ${draft?.transferTo || ''} ${voucher.status === 'Draft' ? 'draft' : voucher.cancelled ? 'cancelled' : 'active'}`).includes(query)
  }).sort((left, right) => right.date_bs_key - left.date_bs_key || right.seq - left.seq), [company, vouchers, items, query])
  const stockDrafts = useMemo(() => adjustments.filter(voucher => voucher.status === 'Draft'), [adjustments])

  const editAdjustment = (voucher: Voucher) => {
    setEditingAdjustment(voucher)
    setShowAdjustment(true)
  }

  const closeAdjustment = () => {
    setShowAdjustment(false)
    setEditingAdjustment(null)
  }

  return <div>
    <PageHeader
      title="Stock Adjustments"
      description="Record stock corrections, losses, found stock, and condition transfers"
      action={<Button onClick={() => { setEditingAdjustment(null); setShowAdjustment(true) }}><SlidersHorizontal className="mr-1.5 h-4 w-4" />New Adjustment</Button>}
    />
    <PageContent className="space-y-4">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search adjustments..." className="pl-8" />
      </div>

      {stockDrafts.length > 0 && <Card className="overflow-hidden border-amber-200">
        <div className="border-b bg-amber-50/60 px-4 py-3"><p className="font-medium text-amber-900">Draft Stock Vouchers</p><p className="text-sm text-amber-800">Edit a draft to update, delete, or complete the stock adjustment or stock transfer.</p></div>
        <div className="divide-y">{stockDrafts.map(draftVoucher => {
          const draft = draftVoucher.draft_payload as Partial<{ itemId:string; mode:'adjustment'|'transfer'; stockCondition:StockCondition; transferTo:'damaged'|'expired'; qtyDelta:string; narration:string }> | null
          const item = items.find(entry => entry.id === draft?.itemId)
          const movement = draft?.mode === 'transfer' ? `Saleable → ${(draft.transferTo || 'damaged').replace(/^./, value => value.toUpperCase())}` : (draft?.stockCondition || 'saleable').replace(/^./, value => value.toUpperCase())
          return <div key={draftVoucher.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="bg-amber-100 text-amber-800">Draft</Badge><span className="font-medium">{item?.name || 'Draft item not selected'}</span><span className="text-sm text-muted-foreground">{fmtDate(draftVoucher.date_bs)}</span></div><p className="mt-1 text-sm text-muted-foreground">{movement} · Qty {draft?.qtyDelta || '-'}{draft?.narration ? ` · ${draft.narration}` : ''}</p></div><Button size="sm" variant="outline" onClick={() => editAdjustment(draftVoucher)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button></div>
        })}</div>
      </Card>}

      <Card className="overflow-hidden">{adjustments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Date</th><th className="report-th text-left">Item</th><th className="report-th text-left">Stock Movement</th><th className="report-th text-right">Qty Change</th><th className="report-th text-right">Rate</th><th className="report-th text-right">Value</th><th className="report-th text-left">Reason</th><th className="report-th text-left">Status</th><th className="report-th text-right">Actions</th></tr></thead><tbody>{adjustments.map(voucher => {
        const line = voucher.stock_lines?.[0]
        const draft = voucher.status === 'Draft' ? voucher.draft_payload as Partial<{ itemId:string; mode:'adjustment'|'transfer'; stockCondition:StockCondition; transferTo:'damaged'|'expired'; qtyDelta:string; rate:string; narration:string }> | null : null
        const destination = voucher.stock_lines?.find(entry => entry.is_transfer && entry.direction === 'in')
        const item = items.find(entry => entry.id === (line?.item_id || draft?.itemId))
        const quantity = draft ? Number(draft.qtyDelta || 0) : line?.is_transfer ? line.qty : (line?.direction === 'out' ? -1 : 1) * (line?.qty || 0)
        const condition = (draft?.stockCondition || line?.stock_condition || 'saleable').replace(/^./, value => value.toUpperCase())
        const isTransfer = draft?.mode === 'transfer' || !!line?.is_transfer
        const transferDestination = (draft?.transferTo || destination?.stock_condition || 'damaged').replace(/^./, value => value.toUpperCase())
        const displayRate = draft ? Number(draft.rate || 0) : line?.rate || 0
        const displayMovement = isTransfer ? `Saleable → ${transferDestination}` : condition
        return <tr key={voucher.id} className={cn('border-t hover:bg-muted/30', voucher.cancelled && 'opacity-55', voucher.status === 'Draft' && 'bg-amber-50/35')}><td className="report-td whitespace-nowrap text-muted-foreground">{fmtDate(voucher.date_bs)}</td><td className="report-td font-medium">{item?.name || (voucher.status === 'Draft' ? 'Draft item not selected' : 'Unknown item')}</td><td className="report-td">{displayMovement}</td><td className={cn('report-td text-right num font-semibold', !isTransfer && quantity < 0 ? 'text-destructive' : 'text-forest')}>{!isTransfer && quantity > 0 ? '+' : ''}{quantity || '-'}</td><td className="report-td text-right num">{fmtMoney(displayRate)}</td><td className="report-td text-right num">{isTransfer ? '-' : fmtMoney(Math.abs(quantity) * displayRate)}</td><td className="report-td text-muted-foreground">{voucher.narration || draft?.narration || '-'}</td><td className="report-td"><Badge variant={voucher.cancelled ? 'cancelled' : voucher.status === 'Draft' ? 'secondary' : 'default'} className={voucher.status === 'Draft' ? 'bg-amber-100 text-amber-800' : ''}>{voucher.cancelled ? 'Cancelled' : voucher.status === 'Draft' ? 'Draft' : 'Completed'}</Badge></td><td className="report-td text-right">{voucher.status === 'Draft' ? <Button size="sm" variant="outline" onClick={() => editAdjustment(voucher)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button> : <span className="text-xs text-muted-foreground">-</span>}</td></tr>
      })}</tbody></table></div> : <div className="py-16 text-center"><p className="font-medium">{search ? 'No matching adjustments' : 'No stock adjustments yet'}</p><p className="mt-1 text-sm text-muted-foreground">Use adjustments for damage, loss, found stock, and corrections.</p></div>}</Card>
    </PageContent>
    <StockAdjustmentForm open={showAdjustment} voucher={editingAdjustment} onClose={closeAdjustment} />
  </div>
}
