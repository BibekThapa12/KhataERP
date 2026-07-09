import { useState } from 'react'
import { Plus, AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { todayBs } from '@/lib/nepaliDate'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { ItemForm } from '@/components/forms/OtherForms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'

function StockAdjustmentForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, saveStockAdjustment } = useAppStore()
  const [dateBs, setDateBs] = useState(todayBs())
  const [itemId, setItemId] = useState('')
  const [qtyDelta, setQtyDelta] = useState('')
  const [rate, setRate] = useState('')
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    setSaving(true)
    try {
      await saveStockAdjustment({ item_id: itemId, qty_delta: Number(qtyDelta), rate: Number(rate) || 0, narration: narration.trim(), date_bs: dateBs })
      setItemId('')
      setQtyDelta('')
      setRate('')
      setNarration('')
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Stock Adjustment</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <NepaliDateInput value={dateBs} onChange={setDateBs} />
          </div>
          <div className="space-y-1.5">
            <Label>Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
              <SelectContent>
                {items.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Qty Change</Label>
              <Input type="number" step="any" value={qtyDelta} onChange={e => setQtyDelta(e.target.value)} placeholder="-2 or 5" />
            </div>
            <div className="space-y-1.5">
              <Label>Rate</Label>
              <Input type="number" step="any" value={rate} onChange={e => setRate(e.target.value)} placeholder="Cost rate" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea value={narration} onChange={e => setNarration(e.target.value)} rows={2} placeholder="Damage, found stock, correction..." />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Adjustment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ItemsPage() {
  const { items, stock } = useAppStore()
  const [showForm, setShowForm] = useState(false)
  const [showAdjustment, setShowAdjustment] = useState(false)

  const rows = items
    .map(item => ({ item, s: stock.find(e => e.id === item.id) ?? { qty: 0, avg_cost: 0, value: 0 } }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name))

  return (
    <div>
      <PageHeader
        title="Items & Stock"
        description="Inventory tracked at weighted-average cost"
        action={<div className="flex gap-2"><Button variant="outline" onClick={() => setShowAdjustment(true)}>Stock Adjustment</Button><Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1.5" />New Item</Button></div>}
      />
      <PageContent>
        <Card>
          {rows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-3xl mb-3 opacity-30">▣</p>
              <p className="font-medium text-foreground">No items yet</p>
              <p className="text-sm mt-1">Add an item to start tracking stock and generating invoices.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/50">
                    {['Item', 'Unit', 'Stock Qty', 'Avg Cost', 'Stock Value', 'Sell Rate', ''].map(h => (
                      <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground ${h && h !== 'Item' && h !== '' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, s }) => {
                    const isLow = item.reorder_level != null && s.qty <= item.reorder_level
                    return (
                      <tr key={item.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-semibold">
                          <span className="flex items-center gap-2">
                            {item.name}
                            {isLow && (
                              <Badge variant="outline" className="border-amber-300 text-amber-600 text-xs">
                                <AlertTriangle className="h-3 w-3 mr-1" />Low
                              </Badge>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                        <td className="px-4 py-3 text-right num font-semibold">{s.qty}</td>
                        <td className="px-4 py-3 text-right num">{fmtMoney(s.avg_cost)}</td>
                        <td className="px-4 py-3 text-right num font-semibold">{fmtMoney(s.value)}</td>
                        <td className="px-4 py-3 text-right num text-muted-foreground">{item.sell_rate ? fmtMoney(item.sell_rate) : '—'}</td>
                        <td className="px-4 py-3 w-12"></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td className="px-4 py-3" colSpan={4}>Total Stock Value</td>
                    <td className="px-4 py-3 text-right num">{fmtMoney(rows.reduce((s, r) => s + r.s.value, 0))}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </PageContent>
      <ItemForm open={showForm} onClose={() => setShowForm(false)} />
      <StockAdjustmentForm open={showAdjustment} onClose={() => setShowAdjustment(false)} />
    </div>
  )
}
