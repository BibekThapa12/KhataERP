import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Archive, Pencil, Plus, Printer, RotateCcw, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { cn, fmtDate, fmtMoney } from '@/lib/utils'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs, vouchersInFiscalYear } from '@/lib/reports'
import { todayBs } from '@/lib/nepaliDate'
import { normalizeSearch } from '@/lib/search'
import { stockConditionQuantity } from '@/lib/engine'
import { formatStockQuantity, fromBaseRate, toBaseQty, toBaseRate, unitFactor, unitName, type UnitMode } from '@/lib/units'
import { formatRateInput, rateInputNumber } from '@/lib/rateFormat'
import { buildCategoryTree, categoryPath } from '@/lib/categoryHierarchy'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { ItemForm } from '@/components/forms/OtherForms'
import { ItemDialog, CategoryDialog, CategoryLegend, CategoryTable } from '@/pages/Masters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge, Textarea } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { publicErrorMessage } from '@/lib/security'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { VoucherNumberField } from '@/components/forms/VoucherNumberField'
import type { Item, ItemCategory, StockCondition, Voucher } from '@/types'
import { SubmissionLock } from '@/lib/submissionLock'
import { stableFormSnapshot, useUnsavedChangesGuard } from '@/lib/unsavedChanges'
import { beginVoucherPrint, cancelVoucherPrint, completeVoucherPrint, useVoucherShortcuts, type VoucherPrintRequest } from '@/lib/voucherShortcuts'

type StatusFilter = 'all' | 'active' | 'inactive'

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
      initializedFormRef.current = null; baselineRef.current = ''
      setDateBs(selectedFiscalYearEndBs(company)); setMode('adjustment'); setItemId(''); setStockCondition('saleable'); setTransferTo('damaged'); setUnitMode('main'); setQtyDelta(''); setRate(''); setNarration(''); setError('')
      return
    }
    if (initializedFormRef.current === formIdentity) return
    initializedFormRef.current = formIdentity
    baselineRef.current = ''
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
      if (voucher?.status === 'Draft') await deleteDraftVoucher(voucher.id)
      completeVoucherPrint(printRequest, 'Stock Adjustment', voucher)
      printRequest = undefined
      onClose()
      setDateBs(selectedFiscalYearEndBs(company)); setMode('adjustment'); setItemId(''); setStockCondition('saleable'); setTransferTo('damaged'); setUnitMode('main'); setQtyDelta(''); setRate(''); setNarration(''); setError('')
    } catch (error: unknown) {
      cancelVoucherPrint(printRequest)
      setError(publicErrorMessage(error, 'saving stock adjustment'))
    } finally { submissionLock.release(); setSaving(false) }
  }

  useVoucherShortcuts({ open, disabled: saving, onSave: () => { void handleSave('Completed') }, onSaveAndPrint: () => { void handleSave('Completed', true) } })

  const handleSaveDraft = async () => {
    if (voucher && voucher.status !== 'Draft') {
      setError('Completed vouchers cannot be saved as draft.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveDraftVoucher({
        id: voucher?.status === 'Draft' ? voucher.id : undefined,
        type: 'Stock Adjustment',
        date_bs: dateBs,
        narration: narration.trim(),
        total: Math.abs(Number(qtyDelta) || 0) * rateInputNumber(rate),
        draft_payload: { dateBs, mode, itemId, stockCondition, transferTo, unitMode, qtyDelta, rate, narration },
      })
      onClose()
      setDateBs(selectedFiscalYearEndBs(company)); setMode('adjustment'); setItemId(''); setStockCondition('saleable'); setTransferTo('damaged'); setUnitMode('main'); setQtyDelta(''); setRate(''); setNarration(''); setError('')
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

  return <Dialog open={open} onOpenChange={value => { if (!value && confirmDiscard()) onClose() }}>
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
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {canSaveDraft && <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving...' : voucher?.status === 'Draft' ? 'Update Draft' : 'Save as Draft'}</Button>}
        <Button onClick={() => handleSave('Completed')} disabled={saving} title="Save voucher (Alt+S)">{saving ? 'Saving...' : completedEdit ? 'Save Changes' : 'Save Voucher'}{!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+S</kbd>}</Button>
        <Button variant="outline" onClick={() => handleSave('Completed', true)} disabled={saving} title="Save and print (Alt+P)"><Printer className="mr-1 h-4 w-4" />Save &amp; Print<kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+P</kbd></Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

export function ItemsPage() {
  const { company, items, stock, itemCategories, vouchers, loading, error, alterItem, alterItemCategory } = useAppStore()
  const [tab, setTab] = useState('items')
  const [searchByTab, setSearchByTab] = useState<Record<string, string>>({ items: '', adjustments: '' })
  const [status, setStatus] = useState<StatusFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [editingAdjustment, setEditingAdjustment] = useState<Voucher | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ category?: ItemCategory; parentCategory?: ItemCategory } | null>(null)
  const search = searchByTab[tab] || ''
  const query = normalizeSearch(search)
  const itemTree = useMemo(() => buildCategoryTree(itemCategories, items), [itemCategories, items])
  const itemRows = useMemo(() => items.filter(item => {
    const statusMatches = status === 'all' || (status === 'inactive' ? !!item.is_archived : !item.is_archived)
    const searchMatches = !query || normalizeSearch(`${item.name} ${categoryPath(itemCategories, item.category_id)} ${item.unit} ${item.alternate_unit || ''} ${item.sku || ''} ${item.barcode || ''} ${item.is_service ? 'service' : ''} ${item.is_archived ? 'inactive archived' : 'active'}`).includes(query)
    return statusMatches && searchMatches
  }).map(item => {
    const total = stock.find(entry => entry.id === item.id) || { qty: 0, avg_cost: 0, value: 0 }
    const qty = item.is_service ? 0 : stockConditionQuantity(items, vouchers, item.id, 'saleable')
    return { item, stock: { ...total, qty, value: qty * total.avg_cost } }
  }).sort((left, right) => left.item.name.localeCompare(right.item.name)), [items, stock, vouchers, itemCategories, status, query])
  const adjustments = useMemo(() => vouchersInFiscalYear(vouchers, selectedFiscalYearStartBs(company)).filter(voucher => voucher.type === 'Stock Adjustment').filter(voucher => {
    const line = voucher.stock_lines?.[0]
    const draft = voucher.status === 'Draft' ? voucher.draft_payload as Partial<{ itemId:string; mode:string; stockCondition:string; transferTo:string; narration:string }> | null : null
    const item = items.find(entry => entry.id === (line?.item_id || draft?.itemId))
    return !query || normalizeSearch(`${voucher.date_bs} ${item?.name || ''} ${voucher.narration || draft?.narration || ''} ${line?.direction || ''} ${draft?.mode || ''} ${draft?.stockCondition || ''} ${draft?.transferTo || ''} ${voucher.status === 'Draft' ? 'draft' : voucher.cancelled ? 'cancelled' : 'active'}`).includes(query)
  }).sort((left, right) => right.date_bs_key - left.date_bs_key || right.seq - left.seq), [company, vouchers, items, query])
  const stockDrafts = useMemo(() => adjustments.filter(voucher => voucher.status === 'Draft'), [adjustments])

  const setSearch = (value: string) => setSearchByTab(current => ({ ...current, [tab]: value }))

  return <div>
    <PageHeader title="Items & Stock" description="Items, categories, units, and inventory adjustments" />
    <PageContent className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="overflow-x-auto pb-1"><TabsList className="w-max"><TabsTrigger value="items">Items</TabsTrigger><TabsTrigger value="categories">Item Categories</TabsTrigger><TabsTrigger value="adjustments">Stock Adjustments</TabsTrigger></TabsList></div>
          {tab !== 'categories' && <div className="flex flex-wrap gap-2"><div className="relative min-w-0 flex-1 sm:flex-none"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder={tab === 'items' ? 'Search items...' : 'Search adjustments...'} className="w-full pl-8 sm:w-64" /></div>{tab === 'items' && <SearchableSelect value={status} onValueChange={value => setStatus(value as StatusFilter)} className="w-32" options={[{ value: 'all', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />}{tab === 'items' ? <Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 h-4 w-4" />New Item</Button> : <Button onClick={() => { setEditingAdjustment(null); setShowAdjustment(true) }}><SlidersHorizontal className="mr-1.5 h-4 w-4" />New Adjustment</Button>}</div>}
        </div>

        <TabsContent value="items">
          <Card className="overflow-hidden">{error ? <p className="p-4 text-sm text-destructive">{error}</p> : loading ? <div className="space-y-px bg-border">{[0, 1, 2, 3].map(index => <div key={index} className="h-12 animate-pulse bg-card p-3"><div className="h-3 w-1/2 rounded bg-muted" /></div>)}</div> : itemRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Item</th><th className="report-th text-left">Category</th><th className="report-th text-left">Units</th><th className="report-th text-right">Sell Rate</th><th className="report-th text-left">SKU / Barcode</th><th className="report-th text-left">Status</th><th className="report-th"></th></tr></thead><tbody>{itemRows.map(({ item, stock: current }) => {
            const low = !item.is_service && item.reorder_level != null && current.qty <= item.reorder_level
            return <tr key={item.id} className={cn('border-t transition-colors hover:bg-muted/30', item.is_archived && 'opacity-55')}><td className="report-td font-medium">{item.name}{item.is_service && <Badge variant="outline" className="ml-2 border-sky-200 text-sky-700">Service</Badge>}{low && <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700"><AlertTriangle className="mr-1 h-3 w-3" />Low</Badge>}</td><td className="report-td text-muted-foreground">{categoryPath(itemCategories, item.category_id) || 'General'}</td><td className="report-td">{item.is_service ? 'Service' : item.unit}{!item.is_service && item.alternate_unit && <span className="block text-xs text-muted-foreground">1 {item.unit} = {item.alternate_conversion} {item.alternate_unit}</span>}</td><td className="report-td text-right num">{fmtMoney(item.sell_rate)}</td><td className="report-td text-xs text-muted-foreground">{item.sku || '-'} / {item.barcode || '-'}</td><td className="report-td"><Badge variant={item.is_archived ? 'secondary' : 'default'}>{item.is_archived ? 'Inactive' : 'Active'}</Badge></td><td className="report-td"><div className="flex justify-end gap-1"><Button title="Edit item" variant="ghost" size="icon" onClick={() => setEditingItem(item)}><Pencil className="h-4 w-4" /></Button><Button title={item.is_archived ? 'Restore item' : 'Archive item'} variant="ghost" size="icon" onClick={() => alterItem(item.id, { is_archived: !item.is_archived })}>{item.is_archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button></div></td></tr>
          })}</tbody></table></div> : <div className="py-16 text-center"><p className="font-medium">{search || status !== 'all' ? 'No matching items' : 'No items yet'}</p><p className="mt-1 text-sm text-muted-foreground">{search || status !== 'all' ? 'Try changing the search or status filter.' : 'Add an item to start tracking inventory.'}</p></div>}</Card>
        </TabsContent>

        <TabsContent value="categories"><div className="space-y-4"><CategoryTable kind="item" title="Item Categories" rows={itemTree} loading={loading} error={error} onAdd={() => setCategoryDialog({})} onAddChild={parentCategory => setCategoryDialog({ parentCategory: parentCategory as ItemCategory })} onEdit={category => setCategoryDialog({ category: category as ItemCategory })} onArchive={category => alterItemCategory(category.id, { is_archived: !category.is_archived })} /><CategoryLegend kind="item" /></div></TabsContent>

        <TabsContent value="adjustments"><div className="space-y-3">{stockDrafts.length > 0 && <Card className="overflow-hidden border-amber-200"><div className="border-b bg-amber-50/60 px-4 py-3"><p className="font-medium text-amber-900">Draft Stock Vouchers</p><p className="text-sm text-amber-800">Edit a draft to update, delete, or complete the stock adjustment or stock transfer.</p></div><div className="divide-y">{stockDrafts.map(draftVoucher => {
          const draft = draftVoucher.draft_payload as Partial<{ itemId:string; mode:'adjustment'|'transfer'; stockCondition:StockCondition; transferTo:'damaged'|'expired'; qtyDelta:string; narration:string }> | null
          const item = items.find(entry => entry.id === draft?.itemId)
          const movement = draft?.mode === 'transfer' ? `Saleable -> ${(draft.transferTo || 'damaged').replace(/^./, value => value.toUpperCase())}` : (draft?.stockCondition || 'saleable').replace(/^./, value => value.toUpperCase())
          return <div key={draftVoucher.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="bg-amber-100 text-amber-800">Draft</Badge><span className="font-medium">{item?.name || 'Draft item not selected'}</span><span className="text-sm text-muted-foreground">{fmtDate(draftVoucher.date_bs)}</span></div><p className="mt-1 text-sm text-muted-foreground">{movement} · Qty {draft?.qtyDelta || '-'}{draft?.narration ? ` · ${draft.narration}` : ''}</p></div><Button size="sm" variant="outline" onClick={() => { setEditingAdjustment(draftVoucher); setShowAdjustment(true) }}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button></div>
        })}</div></Card>}<Card className="overflow-hidden">{adjustments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Date</th><th className="report-th text-left">Item</th><th className="report-th text-left">Stock Movement</th><th className="report-th text-right">Qty Change</th><th className="report-th text-right">Rate</th><th className="report-th text-right">Value</th><th className="report-th text-left">Reason</th><th className="report-th text-left">Status</th><th className="report-th text-right">Actions</th></tr></thead><tbody>{adjustments.map(voucher => {
          const line = voucher.stock_lines?.[0]
          const draft = voucher.status === 'Draft' ? voucher.draft_payload as Partial<{ itemId:string; mode:'adjustment'|'transfer'; stockCondition:StockCondition; transferTo:'damaged'|'expired'; qtyDelta:string; rate:string; narration:string }> | null : null
          const destination = voucher.stock_lines?.find(entry => entry.is_transfer && entry.direction === 'in')
          const item = items.find(entry => entry.id === (line?.item_id || draft?.itemId))
          const quantity = draft ? Number(draft.qtyDelta || 0) : line?.is_transfer ? line.qty : (line?.direction === 'out' ? -1 : 1) * (line?.qty || 0)
          const condition = (draft?.stockCondition || line?.stock_condition || 'saleable').replace(/^./, value => value.toUpperCase())
          const isTransfer = draft?.mode === 'transfer' || !!line?.is_transfer
          const transferDestination = (draft?.transferTo || destination?.stock_condition || 'damaged').replace(/^./, value => value.toUpperCase())
          const displayRate = draft ? Number(draft.rate || 0) : line?.rate || 0
          const displayMovement = isTransfer ? `Saleable -> ${transferDestination}` : condition
          return <tr key={voucher.id} className={cn('border-t hover:bg-muted/30', voucher.cancelled && 'opacity-55', voucher.status === 'Draft' && 'bg-amber-50/35')}><td className="report-td whitespace-nowrap text-muted-foreground">{fmtDate(voucher.date_bs)}</td><td className="report-td font-medium">{item?.name || (voucher.status === 'Draft' ? 'Draft item not selected' : 'Unknown item')}</td><td className="report-td">{displayMovement}</td><td className={cn('report-td text-right num font-semibold', !isTransfer && quantity < 0 ? 'text-destructive' : 'text-forest')}>{!isTransfer && quantity > 0 ? '+' : ''}{quantity || '-'}</td><td className="report-td text-right num">{fmtMoney(displayRate)}</td><td className="report-td text-right num">{isTransfer ? '-' : fmtMoney(Math.abs(quantity) * displayRate)}</td><td className="report-td text-muted-foreground">{voucher.narration || draft?.narration || '-'}</td><td className="report-td"><Badge variant={voucher.cancelled ? 'cancelled' : voucher.status === 'Draft' ? 'secondary' : 'default'} className={voucher.status === 'Draft' ? 'bg-amber-100 text-amber-800' : ''}>{voucher.cancelled ? 'Cancelled' : voucher.status === 'Draft' ? 'Draft' : 'Completed'}</Badge></td><td className="report-td text-right">{voucher.status === 'Draft' ? <Button size="sm" variant="outline" onClick={() => { setEditingAdjustment(voucher); setShowAdjustment(true) }}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button> : <span className="text-xs text-muted-foreground">-</span>}</td></tr>
        })}</tbody></table></div> : <div className="py-16 text-center"><p className="font-medium">{search ? 'No matching adjustments' : 'No stock adjustments yet'}</p><p className="mt-1 text-sm text-muted-foreground">Use adjustments for damage, loss, found stock, and corrections.</p></div>}</Card></div></TabsContent>
      </Tabs>
    </PageContent>
    <ItemForm open={showForm} onClose={() => setShowForm(false)} />
    <ItemDialog item={editingItem} open={!!editingItem} onClose={() => setEditingItem(null)} />
    <StockAdjustmentForm open={showAdjustment} voucher={editingAdjustment} onClose={() => { setShowAdjustment(false); setEditingAdjustment(null) }} />
    <CategoryDialog kind="item" category={categoryDialog?.category} parentCategory={categoryDialog?.parentCategory} open={!!categoryDialog} onClose={() => setCategoryDialog(null)} />
  </div>
}
