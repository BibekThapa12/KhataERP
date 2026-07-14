import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { addDaysToBs, todayBs } from '@/lib/nepaliDate'
import { formatStockQuantity, fromBaseRate, toBaseQty, toBaseRate, unitFactor, unitName, type UnitMode } from '@/lib/units'
import { partyTerminology } from '@/lib/partyTerminology'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { PartyForm } from './PartyForm'
import { ItemForm } from './OtherForms'
import type { Voucher } from '@/types'

interface LineItem { item_id: string; qty: number; rate: number; unit_mode: UnitMode; entry_unit?: string; conversion_factor?: number }

function round2Local(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100 }

interface InvoiceFormProps {
  type: 'Sales' | 'Purchase'
  open: boolean
  onClose: () => void
  voucher?: Voucher | null
}

export function InvoiceForm({ type, open, onClose, voucher }: InvoiceFormProps) {
  const isSales = type === 'Sales'
  const { company, items, parties, getStockEntry, saveSalesVoucher, savePurchaseVoucher, updateSalesVoucher, updatePurchaseVoucher } = useAppStore()
  const vatEnabled = company?.vat_enabled ?? true

  const [dateBs, setDateBs] = useState(todayBs())
  const [isCash, setIsCash] = useState(false)
  const [partyAccountId, setPartyAccountId] = useState('')
  const [creditDays, setCreditDays] = useState(0)
  const [lines, setLines] = useState<LineItem[]>([{ item_id: '', qty: 1, rate: 0, unit_mode: 'main' }])
  const [vatRate, setVatRate] = useState(13)
  const [discount, setDiscount] = useState(0)
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPartyForm, setShowPartyForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [newItemLineIdx, setNewItemLineIdx] = useState<number | null>(null)

  const partyType = isSales ? 'customer' : 'supplier'
  const partyTerms = partyTerminology(partyType)
  const partyList = parties.filter(p => p.type === partyType && !p.is_archived)
  const isEditing = !!voucher
  const dueDateBs = (() => {
    try { return addDaysToBs(dateBs, isCash ? 0 : creditDays) } catch { return '' }
  })()

  // Totals
  const subtotal = round2Local(lines.reduce((s, l) => s + l.qty * l.rate, 0))
  const taxable = round2Local(subtotal - discount)
  const effectiveVatRate = vatEnabled ? vatRate : 0
  const vatAmount = round2Local(taxable * (effectiveVatRate / 100))
  const total = round2Local(taxable + vatAmount)

  useEffect(() => {
    if (open && voucher) {
      setDateBs(voucher.date_bs)
      setIsCash(voucher.is_cash)
      setPartyAccountId(voucher.party_account_id || '')
      const voucherParty = parties.find(party => party.account_id === voucher.party_account_id)
      setCreditDays(voucher.is_cash ? 0 : (voucher.credit_days ?? voucherParty?.default_credit_days ?? 0))
      setLines((voucher.invoice_items || []).map(i => {
        const item = items.find(entry => entry.id === i.item_id)
        const factor = i.conversion_factor || 1
        return { item_id: i.item_id, qty: i.qty, rate: i.rate, unit_mode: factor > 1 ? 'alternate' : 'main', entry_unit: i.entry_unit || i.unit || item?.unit, conversion_factor: factor }
      }))
      setVatRate(vatEnabled ? (voucher.vat_rate ?? 13) : 0)
      setDiscount(voucher.discount ?? 0)
      setNarration(voucher.narration ?? '')
      setError('')
    } else if (!open) {
      setDateBs(todayBs()); setIsCash(false); setPartyAccountId(''); setCreditDays(0)
      setLines([{ item_id: '', qty: 1, rate: 0, unit_mode: 'main' }]); setVatRate(vatEnabled ? 13 : 0)
      setDiscount(0); setNarration(''); setError('')
    }
  }, [open, voucher, vatEnabled, items, parties])

  const selectParty = (accountId: string) => {
    setPartyAccountId(accountId)
    setCreditDays(parties.find(party => party.account_id === accountId)?.default_credit_days ?? 0)
  }

  const toggleCash = (checked: boolean) => {
    setIsCash(checked)
    setCreditDays(checked ? 0 : (parties.find(party => party.account_id === partyAccountId)?.default_credit_days ?? 0))
  }

  const updateLine = (idx: number, field: keyof LineItem, value: string | number) => {
    const next = [...lines]
    if (field === 'item_id') {
      const item = items.find(i => i.id === value)
      next[idx] = { ...next[idx], item_id: value as string, unit_mode: 'main', entry_unit: item?.unit, conversion_factor: 1 }
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

  const updateUnit = (idx: number, mode: UnitMode) => {
    const next = [...lines]
    const line = next[idx]
    const item = items.find(entry => entry.id === line.item_id)
    const oldFactor = line.conversion_factor || unitFactor(item, line.unit_mode)
    const baseRate = toBaseRate(line.rate, oldFactor)
    const factor = unitFactor(item, mode)
    next[idx] = { ...line, unit_mode: mode, entry_unit: unitName(item, mode), conversion_factor: factor, rate: fromBaseRate(baseRate, factor) }
    setLines(next)
  }

  const handleSave = async () => {
    setError('')
    const validLines = lines.filter(l => l.item_id && l.qty > 0 && l.rate > 0)
    if (validLines.length === 0) { setError('Add at least one item with quantity and rate.'); return }
    if (!isCash && !partyAccountId) { setError(`Select a ${partyTerms.singular} or check "Cash".`); return }
    if (!Number.isInteger(creditDays) || creditDays < 0) { setError('Credit Days must be a whole number of 0 or more.'); return }

    if (isSales) {
      const requestedByItem = new Map<string, number>()
      for (const line of validLines) requestedByItem.set(line.item_id, (requestedByItem.get(line.item_id) || 0) + toBaseQty(line.qty, line.conversion_factor || 1))
      for (const [itemId, requestedBaseQty] of requestedByItem) {
        const s = getStockEntry(itemId)
        const currentVoucherQty = voucher?.stock_lines
          ?.filter(sl => sl.item_id === itemId && sl.direction === 'out')
          .reduce((sum, sl) => sum + sl.qty, 0) ?? 0
        if (s.qty + currentVoucherQty < requestedBaseQty) {
          const item = items.find(i => i.id === itemId)
          setError(`Not enough stock for "${item?.name}": have ${item ? formatStockQuantity(s.qty + currentVoucherQty, item) : s.qty}, selling ${requestedBaseQty} ${item?.unit || ''}.`)
          return
        }
      }
    }

    setSaving(true)
    try {
      const params = { party_account_id: partyAccountId || null, is_cash: isCash, items: validLines.map(({ unit_mode: _mode, ...line }) => line), vat_rate: effectiveVatRate, credit_days: isCash ? 0 : creditDays, discount, narration: narration.trim(), date_bs: dateBs }
      if (isSales) {
        if (voucher) await updateSalesVoucher(voucher.id, params)
        else await saveSalesVoucher(params)
      } else {
        if (voucher) await updatePurchaseVoucher(voucher.id, params)
        else await savePurchaseVoucher(params)
      }
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
            <DialogTitle>{isEditing ? 'Edit' : 'New'} {type === 'Sales' ? 'Sales Invoice' : 'Purchase Bill'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Date + payment mode */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <NepaliDateInput value={dateBs} onChange={setDateBs} />
              </div>
              <div className="flex items-end pb-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id={`${type.toLowerCase()}-cash-mode`} checked={isCash} onChange={event => toggleCash(event.target.checked)} className="h-4 w-4 shrink-0 rounded accent-primary" />
                  <Label htmlFor={`${type.toLowerCase()}-cash-mode`} className="cursor-pointer font-normal">{isSales ? 'Cash sale' : 'Cash purchase'}</Label>
                </div>
              </div>
            </div>

            {!isCash && <div className="min-w-0 space-y-1.5">
              <Label>{partyTerms.singular}</Label>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
                <SearchableSelect className="min-w-0" value={partyAccountId} onValueChange={selectParty} placeholder={`Select ${partyTerms.singular}...`} searchPlaceholder={`Search ${partyTerms.plural}...`} options={partyList.map(p => ({ value: p.account_id, label: p.name, searchText: `${p.phone || ''} ${p.pan_vat || ''} ${p.address || ''} ${p.type} ${partyTerms.searchAliases}` }))} />
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setShowPartyForm(true)}><Plus className="mr-1 h-3.5 w-3.5" />New</Button>
              </div>
            </div>}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Credit Days</Label>
                <Input type="number" min="0" step="1" value={isCash ? 0 : creditDays} disabled={isCash} onChange={e => setCreditDays(Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">This invoice only; the party default is unchanged.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input value={dueDateBs} readOnly className="bg-muted/40" />
                <p className="text-xs text-muted-foreground">Invoice date + credit days (B.S.)</p>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="mb-1.5 hidden grid-cols-[2fr_0.7fr_0.8fr_1fr_1fr_auto] gap-2 md:grid">
                {['Item', 'Qty', 'Unit', 'Rate', 'Amount', ''].map(h => (
                  <p key={h} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</p>
                ))}
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => {
                  const amt = round2Local(line.qty * line.rate)
                  const stock = line.item_id ? getStockEntry(line.item_id) : null
                  return (
                    <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border p-2 md:grid-cols-[2fr_0.7fr_0.8fr_1fr_1fr_auto] md:items-start md:border-0 md:p-0">
                      <div className="col-span-2 flex gap-1 md:col-span-1">
                        <SearchableSelect value={line.item_id} onValueChange={v => updateLine(idx, 'item_id', v)} placeholder="Select item…" searchPlaceholder="Search name, SKU or barcode…" options={items.filter(i => !i.is_archived).map(i => ({ value: i.id, label: `${i.name} ${isSales ? `(${formatStockQuantity(getStockEntry(i.id).qty, i)})` : `(${i.unit}${i.alternate_unit ? ` / ${i.alternate_unit}` : ''})`}`, searchText: `${i.sku || ''} ${i.barcode || ''} ${i.unit} ${i.alternate_unit || ''}` }))} />
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => { setNewItemLineIdx(idx); setShowItemForm(true) }}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="space-y-1"><Label className="text-xs md:hidden">Qty</Label>
                        <Input type="number" min="0.01" step="any" value={line.qty || ''} onChange={e => updateLine(idx, 'qty', e.target.value)} placeholder="Qty" />
                        {isSales && stock && stock.qty < toBaseQty(line.qty, line.conversion_factor || 1) && line.qty > 0 && (
                          <p className="text-xs text-destructive mt-0.5">Only {items.find(item => item.id === line.item_id) ? formatStockQuantity(stock.qty, items.find(item => item.id === line.item_id)!) : stock.qty} in stock</p>
                        )}
                      </div>
                      <div className="space-y-1"><Label className="text-xs md:hidden">Unit</Label>{(() => {
                        const item = items.find(entry => entry.id === line.item_id)
                        const snapshotMatchesCurrent = line.unit_mode === 'main'
                          ? !line.entry_unit || line.entry_unit === item?.unit
                          : line.entry_unit === item?.alternate_unit
                        return item?.alternate_unit && snapshotMatchesCurrent
                          ? <SearchableSelect value={line.unit_mode} onValueChange={value => updateUnit(idx, value as UnitMode)} options={[{ value: 'main', label: item.unit }, { value: 'alternate', label: item.alternate_unit }]} />
                          : <div className="h-9 flex items-center text-sm text-muted-foreground">{line.entry_unit || item?.unit || '-'}</div>
                      })()}</div>
                      <div className="space-y-1"><Label className="text-xs md:hidden">Rate</Label><Input type="number" min="0" step="any" value={line.rate || ''} onChange={e => updateLine(idx, 'rate', e.target.value)} placeholder="Rate" /></div>
                      <div className="space-y-1"><Label className="text-xs md:hidden">Amount</Label><div className="flex h-9 items-center num font-semibold text-sm">{fmtMoney(amt)}</div></div>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 self-end text-muted-foreground hover:text-destructive md:self-auto" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setLines([...lines, { item_id: '', qty: 1, rate: 0, unit_mode: 'main' }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add line
              </Button>
            </div>

            {/* VAT + Discount */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Discount (Rs, flat)</Label>
                <Input type="number" min="0" step="any" value={discount || ''} onChange={e => setDiscount(Number(e.target.value))} placeholder="0" />
              </div>
              {vatEnabled && (
                <div className="space-y-1.5">
                  <Label>VAT Rate</Label>
                  <SearchableSelect value={String(vatRate)} onValueChange={v => setVatRate(Number(v))} options={[{ value: '13', label: '13% (Standard)' }, { value: '0', label: '0% (Exempt)' }]} />
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="num">{fmtMoney(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="num">- {fmtMoney(discount)}</span></div>
              {vatEnabled && <div className="flex justify-between"><span className="text-muted-foreground">VAT ({effectiveVatRate}%)</span><span className="num">{fmtMoney(vatAmount)}</span></div>}
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
              {saving ? 'Saving...' : `${isEditing ? 'Update' : 'Save'} ${type === 'Sales' ? 'Invoice' : 'Bill'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PartyForm open={showPartyForm} onClose={() => setShowPartyForm(false)} defaultType={partyType}
        onCreated={p => { setPartyAccountId(p.account_id); setCreditDays(p.default_credit_days ?? 0); setShowPartyForm(false) }} />
      <ItemForm open={showItemForm} onClose={() => setShowItemForm(false)}
        onCreated={(item: import('@/types').Item) => {
          if (newItemLineIdx !== null) {
            const next = [...lines]
            next[newItemLineIdx] = { ...next[newItemLineIdx], item_id: item.id, rate: item.sell_rate || 0, unit_mode: 'main', entry_unit: item.unit, conversion_factor: 1 }
            setLines(next)
          }
          setShowItemForm(false)
        }} />
    </>
  )
}
