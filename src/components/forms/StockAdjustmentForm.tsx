import { useEffect, useMemo, useRef, useState } from 'react'
import { Printer, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { todayBs } from '@/lib/nepaliDate'
import { stockConditionQuantity } from '@/lib/engine'
import { formatStockQuantity, fromBaseRate, toBaseQty, toBaseRate, unitFactor, unitName, type UnitMode } from '@/lib/units'
import { formatRateInput, rateInputNumber } from '@/lib/rateFormat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { publicErrorMessage } from '@/lib/security'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { VoucherNumberField } from '@/components/forms/VoucherNumberField'
import type { StockCondition, Voucher } from '@/types'
import { SubmissionLock } from '@/lib/submissionLock'
import { stableFormSnapshot, useUnsavedChangesGuard } from '@/lib/unsavedChanges'
import { beginVoucherPrint, cancelVoucherPrint, completeVoucherPrint, useVoucherShortcuts, type VoucherPrintRequest } from '@/lib/voucherShortcuts'

export function StockAdjustmentForm({ open, onClose, voucher }: { open: boolean; onClose: () => void; voucher?: Voucher | null }) {
  const { company, items, stock, vouchers, saveStockAdjustment, saveDraftVoucher, deleteDraftVoucher } = useAppStore()
  const [dateBs, setDateBs] = useState(() => selectedFiscalYearEndBs(company))
  const [mode, setMode] = useState<'adjustment' | 'transfer'>('adjustment')
  const [itemId, setItemId] = useState('')
  const [stockCondition, setStockCondition] = useState<StockCondition>('saleable')
  const [transferTo, setTransferTo] = useState<'damaged' | 'expired'>('damaged')
  const [unitMode, setUnitMode] = useState<UnitMode>('main')
  const [qtyDelta, setQtyDelta] = useState('')
  const [rate, setRate] = useState('')
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const itemTriggerRef = useRef<HTMLButtonElement | null>(null)
  const submissionLock = useRef(new SubmissionLock()).current
  const initializedFormRef = useRef<string | null>(null)
  const baselineRef = useRef('')
  const snapshotRef = useRef('')
  const workingDraftIdRef = useRef<string | undefined>(voucher?.status === 'Draft' ? voucher.id : undefined)
  const freshAfterDraftRef = useRef(false)
  const stockItems = useMemo(() => items.filter(item => !item.is_service), [items])
  const selectedItem = stockItems.find(item => item.id === itemId)
  const selectedStock = stock.find(entry => entry.id === itemId)
  const availableSaleable = itemId ? stockConditionQuantity(items, vouchers, itemId, 'saleable') : 0
  const conversionFactor = unitFactor(selectedItem, unitMode)
  const selectedUnit = unitName(selectedItem, unitMode)
  const availableInSelectedUnit = availableSaleable * conversionFactor

  useEffect(() => {
    const formIdentity = `StockAdjustment:${voucher?.id || 'new'}`
    if (!open) {
      initializedFormRef.current = null; baselineRef.current = ''; workingDraftIdRef.current = undefined; freshAfterDraftRef.current = false
      setDateBs(selectedFiscalYearEndBs(company)); setMode('adjustment'); setItemId(''); setStockCondition('saleable'); setTransferTo('damaged'); setUnitMode('main'); setQtyDelta(''); setRate(''); setNarration(''); setError('')
      return
    }
    if (initializedFormRef.current === formIdentity) return
    initializedFormRef.current = formIdentity
    baselineRef.current = ''
    workingDraftIdRef.current = voucher?.status === 'Draft' ? voucher.id : undefined
    freshAfterDraftRef.current = false
    if (voucher?.status === 'Draft') {
      const draft = voucher.draft_payload as Partial<{ dateBs:string; mode:'adjustment'|'transfer'; itemId:string; stockCondition:StockCondition; transferTo:'damaged'|'expired'; unitMode:UnitMode; qtyDelta:string; rate:string; narration:string }> | null
      setDateBs(draft?.dateBs || voucher.date_bs)
      setMode(draft?.mode || 'adjustment')
      setItemId(draft?.itemId || '')
      setStockCondition(draft?.stockCondition || 'saleable')
      setTransferTo(draft?.transferTo || 'damaged')
      setUnitMode(draft?.unitMode || 'main')
      setQtyDelta(draft?.qtyDelta || '')
      setRate(draft?.rate || '')
      setNarration(draft?.narration || voucher.narration || '')
      setError('')
    }
    window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
  }, [open, voucher, company])

  const formSnapshot = stableFormSnapshot({ dateBs, mode, itemId, stockCondition, transferTo, unitMode, qtyDelta, rate, narration })
  snapshotRef.current = formSnapshot
  const dirty = open && baselineRef.current !== '' && formSnapshot !== baselineRef.current
  const confirmDiscard = useUnsavedChangesGuard(open, dirty)

  const changeUnitMode = (nextMode: UnitMode) => {
    const previousFactor = unitFactor(selectedItem, unitMode)
    const nextFactor = unitFactor(selectedItem, nextMode)
    if (qtyDelta !== '' && Number.isFinite(Number(qtyDelta))) {
      const baseQuantity = toBaseQty(Number(qtyDelta), previousFactor)
      setQtyDelta(String(Number((baseQuantity * nextFactor).toFixed(4))))
    }
    if (rate !== '' && Number.isFinite(Number(rate))) {
      const baseRate = toBaseRate(rateInputNumber(rate), previousFactor)
      setRate(formatRateInput(fromBaseRate(baseRate, nextFactor)))
    }
    setUnitMode(nextMode)
  }

  const handleSave = async (status: 'Draft' | 'Completed' = 'Completed', shouldPrint = false) => {
    if (!submissionLock.tryAcquire()) return
    let printRequest: VoucherPrintRequest | undefined = shouldPrint ? beginVoucherPrint() : undefined
    setError('')
    setSaving(true)
    try {
      const baseQuantity = toBaseQty(mode === 'transfer' ? Math.abs(Number(qtyDelta)) : Number(qtyDelta), conversionFactor)
      const baseRate = mode === 'transfer' ? selectedStock?.avg_cost || 0 : toBaseRate(rateInputNumber(rate), conversionFactor)
      await saveStockAdjustment({ item_id: itemId, qty_delta: baseQuantity, rate: baseRate, narration: narration.trim(), date_bs: voucher?.status === 'Draft' ? todayBs() : dateBs, stock_condition: stockCondition, transfer_to: mode === 'transfer' ? transferTo : undefined }, status)
      const draftId = freshAfterDraftRef.current ? undefined : (voucher?.status === 'Draft' ? voucher.id : workingDraftIdRef.current)
      if (draftId) await deleteDraftVoucher(draftId)
      workingDraftIdRef.current = undefined
      completeVoucherPrint(printRequest, 'Stock Adjustment', voucher)
      printRequest = undefined
      onClose()
      setDateBs(selectedFiscalYearEndBs(company)); setMode('adjustment'); setItemId(''); setStockCondition('saleable'); setTransferTo('damaged'); setUnitMode('main'); setQtyDelta(''); setRate(''); setNarration(''); setError('')
    } catch (error: unknown) {
      cancelVoucherPrint(printRequest)
      setError(publicErrorMessage(error, 'saving stock adjustment'))
    } finally { submissionLock.release(); setSaving(false) }
  }

  useVoucherShortcuts({ open, disabled: saving, draftDisabled: saving, onSave: () => { void handleSave('Completed') }, onSaveAndPrint: () => { void handleSave('Completed', true) }, onSaveDraft: !voucher || voucher.status === 'Draft' ? () => { void handleSaveDraft() } : undefined })

  const handleSaveDraft = async () => {
    if (voucher && voucher.status !== 'Draft') {
      setError('Completed vouchers cannot be saved as draft.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveDraftVoucher({
        id: freshAfterDraftRef.current ? undefined : (workingDraftIdRef.current || (voucher?.status === 'Draft' ? voucher.id : undefined)),
        type: 'Stock Adjustment',
        date_bs: dateBs,
        narration: narration.trim(),
        total: Math.abs(Number(qtyDelta) || 0) * rateInputNumber(rate),
        draft_payload: { dateBs, mode, itemId, stockCondition, transferTo, unitMode, qtyDelta, rate, narration },
      })
      workingDraftIdRef.current = undefined; freshAfterDraftRef.current = true; baselineRef.current = ''
      setDateBs(selectedFiscalYearEndBs(company)); setMode('adjustment'); setItemId(''); setStockCondition('saleable'); setTransferTo('damaged'); setUnitMode('main'); setQtyDelta(''); setRate(''); setNarration(''); setError('')
      window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
    } catch (error: unknown) {
      setError(publicErrorMessage(error, 'saving stock adjustment draft'))
    } finally { setSaving(false) }
  }

  const handleDeleteDraft = async () => {
    if (voucher?.status !== 'Draft') return
    setSaving(true)
    try {
      await deleteDraftVoucher(voucher.id)
      onClose()
    } catch (error: unknown) {
      setError(publicErrorMessage(error, 'deleting stock adjustment draft'))
    } finally { setSaving(false) }
  }

  const canSaveDraft = !voucher || voucher.status === 'Draft'
  const completedEdit = !!voucher && voucher.status !== 'Draft'

  return <Dialog open={open} onOpenChange={value => { if (!value) void confirmDiscard().then(confirmed => { if (confirmed) onClose() }) }}>
    <DialogContent className="voucher-dialog max-w-2xl">
      <DialogHeader><DialogTitle>Stock Adjustment</DialogTitle></DialogHeader>
      <div className="space-y-4 py-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} min={selectedFiscalYearStartBs(company)} max={selectedFiscalYearEndBs(company)} /></div><VoucherNumberField type="Stock Adjustment" dateBs={dateBs} voucher={voucher} /></div>
        <div className="space-y-1.5"><Label>Adjustment Type</Label><SearchableSelect value={mode} onValueChange={value => setMode(value as typeof mode)} options={[{ value: 'adjustment', label: 'Quantity Adjustment' }, { value: 'transfer', label: 'Transfer Stock Condition' }]} /></div>
        <div className="space-y-1.5"><Label>Item</Label><SearchableSelect triggerRef={itemTriggerRef} autoFocus value={itemId} onValueChange={value => { setItemId(value); setUnitMode('main'); setQtyDelta(''); setRate('') }} placeholder="Select item" options={stockItems.filter(item => !item.is_archived).map(item => ({ value: item.id, label: item.name, searchText: `${item.sku || ''} ${item.barcode || ''} ${item.unit} ${item.alternate_unit || ''}` }))} /></div>
        {mode === 'adjustment' ? <><div className="space-y-1.5"><Label>Stock Condition</Label><SearchableSelect value={stockCondition} onValueChange={value => setStockCondition(value as StockCondition)} options={[{ value: 'saleable', label: 'Saleable' }, { value: 'damaged', label: 'Damage' }, { value: 'expired', label: 'Expired' }]} /></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="min-w-0 space-y-1.5"><Label>Qty Change</Label><Input type="number" step="any" value={qtyDelta} onChange={event => setQtyDelta(event.target.value)} placeholder="-2 or 5" /></div><div className="min-w-0 space-y-1.5"><Label>Unit</Label><SearchableSelect value={unitMode} disabled={!selectedItem?.alternate_unit} onValueChange={value => changeUnitMode(value as UnitMode)} options={[{ value: 'main', label: `${selectedItem?.unit || 'Main'} (Main)` }, ...(selectedItem?.alternate_unit && Number(selectedItem.alternate_conversion || 0) > 1 ? [{ value: 'alternate', label: `${selectedItem.alternate_unit} (Alternative)` }] : [])]} /></div><div className="min-w-0 space-y-1.5"><Label>Rate / {selectedUnit || 'Unit'}</Label><Input type="number" step="any" value={rate} onChange={event => setRate(event.target.value)} onBlur={() => setRate(current => formatRateInput(current))} placeholder="Cost rate" /></div></div></> : <><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="min-w-0 space-y-1.5"><Label>From</Label><Input value="Saleable" disabled /></div><div className="min-w-0 space-y-1.5"><Label>Destination</Label><SearchableSelect value={transferTo} onValueChange={value => setTransferTo(value as typeof transferTo)} options={[{ value: 'damaged', label: 'Damage' }, { value: 'expired', label: 'Expired' }]} /></div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.7fr)]"><div className="min-w-0 space-y-1.5"><Label>Transfer Quantity</Label><Input type="number" min="0" max={availableInSelectedUnit} step="any" value={qtyDelta} onChange={event => setQtyDelta(event.target.value)} placeholder="Quantity to transfer" /></div><div className="min-w-0 space-y-1.5"><Label>Unit</Label><SearchableSelect value={unitMode} disabled={!selectedItem?.alternate_unit} onValueChange={value => changeUnitMode(value as UnitMode)} options={[{ value: 'main', label: `${selectedItem?.unit || 'Main'} (Main)` }, ...(selectedItem?.alternate_unit && Number(selectedItem.alternate_conversion || 0) > 1 ? [{ value: 'alternate', label: `${selectedItem.alternate_unit} (Alternative)` }] : [])]} /></div></div><p className="text-xs text-muted-foreground">Available: {selectedItem ? formatStockQuantity(availableSaleable, selectedItem) : '0'}. Transferred at {fmtMoney(fromBaseRate(selectedStock?.avg_cost || 0, conversionFactor))} / {selectedUnit || 'unit'}.</p></>}
        <div className="space-y-1.5"><Label>Reason</Label><Textarea value={narration} onChange={event => setNarration(event.target.value)} rows={2} placeholder="Damage, found stock, correction..." /></div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter className="flex-row flex-wrap justify-end gap-2 space-x-0">
        {voucher?.status === 'Draft' && <Button variant="destructive" onClick={handleDeleteDraft} disabled={saving}><Trash2 className="mr-1 h-4 w-4" />Delete Draft</Button>}
        <Button variant="outline" onClick={() => void confirmDiscard().then(confirmed => { if (confirmed) onClose() })}>Cancel</Button>
        {canSaveDraft && <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving...' : voucher?.status === 'Draft' ? 'Update Draft' : 'Save as Draft'}{!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+D</kbd>}</Button>}
        <Button onClick={() => handleSave('Completed')} disabled={saving} title="Save voucher (Alt+S)">{saving ? 'Saving...' : completedEdit ? 'Save Changes' : 'Save Voucher'}{!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+S</kbd>}</Button>
        <Button variant="outline" onClick={() => handleSave('Completed', true)} disabled={saving} title="Save and print (Alt+P)"><Printer className="mr-1 h-4 w-4" />Save &amp; Print<kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+P</kbd></Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
