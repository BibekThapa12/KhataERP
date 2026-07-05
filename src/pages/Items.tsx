import { useState } from 'react'
import { Plus, AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { ItemForm } from '@/components/forms/OtherForms'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'

export function ItemsPage() {
  const { items, stock } = useAppStore()
  const [showForm, setShowForm] = useState(false)

  const rows = items
    .map(item => ({ item, s: stock.find(e => e.id === item.id) ?? { qty: 0, avg_cost: 0, value: 0 } }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name))

  return (
    <div>
      <PageHeader
        title="Items & Stock"
        description="Inventory tracked at weighted-average cost"
        action={<Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1.5" />New Item</Button>}
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
    </div>
  )
}
