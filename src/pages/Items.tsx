import { useMemo, useState } from 'react'
import { AlertTriangle, Archive, Pencil, Plus, RotateCcw, Search } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { cn, fmtMoney } from '@/lib/utils'
import { normalizeSearch } from '@/lib/search'
import { stockConditionQuantity } from '@/lib/engine'
import { buildCategoryTree, categoryPath } from '@/lib/categoryHierarchy'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { ItemForm } from '@/components/forms/OtherForms'
import { ItemDialog, CategoryDialog, CategoryLegend, CategoryTable } from '@/pages/Masters'
import { SlabPricingPage } from '@/pages/SlabPricing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import type { Item, ItemCategory } from '@/types'

type StatusFilter = 'all' | 'active' | 'inactive'

export function ItemsPage() {
  const { items, stock, itemCategories, vouchers, loading, error, alterItem, alterItemCategory } = useAppStore()
  const [tab, setTab] = useState('items')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ category?: ItemCategory; parentCategory?: ItemCategory } | null>(null)
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

  return <div>
    <PageHeader title="Items & Stock" description="Items, categories, units, and slab pricing" />
    <PageContent className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="overflow-x-auto pb-1"><TabsList className="w-max"><TabsTrigger value="items">Items</TabsTrigger><TabsTrigger value="categories">Item Categories</TabsTrigger><TabsTrigger value="pricing">Slab Pricing</TabsTrigger></TabsList></div>
          {tab === 'items' && <div className="flex flex-wrap gap-2"><div className="relative min-w-0 flex-1 sm:flex-none"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search items..." className="w-full pl-8 sm:w-64" /></div><SearchableSelect value={status} onValueChange={value => setStatus(value as StatusFilter)} className="w-32" options={[{ value: 'all', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} /><Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 h-4 w-4" />New Item</Button></div>}
        </div>

        <TabsContent value="items">
          <Card className="overflow-hidden">{error ? <p className="p-4 text-sm text-destructive">{error}</p> : loading ? <div className="space-y-px bg-border">{[0, 1, 2, 3].map(index => <div key={index} className="h-12 animate-pulse bg-card p-3"><div className="h-3 w-1/2 rounded bg-muted" /></div>)}</div> : itemRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Item</th><th className="report-th text-left">Category</th><th className="report-th text-left">Units</th><th className="report-th text-right">Sell Rate</th><th className="report-th text-left">SKU / Barcode</th><th className="report-th text-left">Status</th><th className="report-th"></th></tr></thead><tbody>{itemRows.map(({ item, stock: current }) => {
            const low = !item.is_service && item.reorder_level != null && current.qty <= item.reorder_level
            return <tr key={item.id} className={cn('border-t transition-colors hover:bg-muted/30', item.is_archived && 'opacity-55')}><td className="report-td font-medium">{item.name}{item.is_service && <Badge variant="outline" className="ml-2 border-sky-200 text-sky-700">Service</Badge>}{low && <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700"><AlertTriangle className="mr-1 h-3 w-3" />Low</Badge>}</td><td className="report-td text-muted-foreground">{categoryPath(itemCategories, item.category_id) || 'General'}</td><td className="report-td">{item.is_service ? 'Service' : item.unit}{!item.is_service && item.alternate_unit && <span className="block text-xs text-muted-foreground">1 {item.unit} = {item.alternate_conversion} {item.alternate_unit}</span>}</td><td className="report-td text-right num">{fmtMoney(item.sell_rate)}</td><td className="report-td text-xs text-muted-foreground">{item.sku || '-'} / {item.barcode || '-'}</td><td className="report-td"><Badge variant={item.is_archived ? 'secondary' : 'default'}>{item.is_archived ? 'Inactive' : 'Active'}</Badge></td><td className="report-td"><div className="flex justify-end gap-1"><Button title="Edit item" variant="ghost" size="icon" onClick={() => setEditingItem(item)}><Pencil className="h-4 w-4" /></Button><Button title={item.is_archived ? 'Restore item' : 'Archive item'} variant="ghost" size="icon" onClick={() => alterItem(item.id, { is_archived: !item.is_archived })}>{item.is_archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button></div></td></tr>
          })}</tbody></table></div> : <div className="py-16 text-center"><p className="font-medium">{search || status !== 'all' ? 'No matching items' : 'No items yet'}</p><p className="mt-1 text-sm text-muted-foreground">{search || status !== 'all' ? 'Try changing the search or status filter.' : 'Add an item to start tracking inventory.'}</p></div>}</Card>
        </TabsContent>

        <TabsContent value="categories"><div className="space-y-4"><CategoryTable kind="item" title="Item Categories" rows={itemTree} loading={loading} error={error} onAdd={() => setCategoryDialog({})} onAddChild={parentCategory => setCategoryDialog({ parentCategory: parentCategory as ItemCategory })} onEdit={category => setCategoryDialog({ category: category as ItemCategory })} onArchive={category => alterItemCategory(category.id, { is_archived: !category.is_archived })} /><CategoryLegend kind="item" /></div></TabsContent>

        <TabsContent value="pricing"><SlabPricingPage embedded /></TabsContent>
      </Tabs>
    </PageContent>
    <ItemForm open={showForm} onClose={() => setShowForm(false)} />
    <ItemDialog item={editingItem} open={!!editingItem} onClose={() => setEditingItem(null)} />
    <CategoryDialog kind="item" category={categoryDialog?.category} parentCategory={categoryDialog?.parentCategory} open={!!categoryDialog} onClose={() => setCategoryDialog(null)} />
  </div>
}
