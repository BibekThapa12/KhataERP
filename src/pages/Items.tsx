import { useMemo, useState } from 'react'
import { AlertTriangle, Archive, Pencil, Plus, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { cn, fmtDate, fmtMoney } from '@/lib/utils'
import { todayBs } from '@/lib/nepaliDate'
import { normalizeSearch } from '@/lib/search'
import { buildCategoryTree, categoryPath } from '@/lib/categoryHierarchy'
import { formatStockQuantity } from '@/lib/units'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { ItemForm } from '@/components/forms/OtherForms'
import { ItemDialog, CategoryDialog, CategoryLegend, CategoryTable } from '@/pages/Masters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge, Textarea } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import type { Item, ItemCategory } from '@/types'

type StatusFilter = 'all' | 'active' | 'inactive'

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
      setItemId(''); setQtyDelta(''); setRate(''); setNarration('')
      onClose()
    } catch (error: unknown) {
      setError((error as Error).message)
    } finally { setSaving(false) }
  }

  return <Dialog open={open} onOpenChange={value => !value && onClose()}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Stock Adjustment</DialogTitle></DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5"><Label>Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} /></div>
        <div className="space-y-1.5"><Label>Item</Label><SearchableSelect value={itemId} onValueChange={setItemId} placeholder="Select item" options={items.filter(item => !item.is_archived).map(item => ({ value: item.id, label: item.name, searchText: `${item.sku || ''} ${item.barcode || ''} ${item.unit} ${item.alternate_unit || ''}` }))} /></div>
        <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Qty Change</Label><Input type="number" step="any" value={qtyDelta} onChange={event => setQtyDelta(event.target.value)} placeholder="-2 or 5" /></div><div className="space-y-1.5"><Label>Rate</Label><Input type="number" step="any" value={rate} onChange={event => setRate(event.target.value)} placeholder="Cost rate" /></div></div>
        <div className="space-y-1.5"><Label>Reason</Label><Textarea value={narration} onChange={event => setNarration(event.target.value)} rows={2} placeholder="Damage, found stock, correction..." /></div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Adjustment'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function ItemsPage() {
  const { items, stock, itemCategories, vouchers, loading, error, alterItem, alterItemCategory } = useAppStore()
  const [tab, setTab] = useState('items')
  const [searchByTab, setSearchByTab] = useState<Record<string, string>>({ items: '', adjustments: '' })
  const [status, setStatus] = useState<StatusFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ category?: ItemCategory; parentCategory?: ItemCategory } | null>(null)
  const search = searchByTab[tab] || ''
  const query = normalizeSearch(search)
  const itemTree = useMemo(() => buildCategoryTree(itemCategories, items), [itemCategories, items])
  const itemRows = useMemo(() => items.filter(item => {
    const statusMatches = status === 'all' || (status === 'inactive' ? !!item.is_archived : !item.is_archived)
    const searchMatches = !query || normalizeSearch(`${item.name} ${categoryPath(itemCategories, item.category_id)} ${item.unit} ${item.alternate_unit || ''} ${item.sku || ''} ${item.barcode || ''} ${item.is_archived ? 'inactive archived' : 'active'}`).includes(query)
    return statusMatches && searchMatches
  }).map(item => ({ item, stock: stock.find(entry => entry.id === item.id) || { qty: 0, avg_cost: 0, value: 0 } })).sort((left, right) => left.item.name.localeCompare(right.item.name)), [items, stock, itemCategories, status, query])
  const adjustments = useMemo(() => vouchers.filter(voucher => voucher.type === 'Stock Adjustment').filter(voucher => {
    const line = voucher.stock_lines?.[0]
    const item = items.find(entry => entry.id === line?.item_id)
    return !query || normalizeSearch(`${voucher.date_bs} ${item?.name || ''} ${voucher.narration || ''} ${line?.direction || ''} ${voucher.cancelled ? 'cancelled' : 'active'}`).includes(query)
  }).sort((left, right) => right.date_bs_key - left.date_bs_key || right.seq - left.seq), [vouchers, items, query])

  const setSearch = (value: string) => setSearchByTab(current => ({ ...current, [tab]: value }))

  return <div>
    <PageHeader title="Items & Stock" description="Items, categories, stock valuation, and inventory adjustments" />
    <PageContent className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="overflow-x-auto pb-1"><TabsList className="w-max"><TabsTrigger value="items">Items</TabsTrigger><TabsTrigger value="categories">Item Categories</TabsTrigger><TabsTrigger value="adjustments">Stock Adjustments</TabsTrigger></TabsList></div>
          {tab !== 'categories' && <div className="flex flex-wrap gap-2"><div className="relative min-w-0 flex-1 sm:flex-none"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder={tab === 'items' ? 'Search items...' : 'Search adjustments...'} className="w-full pl-8 sm:w-64" /></div>{tab === 'items' && <SearchableSelect value={status} onValueChange={value => setStatus(value as StatusFilter)} className="w-32" options={[{ value: 'all', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />}{tab === 'items' ? <Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 h-4 w-4" />New Item</Button> : <Button onClick={() => setShowAdjustment(true)}><SlidersHorizontal className="mr-1.5 h-4 w-4" />New Adjustment</Button>}</div>}
        </div>

        <TabsContent value="items">
          <Card className="overflow-hidden">{error ? <p className="p-4 text-sm text-destructive">{error}</p> : loading ? <div className="space-y-px bg-border">{[0, 1, 2, 3].map(index => <div key={index} className="h-12 animate-pulse bg-card p-3"><div className="h-3 w-1/2 rounded bg-muted" /></div>)}</div> : itemRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Item</th><th className="report-th text-left">Category</th><th className="report-th text-left">Units</th><th className="report-th text-right">Stock Qty</th><th className="report-th text-right">Avg Cost</th><th className="report-th text-right">Stock Value</th><th className="report-th text-right">Sell Rate</th><th className="report-th text-left">SKU / Barcode</th><th className="report-th text-left">Status</th><th className="report-th"></th></tr></thead><tbody>{itemRows.map(({ item, stock: current }) => {
            const low = item.reorder_level != null && current.qty <= item.reorder_level
            return <tr key={item.id} className={cn('border-t transition-colors hover:bg-muted/30', item.is_archived && 'opacity-55')}><td className="report-td font-medium">{item.name}{low && <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700"><AlertTriangle className="mr-1 h-3 w-3" />Low</Badge>}</td><td className="report-td text-muted-foreground">{categoryPath(itemCategories, item.category_id) || 'General'}</td><td className="report-td">{item.unit}{item.alternate_unit && <span className="block text-xs text-muted-foreground">1 {item.unit} = {item.alternate_conversion} {item.alternate_unit}</span>}</td><td className="report-td text-right num font-semibold">{formatStockQuantity(current.qty, item)}</td><td className="report-td text-right num">{fmtMoney(current.avg_cost)}</td><td className="report-td text-right num font-semibold">{fmtMoney(current.value)}</td><td className="report-td text-right num">{fmtMoney(item.sell_rate)}</td><td className="report-td text-xs text-muted-foreground">{item.sku || '-'} / {item.barcode || '-'}</td><td className="report-td"><Badge variant={item.is_archived ? 'secondary' : 'default'}>{item.is_archived ? 'Inactive' : 'Active'}</Badge></td><td className="report-td"><div className="flex justify-end gap-1"><Button title="Edit item" variant="ghost" size="icon" onClick={() => setEditingItem(item)}><Pencil className="h-4 w-4" /></Button><Button title={item.is_archived ? 'Restore item' : 'Archive item'} variant="ghost" size="icon" onClick={() => alterItem(item.id, { is_archived: !item.is_archived })}>{item.is_archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button></div></td></tr>
          })}</tbody><tfoot><tr className="border-t-2 bg-muted/30 font-semibold"><td className="report-td" colSpan={5}>Filtered Stock Value ({itemRows.length} item{itemRows.length === 1 ? '' : 's'})</td><td className="report-td text-right num">{fmtMoney(itemRows.reduce((sum, row) => sum + row.stock.value, 0))}</td><td colSpan={4}></td></tr></tfoot></table></div> : <div className="py-16 text-center"><p className="font-medium">{search || status !== 'all' ? 'No matching items' : 'No items yet'}</p><p className="mt-1 text-sm text-muted-foreground">{search || status !== 'all' ? 'Try changing the search or status filter.' : 'Add an item to start tracking inventory.'}</p></div>}</Card>
        </TabsContent>

        <TabsContent value="categories"><div className="space-y-4"><CategoryTable kind="item" title="Item Categories" rows={itemTree} loading={loading} error={error} onAdd={() => setCategoryDialog({})} onAddChild={parentCategory => setCategoryDialog({ parentCategory: parentCategory as ItemCategory })} onEdit={category => setCategoryDialog({ category: category as ItemCategory })} onArchive={category => alterItemCategory(category.id, { is_archived: !category.is_archived })} /><CategoryLegend kind="item" /></div></TabsContent>

        <TabsContent value="adjustments"><Card className="overflow-hidden">{adjustments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Date</th><th className="report-th text-left">Item</th><th className="report-th text-right">Qty Change</th><th className="report-th text-right">Rate</th><th className="report-th text-right">Value</th><th className="report-th text-left">Reason</th><th className="report-th text-left">Status</th></tr></thead><tbody>{adjustments.map(voucher => {
          const line = voucher.stock_lines?.[0]
          const item = items.find(entry => entry.id === line?.item_id)
          const quantity = (line?.direction === 'out' ? -1 : 1) * (line?.qty || 0)
          return <tr key={voucher.id} className={cn('border-t hover:bg-muted/30', voucher.cancelled && 'opacity-55')}><td className="report-td whitespace-nowrap text-muted-foreground">{fmtDate(voucher.date_bs)}</td><td className="report-td font-medium">{item?.name || 'Unknown item'}</td><td className={cn('report-td text-right num font-semibold', quantity > 0 ? 'text-forest' : 'text-destructive')}>{quantity > 0 ? '+' : ''}{quantity}</td><td className="report-td text-right num">{fmtMoney(line?.rate || 0)}</td><td className="report-td text-right num">{fmtMoney(Math.abs(quantity) * (line?.rate || 0))}</td><td className="report-td text-muted-foreground">{voucher.narration || '-'}</td><td className="report-td"><Badge variant={voucher.cancelled ? 'cancelled' : 'secondary'}>{voucher.cancelled ? 'Cancelled' : 'Active'}</Badge></td></tr>
        })}</tbody></table></div> : <div className="py-16 text-center"><p className="font-medium">{search ? 'No matching adjustments' : 'No stock adjustments yet'}</p><p className="mt-1 text-sm text-muted-foreground">Use adjustments for damage, loss, found stock, and corrections.</p></div>}</Card></TabsContent>
      </Tabs>
    </PageContent>
    <ItemForm open={showForm} onClose={() => setShowForm(false)} />
    <ItemDialog item={editingItem} open={!!editingItem} onClose={() => setEditingItem(null)} />
    <StockAdjustmentForm open={showAdjustment} onClose={() => setShowAdjustment(false)} />
    <CategoryDialog kind="item" category={categoryDialog?.category} parentCategory={categoryDialog?.parentCategory} open={!!categoryDialog} onClose={() => setCategoryDialog(null)} />
  </div>
}
