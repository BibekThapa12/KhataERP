import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney, todayISO } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { PartyForm } from './PartyForm'
import { ItemForm } from './OtherForms'

interface LineItem { item_id: string; qty: number; rate: number }

function round2Local(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100 }

interface InvoiceFormProps {
  type: 'Sales' | 'Purchase'
  open: boolean
  onClose: () => void
}

export function InvoiceForm({ type, open, onClose }: InvoiceFormProps) {
  const isSales = type === 'Sales'
  const { items, parties, getStockEntry, saveSalesVoucher, savePurchaseVoucher } = useAppStore()

  const [date, setDate] = useState(todayISO())
  const [isCash, setIsCash] = useState(false)
  const [partyAccountId, setPartyAccountId] = useState('')
  const [lines, setLines] = useState<LineItem[]>([{ item_id: '', qty: 1, rate: 0 }])
  const [vatRate, setVatRate] = useState(13)
  const [discount, setDiscount] = useState(0)
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPartyForm, setShowPartyForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [newItemLineIdx, setNewItemLineIdx] = useState<number | null>(null)

  const partyType = isSales ? 'customer' : 'supplier'
  const partyList = parties.filter(p => p.type === partyType)

  // Totals
  const subtotal = round2Local(lines.reduce((s, l) => s + l.qty * l.rate, 0))
  const taxable = round2Local(subtotal - discount)
  const vatAmount = round2Local(taxable * (vatRate / 100))
  const total = round2Local(taxable + vatAmount)

  useEffect(() => {
    if (!open) {
      setDate(todayISO()); setIsCash(false); setPartyAccountId('')
      setLines([{ item_id: '', qty: 1, rate: 0 }]); setVatRate(13)
      setDiscount(0); setNarration(''); setError('')
    }
  }, [open])

  const updateLine = (idx: number, field: keyof LineItem, value: string | number) => {
    const next = [...lines]
    if (field === 'item_id') {
      next[idx] = { ...next[idx], item_id: value as string }
      if (!isSales) {
        const stock = getStockEntry(value as string)
        if (stock.avg_cost > 0) next[idx].rate = stock.avg_cost
        const item = items.find(i => i.id === value)
        if (item?.sell_rate && isSales) next[idx].rate = item.sell_rate
      } else {
        const item = items.find(i => i.id === value)
        if (item?.sell_rate) next[idx].rate = item.sell_rate
      }
    } else {
      next[idx] = { ...next[idx], [field]: Number(value) }
    }
    setLines(next)
  }

  const handleSave = async () => {
    setError('')
    const validLines = lines.filter(l => l.item_id && l.qty > 0 && l.rate > 0)
    if (validLines.length === 0) { setError('Add at least one item with quantity and rate.'); return }
    if (!isCash && !partyAccountId) { setError(`Select a ${partyType} or check "Cash".`); return }

    if (isSales) {
      for (const l of validLines) {
        const s = getStockEntry(l.item_id)
        if (s.qty < l.qty) {
          const item = items.find(i => i.id === l.item_id)
          setError(`Not enough stock for "${item?.name}": have ${s.qty}, selling ${l.qty}.`)
          return
        }
      }
    }

    setSaving(true)
    try {
      const params = { party_account_id: partyAccountId || null, is_cash: isCash, items: validLines, vat_rate: vatRate, discount, narration: narration.trim(), date }
      if (isSales) await saveSalesVoucher(params)
      else await savePurchaseVoucher(params)
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={o => !o && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New {type === 'Sales' ? 'Sales Invoice' : 'Purchase Bill'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Date + Party */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <input type="checkbox" id="isCash" checked={isCash} onChange={e => setIsCash(e.target.checked)} className="rounded" />
                  <Label htmlFor="isCash" className="font-normal cursor-pointer">
                    {isSales ? 'Cash sale' : 'Cash purchase'}
                  </Label>
                </div>
                {!isCash && (
                  <div className="flex gap-1.5">
                    <Select value={partyAccountId} onValueChange={setPartyAccountId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={`Select ${partyType}…`} />
                      </SelectTrigger>
                      <SelectContent>
                        {partyList.map(p => (
                          <SelectItem key={p.account_id} value={p.account_id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowPartyForm(true)}>+ New</Button>
                  </div>
                )}
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="grid grid-cols-[2fr_0.7fr_1fr_1fr_auto] gap-2 mb-1.5">
                {['Item', 'Qty', 'Rate', 'Amount', ''].map(h => (
                  <p key={h} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</p>
                ))}
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => {
                  const amt = round2Local(line.qty * line.rate)
                  const stock = line.item_id ? getStockEntry(line.item_id) : null
                  return (
                    <div key={idx} className="grid grid-cols-[2fr_0.7fr_1fr_1fr_auto] gap-2 items-start">
                      <div className="flex gap-1">
                        <Select value={line.item_id} onValueChange={v => updateLine(idx, 'item_id', v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select item…" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map(i => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.name} {isSales ? `(${getStockEntry(i.id).qty} ${i.unit})` : `(${i.unit})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => { setNewItemLineIdx(idx); setShowItemForm(true) }}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div>
                        <Input type="number" min="0.01" step="any" value={line.qty || ''} onChange={e => updateLine(idx, 'qty', e.target.value)} placeholder="Qty" />
                        {isSales && stock && stock.qty < line.qty && line.qty > 0 && (
                          <p className="text-xs text-destructive mt-0.5">Only {stock.qty} in stock</p>
                        )}
                      </div>
                      <Input type="number" min="0" step="any" value={line.rate || ''} onChange={e => updateLine(idx, 'rate', e.target.value)} placeholder="Rate" />
                      <div className="h-9 flex items-center num font-semibold text-sm">{fmtMoney(amt)}</div>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setLines([...lines, { item_id: '', qty: 1, rate: 0 }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add line
              </Button>
            </div>

            {/* VAT + Discount */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Discount (Rs, flat)</Label>
                <Input type="number" min="0" step="any" value={discount || ''} onChange={e => setDiscount(Number(e.target.value))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>VAT Rate</Label>
                <Select value={String(vatRate)} onValueChange={v => setVatRate(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="13">13% (Standard)</SelectItem>
                    <SelectItem value="0">0% (Exempt)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Totals */}
            <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="num">{fmtMoney(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="num">- {fmtMoney(discount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">VAT ({vatRate}%)</span><span className="num">{fmtMoney(vatAmount)}</span></div>
              <div className="flex justify-between font-serif font-bold text-base border-t border-border pt-2 mt-2">
                <span>Total</span><span className="num">{fmtMoney(total)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Narration (optional)</Label>
              <Textarea value={narration} onChange={e => setNarration(e.target.value)} placeholder="Note about this transaction…" rows={2} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : `Save ${type === 'Sales' ? 'Invoice' : 'Bill'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PartyForm open={showPartyForm} onClose={() => setShowPartyForm(false)} defaultType={partyType}
        onCreated={p => { setPartyAccountId(p.account_id); setShowPartyForm(false) }} />
      <ItemForm open={showItemForm} onClose={() => setShowItemForm(false)}
        onCreated={(item: import('@/types').Item) => {
          if (newItemLineIdx !== null) {
            const next = [...lines]
            next[newItemLineIdx] = { ...next[newItemLineIdx], item_id: item.id, rate: item.sell_rate || 0 }
            setLines(next)
          }
          setShowItemForm(false)
        }} />
    </>
  )
}
