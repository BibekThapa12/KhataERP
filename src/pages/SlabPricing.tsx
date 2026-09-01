import { useMemo, useState } from 'react'
import { Copy, History, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { PricingRule, PricingRuleScope } from '@/types'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { publicErrorMessage } from '@/lib/security'
import { selectedFiscalYearStartBs } from '@/lib/reports'
import { makeBsKey } from '@/lib/nepaliDate'

type SlabDraft = { id?: string; min_quantity: string; rate: string }
type StatusFilter = 'all' | 'active' | 'inactive'
const selectClass = 'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring'

export function SlabPricingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const store = useAppStore()
  const { company, companyMemberships, companyPermissions, items, itemCategories, pricingRules } = store
  const canManage = !!company && (companyMemberships.some(member => member.company_id === company.id && member.role === 'Admin') || companyPermissions.includes('pricing.manage'))
  const [editing, setEditing] = useState<PricingRule | null | undefined>()
  const [name, setName] = useState('')
  const [scope, setScope] = useState<PricingRuleScope>('ITEM')
  const [targetId, setTargetId] = useState('')
  const [unit, setUnit] = useState('')
  const [from, setFrom] = useState(() => selectedFiscalYearStartBs(company))
  const [to, setTo] = useState('')
  const [priority, setPriority] = useState('0')
  const [slabs, setSlabs] = useState<SlabDraft[]>([{ min_quantity: '1', rate: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<PricingRule | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [historyRule, setHistoryRule] = useState<PricingRule | null>(null)

  const descendants = useMemo(() => {
    if (scope !== 'CATEGORY' || !targetId) return []
    const children = new Map<string, string[]>()
    itemCategories.forEach(category => children.set(category.parent_category_id || '', [...(children.get(category.parent_category_id || '') || []), category.id]))
    const ids = new Set<string>(), queue = [targetId]
    while (queue.length) { const id = queue.shift()!; if (!ids.has(id)) { ids.add(id); queue.push(...(children.get(id) || [])) } }
    return items.filter(item => item.category_id && ids.has(item.category_id) && !item.is_service && !item.is_archived)
  }, [itemCategories, items, scope, targetId])
  const units = useMemo(() => [...new Set((scope === 'ITEM' ? items.filter(item => item.id === targetId) : descendants).flatMap(item => [item.unit, item.alternate_unit].filter((value): value is string => !!value)))], [descendants, items, scope, targetId])
  const compatible = descendants.filter(item => [item.unit, item.alternate_unit].some(value => value?.trim().toLowerCase() === unit.trim().toLowerCase())).length
  const visibleRules = useMemo(() => {
    const query = search.trim().toLowerCase()
    return pricingRules.filter(rule => rule.is_current !== false).filter(rule => {
      const target = rule.scope === 'ITEM' ? items.find(item => item.id === rule.item_id)?.name : itemCategories.find(category => category.id === rule.category_id)?.name
      return (status === 'all' || rule.is_active === (status === 'active')) && (!query || `${rule.name} ${rule.scope} ${target || ''} ${rule.quantity_unit}`.toLowerCase().includes(query))
    })
  }, [itemCategories, items, pricingRules, search, status])
  const ruleHistory = historyRule
    ? pricingRules.filter(rule => (rule.rule_family_id || rule.id) === (historyRule.rule_family_id || historyRule.id)).sort((a, b) => b.version_number - a.version_number)
    : []

  function open(rule?: PricingRule) {
    setEditing(rule || null); setName(rule?.name || ''); setScope(rule?.scope || 'ITEM'); setTargetId(rule?.item_id || rule?.category_id || '')
    setUnit(rule?.quantity_unit || ''); setFrom(rule?.effective_from_bs || selectedFiscalYearStartBs(company)); setTo(rule?.effective_until_bs || '')
    setPriority(String(rule?.priority || 0)); setSlabs(rule?.slabs.map(slab => ({ id: slab.id, min_quantity: String(slab.min_quantity), rate: String(slab.rate) })) || [{ min_quantity: '1', rate: '' }]); setError('')
  }
  async function submit() {
    if (!company || !name.trim() || !targetId || !unit || !slabs.length) return setError('Complete the rule, target, unit, and at least one slab.')
    setSaving(true); setError('')
    try {
      await store.savePricingRule({ id: editing?.id, company_id: company.id, name: name.trim(), scope, item_id: scope === 'ITEM' ? targetId : null, category_id: scope === 'CATEGORY' ? targetId : null, quantity_unit: unit, effective_from_bs: from, effective_from_bs_key: makeBsKey(from), effective_until_bs: to || null, effective_until_bs_key: to ? makeBsKey(to) : null, priority: Number(priority) || 0, is_active: editing?.is_active ?? true, slabs: slabs.map(slab => ({ id: slab.id || crypto.randomUUID(), pricing_rule_id: editing?.id || '', min_quantity: Number(slab.min_quantity), rate: Number(slab.rate) })) })
      setEditing(undefined)
    } catch (cause) { setError(publicErrorMessage(cause, 'saving pricing rule')) } finally { setSaving(false) }
  }
  async function act(action: () => Promise<void>) {
    setError('')
    try { await action() } catch (cause) { setError(publicErrorMessage(cause, 'updating pricing rule')) }
  }

  return <div>
    {!embedded && <PageHeader title="Slab Pricing" description="Automatic item and category quantity pricing for Sales invoices" action={canManage ? <Button onClick={() => open()}><Plus className="mr-1.5 h-4 w-4" />New Rule</Button> : undefined} />}
    <PageContent className={embedded ? "p-0 sm:p-0 md:p-0" : undefined}>
      {editing === undefined && error && <p className="form-error mb-3">{error}</p>}
      <Card className="overflow-hidden p-3 sm:p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search rules, items, categories, units..." /></div>
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm sm:w-40" value={status} onChange={event => setStatus(event.target.value as StatusFilter)}><option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
          {embedded && canManage && <Button className="shrink-0" onClick={() => open()}><Plus className="mr-1.5 h-4 w-4" />New Rule</Button>}
        </div>
        {visibleRules.length ? <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[980px] border-collapse text-sm">
          <thead><tr className="bg-[#f4f0e5]">{['Rule', 'Scope', 'Target', 'Unit', 'Effective period', 'Priority', 'Slabs', 'Status', 'Actions'].map(label => <th key={label} className={`report-th text-[#675c49] ${['Priority', 'Slabs'].includes(label) ? 'text-center' : label === 'Actions' ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
          <tbody>{visibleRules.map(rule => <tr className="border-t hover:bg-muted/25" key={rule.id}>
            <td className="report-td font-medium">{rule.name}</td><td className="report-td">{rule.scope === 'ITEM' ? 'Item' : 'Category'}</td>
            <td className="report-td">{rule.scope === 'ITEM' ? items.find(item => item.id === rule.item_id)?.name : itemCategories.find(category => category.id === rule.category_id)?.name}</td>
            <td className="report-td">{rule.quantity_unit}</td><td className="report-td whitespace-nowrap">{rule.effective_from_bs} – {rule.effective_until_bs || 'No end date'}</td>
            <td className="report-td text-center">{rule.priority}</td><td className="report-td text-center">{rule.slabs.length}</td><td className="report-td"><Badge variant={rule.is_active ? 'sales' : 'secondary'}>{rule.is_active ? 'Active' : 'Inactive'}</Badge></td>
            <td className="report-td"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" title="Version history" onClick={() => setHistoryRule(rule)}><History className="h-4 w-4" /></Button>{canManage && <><Button variant="ghost" size="icon" title="Edit" onClick={() => open(rule)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title="Duplicate" onClick={() => void act(() => store.duplicatePricingRule(rule.id))}><Copy className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title={rule.is_active ? 'Deactivate' : 'Activate'} onClick={() => void act(() => store.activatePricingRule(rule.id, !rule.is_active))}><Power className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" title="Delete" onClick={() => setDeleting(rule)}><Trash2 className="h-4 w-4" /></Button></>}</div></td>
          </tr>)}</tbody>
        </table></div> : <div className="rounded-md border py-16 text-center"><p className="text-sm font-medium">{pricingRules.length ? 'No matching pricing rules' : 'No slab pricing rules yet'}</p><p className="mt-1 text-xs text-muted-foreground">{pricingRules.length ? 'Try changing the search or status filter.' : canManage ? 'Create a rule to apply quantity-based Sales rates.' : 'Pricing rules created for this company will appear here.'}</p>{!pricingRules.length && canManage && <Button className="mt-4" size="sm" onClick={() => open()}><Plus className="mr-1 h-4 w-4" />New Rule</Button>}</div>}
      </Card>
    </PageContent>

    <Dialog open={editing !== undefined} onOpenChange={value => { if (!value && !saving) setEditing(undefined) }}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{editing ? 'Edit' : 'New'} Slab Pricing Rule</DialogTitle></DialogHeader>
      <div className="grid gap-4 py-2">
        <div><Label>Rule Name</Label><Input className="mt-1" value={name} onChange={event => setName(event.target.value)} /></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Scope</Label><select className={selectClass} value={scope} onChange={event => { setScope(event.target.value as PricingRuleScope); setTargetId(''); setUnit('') }}><option value="ITEM">Item</option><option value="CATEGORY">Category</option></select></div><div><Label>{scope === 'ITEM' ? 'Item' : 'Category'}</Label><select className={selectClass} value={targetId} onChange={event => { setTargetId(event.target.value); setUnit('') }}><option value="">Select</option>{(scope === 'ITEM' ? items.filter(item => !item.is_service) : itemCategories).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></div></div>
        <div className="grid gap-3 sm:grid-cols-3"><div><Label>Calculation Unit</Label><select className={selectClass} value={unit} onChange={event => setUnit(event.target.value)}><option value="">Select unit</option>{units.map(value => <option key={value}>{value}</option>)}</select></div><div><Label>Priority</Label><Input className="mt-1" type="number" value={priority} onChange={event => setPriority(event.target.value)} /></div><div className="pt-6 text-sm text-muted-foreground">{scope === 'CATEGORY' && unit ? `${compatible} compatible, ${descendants.length - compatible} excluded` : ''}</div></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Effective From</Label><NepaliDateInput value={from} onChange={setFrom} /></div><div><Label>Effective To (optional)</Label><NepaliDateInput value={to} onChange={setTo} allowClear /></div></div>
        <div><div className="flex items-center justify-between"><Label>Quantity slabs</Label><Button variant="outline" size="sm" onClick={() => setSlabs(current => [...current, { min_quantity: '', rate: '' }])}><Plus className="mr-1 h-3.5 w-3.5" />Add slab</Button></div>{slabs.map((slab, index) => <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2" key={slab.id || index}><Input type="number" min="0.000001" step="any" placeholder="Minimum quantity" value={slab.min_quantity} onChange={event => setSlabs(current => current.map((entry, i) => i === index ? { ...entry, min_quantity: event.target.value } : entry))} /><Input type="number" min="0" step="any" placeholder="Rate" value={slab.rate} onChange={event => setSlabs(current => current.map((entry, i) => i === index ? { ...entry, rate: event.target.value } : entry))} /><Button variant="ghost" size="icon" disabled={slabs.length === 1} onClick={() => setSlabs(current => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>)}</div>
        {error && <p className="form-error">{error}</p>}
      </div><DialogFooter><Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button><Button disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save Rule'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={value => { if (!value) setDeleting(null) }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Delete pricing rule?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Delete <strong>{deleting?.name}</strong>? Used rules must be deactivated instead.</p><DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Keep Rule</Button><Button variant="destructive" onClick={() => { const id = deleting?.id; setDeleting(null); if (id) void act(() => store.deletePricingRule(id)) }}>Delete Rule</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!historyRule} onOpenChange={value => { if (!value) setHistoryRule(null) }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{historyRule?.name} — Version History</DialogTitle></DialogHeader><div className="max-h-[60vh] overflow-auto rounded-md border"><table className="w-full text-sm"><thead><tr className="bg-muted"><th className="report-th text-left">Version</th><th className="report-th text-left">Effective period</th><th className="report-th text-center">Slabs</th><th className="report-th text-left">State</th></tr></thead><tbody>{ruleHistory.map(rule => <tr className="border-t" key={rule.id}><td className="report-td">v{rule.version_number}</td><td className="report-td">{rule.effective_from_bs} – {rule.effective_until_bs || 'No end date'}</td><td className="report-td text-center">{rule.slabs.length}</td><td className="report-td">{rule.is_current ? (rule.is_active ? 'Current · Active' : 'Current · Inactive') : 'Superseded'}</td></tr>)}</tbody></table></div><DialogFooter><Button variant="outline" onClick={() => setHistoryRule(null)}>Close</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
