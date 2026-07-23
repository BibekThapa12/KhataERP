import { lazy, useState, useEffect, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { addDaysToBs } from '@/lib/nepaliDate'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { resolveSystemAccountId } from '@/lib/engine'
import { formatStockQuantity, fromBaseRate, toBaseQty, toBaseRate, unitFactor, unitName, type UnitMode } from '@/lib/units'
import { partyTerminology } from '@/lib/partyTerminology'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ItemForm } from './OtherForms'
import { LedgerBalanceHint } from './LedgerBalanceHint'
import { publicErrorMessage } from '@/lib/security'
import { VoucherNumberField } from './VoucherNumberField'
import { SubmissionLock } from '@/lib/submissionLock'
import type { Voucher } from '@/types'

const LedgerDialog = lazy(() => import('@/pages/Masters').then(module => ({ default: module.LedgerDialog })))

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
  const { company, accounts, items, parties, getStockEntry, saveSalesVoucher, savePurchaseVoucher, updateSalesVoucher, updatePurchaseVoucher } = useAppStore()
  const vatEnabled = company?.vat_enabled ?? true

  const [dateBs, setDateBs] = useState(() => selectedFiscalYearEndBs(company))
  const [isCash, setIsCash] = useState(false)
  const [partyAccountId, setPartyAccountId] = useState('')
  const [creditDays, setCreditDays] = useState(0)
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [lines, setLines] = useState<LineItem[]>([{ item_id: '', qty: 1, rate: 0, unit_mode: 'main' }])
  const [vatRate, setVatRate] = useState(13)
  const [discount, setDiscount] = useState(0)
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPartyForm, setShowPartyForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [newItemLineIdx, setNewItemLineIdx] = useState<number | null>(null)
  const partyTriggerRef = useRef<HTMLButtonElement | null>(null)
  const itemTriggerRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingLineFocus = useRef<number | null>(null)
  const submissionLock = useRef(new SubmissionLock()).current

  const partyType = isSales ? 'customer' : 'supplier'
  const partyTerms = partyTerminology(partyType)
  const partyList = parties.filter(p => p.type === partyType && !p.is_archived)
  const selectedParty = parties.find(party => party.account_id === partyAccountId)
  const selectedPartyAccount = accounts.find(account => account.id === partyAccountId)
  const cashAccountId = company ? resolveSystemAccountId(accounts, company.id, 'cash') : ''
  const cashAccount = accounts.find(account => account.id === cashAccountId)
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
      setSupplierInvoiceNo(voucher.supplier_invoice_no || '')
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
      setDateBs(selectedFiscalYearEndBs(company)); setIsCash(false); setPartyAccountId(''); setCreditDays(0); setSupplierInvoiceNo('')
      setLines([{ item_id: '', qty: 1, rate: 0, unit_mode: 'main' }]); setVatRate(vatEnabled ? 13 : 0)
      setDiscount(0); setNarration(''); setError('')
    }
  }, [open, voucher, vatEnabled, items, parties, company])

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

  const addLine = () => {
    pendingLineFocus.current = lines.length
    setLines(current => [...current, { item_id: '', qty: 1, rate: 0, unit_mode: 'main' }])
  }

  useEffect(() => {
    if (pendingLineFocus.current === null) return
    const index = pendingLineFocus.current
    pendingLineFocus.current = null
    const frame = window.requestAnimationFrame(() => itemTriggerRefs.current[index]?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [lines.length])

  const handleSave = async () => {
    setError('')
    const validLines = lines.filter(line => line.item_id && Number.isFinite(line.qty) && line.qty > 0 && Number.isFinite(line.rate) && line.rate >= 0)
    if (!lines.length || validLines.length !== lines.length) { setError('Select an item and enter a quantity greater than zero for every line. Rate can be zero but cannot be negative.'); return }
    if (!isCash && !partyAccountId) { setError(`Select a ${partyTerms.singular} or check "Cash".`); return }
    if (!Number.isInteger(creditDays) || creditDays < 0) { setError('Credit Days must be a whole number of 0 or more.'); return }
    if (!isSales && supplierInvoiceNo.trim().length > 100) { setError('Supplier Invoice No. cannot exceed 100 characters.'); return }

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

    if (!submissionLock.tryAcquire()) return
    setSaving(true)
    try {
      const params = { party_account_id: partyAccountId || null, is_cash: isCash, items: validLines.map(({ unit_mode: _mode, ...line }) => line), vat_rate: effectiveVatRate, credit_days: isCash ? 0 : creditDays, supplier_invoice_no: isSales ? undefined : supplierInvoiceNo.trim(), discount, narration: narration.trim(), date_bs: dateBs }
      if (isSales) {
        if (voucher) await updateSalesVoucher(voucher.id, params)
        else await saveSalesVoucher(params)
      } else {
        if (voucher) await updatePurchaseVoucher(voucher.id, params)
        else await savePurchaseVoucher(params)
      }
      if (voucher) {
        onClose()
      } else {
        setDateBs(selectedFiscalYearEndBs(company))
        setIsCash(false)
        setPartyAccountId('')
        setCreditDays(0)
        setSupplierInvoiceNo('')
        setLines([{ item_id: '', qty: 1, rate: 0, unit_mode: 'main' }])
        setVatRate(vatEnabled ? 13 : 0)
        setDiscount(0)
        setNarration('')
        setError('')
        itemTriggerRefs.current = []
        pendingLineFocus.current = null
        window.requestAnimationFrame(() => partyTriggerRef.current?.focus())
      }
    } catch (e: unknown) {
      setError(publicErrorMessage(e, `saving ${type.toLowerCase()} invoice`))
    } finally {
      submissionLock.release()
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={o => !o && onClose()}>
        <DialogContent className="voucher-dialog max-w-4xl md:left-[calc(50%+7rem)] md:w-[calc(100vw-15rem)]">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit' : 'New'} {type === 'Sales' ? 'Sales Invoice' : 'Purchase Bill'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Date + payment mode */}
            <div className="flex flex-wrap items-start gap-3">
              <div className="w-full space-y-1.5 sm:w-40">
                <Label>Date</Label>
                <NepaliDateInput value={dateBs} onChange={setDateBs} min={selectedFiscalYearStartBs(company)} max={selectedFiscalYearEndBs(company)} />
              </div>
              <VoucherNumberField type={type} dateBs={dateBs} voucher={voucher} className="w-full sm:w-48" />
              {!isSales && <div className="w-full space-y-1.5 sm:w-48">
                <Label>Supplier Invoice No.</Label>
                <Input value={supplierInvoiceNo} onChange={event => setSupplierInvoiceNo(event.target.value)} maxLength={100} placeholder="Physical bill number" />
              </div>}
              <div className="flex h-8 items-center sm:mt-[1.2rem]">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id={`${type.toLowerCase()}-cash-mode`} checked={isCash} onChange={event => toggleCash(event.target.checked)} className="h-4 w-4 shrink-0 rounded accent-primary" />
                  <Label htmlFor={`${type.toLowerCase()}-cash-mode`} className="cursor-pointer font-normal">{isSales ? 'Cash sale' : 'Cash purchase'}</Label>
                </div>
              </div>
            </div>

            {isCash && <LedgerBalanceHint account={cashAccount} />}

            <div className={`grid gap-3 ${isCash ? 'sm:grid-cols-[11rem_12rem]' : 'lg:grid-cols-[minmax(18rem,1fr)_11rem_12rem]'}`}>
              {!isCash && <div className="min-w-0 space-y-1.5">
                <Label>{partyTerms.singular}</Label>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <SearchableSelect triggerRef={partyTriggerRef} autoFocus className="min-w-0" value={partyAccountId} onValueChange={selectParty} placeholder={`Select ${partyTerms.singular}...`} searchPlaceholder={`Search ${partyTerms.plural}...`} options={partyList.map(p => ({ value: p.account_id, label: p.name, searchText: `${p.phone || ''} ${p.pan_vat || ''} ${p.address || ''} ${p.type} ${partyTerms.searchAliases}` }))} />
                  <Button type="button" variant="outline" size="sm" tabIndex={-1} className="shrink-0 bg-white hover:bg-white" onClick={() => setShowPartyForm(true)}><Plus className="mr-1 h-3.5 w-3.5" />New</Button>
                </div>
                <LedgerBalanceHint account={selectedPartyAccount} party={selectedParty} />
              </div>}
              <div className="min-w-0 space-y-1.5">
                <Label>Credit Days</Label>
                <Input type="number" min="0" step="1" value={isCash ? 0 : creditDays} disabled={isCash} onChange={e => setCreditDays(Number(e.target.value))} className="w-32" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>Due Date</Label>
                <Input value={dueDateBs} readOnly tabIndex={-1} className="w-44 !bg-[#f6f6f6]" />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="mb-1.5 hidden grid-cols-[minmax(0,2.55fr)_minmax(0,0.75fr)_minmax(0,0.55fr)_minmax(0,0.65fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_2rem] gap-1.5 lg:grid">
                {['Item', 'Av. Stock', 'Qty', 'Unit', 'Rate', 'Amount', ''].map(h => (
                  <p key={h} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</p>
                ))}
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => {
                  const amt = round2Local(line.qty * line.rate)
                  const stock = line.item_id ? getStockEntry(line.item_id) : null
                  return (
                    <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border p-2 lg:grid-cols-[minmax(0,2.55fr)_minmax(0,0.75fr)_minmax(0,0.55fr)_minmax(0,0.65fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_2rem] lg:items-start lg:gap-1.5 lg:border-0 lg:p-0">
                      <div className="col-span-2 flex min-w-0 gap-1 lg:col-span-1">
                        <SearchableSelect triggerRef={element => { itemTriggerRefs.current[idx] = element }} autoFocus={isCash && idx === 0} value={line.item_id} onValueChange={v => updateLine(idx, 'item_id', v)} placeholder="Select item…" searchPlaceholder="Search name, SKU or barcode…" options={items.filter(i => !i.is_archived).map(i => ({ value: i.id, label: `${i.name} (${i.unit}${i.alternate_unit ? ` / ${i.alternate_unit}` : ''})`, searchText: `${i.sku || ''} ${i.barcode || ''} ${i.unit} ${i.alternate_unit || ''}` }))} />
                        <Button type="button" variant="outline" size="icon" tabIndex={-1} className="h-8 w-8 flex-shrink-0 bg-white hover:bg-white" onClick={() => { setNewItemLineIdx(idx); setShowItemForm(true) }}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="col-span-2 min-w-0 space-y-1 lg:col-span-1"><Label className="text-xs lg:hidden">Av. Stock</Label><div className={`flex min-h-8 min-w-0 items-center whitespace-normal break-words text-[11px] leading-tight ${stock && stock.qty < 0 ? 'text-destructive' : 'text-muted-foreground'}`} title={stock && items.find(item => item.id === line.item_id) ? formatStockQuantity(stock.qty, items.find(item => item.id === line.item_id)!) : undefined}>{stock && items.find(item => item.id === line.item_id) ? formatStockQuantity(stock.qty, items.find(item => item.id === line.item_id)!) : '—'}</div></div>
                      <div className="space-y-1"><Label className="text-xs lg:hidden">Qty</Label>
                        <Input type="number" min="0.01" step="any" value={line.qty || ''} onChange={e => updateLine(idx, 'qty', e.target.value)} placeholder="Qty" className="invoice-entry-value h-8 px-2" />
                        {isSales && stock && stock.qty < toBaseQty(line.qty, line.conversion_factor || 1) && line.qty > 0 && (
                          <p className="text-xs text-destructive mt-0.5">Only {items.find(item => item.id === line.item_id) ? formatStockQuantity(stock.qty, items.find(item => item.id === line.item_id)!) : stock.qty} in stock</p>
                        )}
                      </div>
                      <div className="space-y-1"><Label className="text-xs lg:hidden">Unit</Label>{(() => {
                        const item = items.find(entry => entry.id === line.item_id)
                        const snapshotMatchesCurrent = line.unit_mode === 'main'
                          ? !line.entry_unit || line.entry_unit === item?.unit
                          : line.entry_unit === item?.alternate_unit
                        return item?.alternate_unit && snapshotMatchesCurrent
                          ? <SearchableSelect tabIndex={-1} className="invoice-entry-value h-8 px-2" value={line.unit_mode} onValueChange={value => updateUnit(idx, value as UnitMode)} options={[{ value: 'main', label: item.unit }, { value: 'alternate', label: item.alternate_unit }]} />
                          : <div className="invoice-entry-value flex h-8 items-center truncate text-muted-foreground">{line.entry_unit || item?.unit || '-'}</div>
                      })()}</div>
                      <div className="space-y-1"><Label className="text-xs lg:hidden">Rate</Label><Input type="number" min="0" step="any" value={Number.isFinite(line.rate) ? line.rate : ''} onChange={e => updateLine(idx, 'rate', e.target.value)} placeholder="Rate" className="invoice-entry-value h-8 px-2" /></div>
                      <div className="min-w-0 space-y-1"><Label className="text-xs lg:hidden">Amount</Label><div className="invoice-entry-value flex h-8 min-w-0 items-center whitespace-nowrap num font-semibold">{fmtMoney(amt)}</div></div>
                      <Button type="button" variant="ghost" size="icon" tabIndex={-1} className="h-8 w-8 self-end text-muted-foreground hover:text-destructive lg:self-auto" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2 bg-white hover:bg-white" onClick={addLine}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add line
              </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-[21.75rem_minmax(18rem,1fr)]">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap gap-3">
                  <div className="w-full space-y-1.5 sm:w-40">
                    <Label>Discount (Rs, flat)</Label>
                    <Input type="number" min="0" step="any" value={discount || ''} onChange={e => setDiscount(Number(e.target.value))} placeholder="0" />
                  </div>
                  {vatEnabled && (
                    <div className="w-full space-y-1.5 sm:w-44">
                      <Label>VAT Rate</Label>
                      <SearchableSelect tabIndex={-1} value={String(vatRate)} onValueChange={v => setVatRate(Number(v))} options={[{ value: '13', label: '13% (Standard)' }, { value: '0', label: '0% (Exempt)' }]} />
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Narration (optional)</Label>
                  <Textarea value={narration} onChange={e => setNarration(e.target.value)} placeholder="Note about this transaction…" rows={2} />
                </div>
              </div>

              <div className="h-full space-y-2 rounded-lg bg-[#f6f6f6] p-3 text-[14px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="num font-medium">{fmtMoney(subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="num font-medium">- {fmtMoney(discount)}</span></div>
                {vatEnabled && <div className="flex justify-between"><span className="text-muted-foreground">VAT ({effectiveVatRate}%)</span><span className="num font-medium">{fmtMoney(vatAmount)}</span></div>}
                <div className="mt-2 flex justify-between border-t border-border pt-2 font-serif text-[16px] font-bold">
                  <span>Total</span><span className="num">{fmtMoney(total)}</span>
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" tabIndex={-1} onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : `${isEditing ? 'Update' : 'Save'} ${type === 'Sales' ? 'Invoice' : 'Bill'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showPartyForm && <LedgerDialog open onClose={() => setShowPartyForm(false)} defaultPartyType={partyType}
        onCreated={(account, party) => { setPartyAccountId(account.id); setCreditDays(party?.default_credit_days ?? account.credit_days ?? 0); setShowPartyForm(false) }} />}
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
