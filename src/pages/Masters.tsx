import { useEffect, useMemo, useState } from 'react'
import { Archive, ExternalLink, Pencil, Plus, RotateCcw, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { fetchMasterChangeLogs } from '@/lib/supabase'
import { fmtMoney } from '@/lib/utils'
import { formatStockQuantity, toBaseQty, toBaseRate, type UnitMode } from '@/lib/units'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ItemForm } from '@/components/forms/OtherForms'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { normalizeSearch } from '@/lib/search'
import type { Account, AccountCategory, AccountType, Item, ItemCategory, MasterChangeLog, Party } from '@/types'

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense']

function CategoryDialog({ kind, category, open, onClose }: { kind: 'account' | 'item'; category?: AccountCategory | ItemCategory | null; open: boolean; onClose: () => void }) {
  const { addAccountCategory, alterAccountCategory, addItemCategory, alterItemCategory } = useAppStore()
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('Expense')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(category?.name || '')
    setType(kind === 'account' && category ? (category as AccountCategory).account_type : 'Expense')
    setError('')
  }, [open, category, kind])

  const save = async () => {
    if (!name.trim()) return setError('Enter a category name.')
    setSaving(true)
    try {
      if (kind === 'account') {
        if (category) await alterAccountCategory(category.id, { name: name.trim(), account_type: type })
        else await addAccountCategory({ name: name.trim(), account_type: type })
      } else if (category) await alterItemCategory(category.id, { name: name.trim() })
      else await addItemCategory(name.trim())
      onClose()
    } catch (e: unknown) { setError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{category ? 'Alter' : 'New'} {kind === 'account' ? 'Account' : 'Item'} Category</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={event => setName(event.target.value)} autoFocus /></div>
          {kind === 'account' && <div className="space-y-1.5"><Label>Account Type</Label><SearchableSelect value={type} onValueChange={value => setType(value as AccountType)} disabled={!!(category as AccountCategory | undefined)?.is_system} options={ACCOUNT_TYPES.map(value => ({ value, label: value }))} /></div>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Category'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LedgerDialog({ account, party, open, onClose }: { account?: Account | null; party?: Party | null; open: boolean; onClose: () => void }) {
  const { accountCategories, addAccount, alterAccount, alterParty, vouchers } = useAppStore()
  const activeCategories = useMemo(() => accountCategories.filter(category => !category.is_archived), [accountCategories])
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [partyType, setPartyType] = useState<'customer' | 'supplier'>('customer')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isUsed = !!account && vouchers.some(voucher => voucher.lines?.some(line => line.account_id === account.id))

  useEffect(() => {
    if (!open) return
    setName(account?.name || '')
    setCategoryId(account?.category_id || activeCategories[0]?.id || '')
    setPartyType(party?.type || 'customer')
    setOpeningBalance(String(account?.opening_balance || 0))
    setError('')
  }, [open, account, party, activeCategories])

  useEffect(() => {
    if (!party) return
    const requiredName = partyType === 'customer' ? 'Sundry Debtors' : 'Sundry Creditors'
    const requiredType = partyType === 'customer' ? 'Asset' : 'Liability'
    const category = activeCategories.find(item => item.name === requiredName && item.account_type === requiredType)
    if (category) setCategoryId(category.id)
  }, [party, partyType, activeCategories])

  const save = async () => {
    const category = activeCategories.find(item => item.id === categoryId)
    if (!name.trim()) return setError('Enter a ledger name.')
    if (!category) return setError('Select a category.')
    setSaving(true)
    try {
      if (party) {
        await alterParty(party.id, { name: name.trim(), type: partyType })
        if (account && Number(openingBalance) !== account.opening_balance) await alterAccount(account.id, { opening_balance: Number(openingBalance) || 0 })
      } else if (account) {
        await alterAccount(account.id, { name: name.trim(), category_id: category.id, group: category.name, type: category.account_type, opening_balance: Number(openingBalance) || 0 })
      } else {
        await addAccount({ name: name.trim(), category_id: category.id, group: category.name, type: category.account_type, opening_balance: Number(openingBalance) || 0 })
      }
      onClose()
    } catch (e: unknown) { setError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{account ? 'Alter Ledger' : 'New Ledger'}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><Label>Ledger Name</Label><Input value={name} onChange={event => setName(event.target.value)} autoFocus /></div>
          {party ? (
            <div className="space-y-1.5"><Label>Party Type</Label><SearchableSelect value={partyType} onValueChange={value => setPartyType(value as 'customer' | 'supplier')} options={[{ value: 'customer', label: 'Customer - Sundry Debtors' }, { value: 'supplier', label: 'Supplier - Sundry Creditors' }]} /></div>
          ) : (
            <div className="space-y-1.5"><Label>Category</Label><SearchableSelect value={categoryId} onValueChange={setCategoryId} disabled={!!account?.is_system} placeholder="Select category" options={activeCategories.map(category => ({ value: category.id, label: `${category.name} (${category.account_type})` }))} /></div>
          )}
          <div className="space-y-1.5"><Label>Opening Balance</Label><Input type="number" step="any" value={openingBalance} onChange={event => setOpeningBalance(event.target.value)} /><p className="text-xs text-muted-foreground">Changes affect all reports. Current voucher movements are not modified.</p></div>
          {(account?.is_system || isUsed) && <p className="text-xs text-amber-700">This ledger is protected from account-type changes because it is {account?.is_system ? 'a system ledger' : 'used in vouchers'}.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Ledger'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ItemDialog({ item, open, onClose }: { item: Item | null; open: boolean; onClose: () => void }) {
  const { itemCategories, vouchers, alterItem } = useAppStore()
  const [form, setForm] = useState({ name: '', category_id: '', unit: 'pcs', alternate_unit: '', alternate_conversion: '', sell_rate: '0', opening_qty: '0', opening_rate: '0', reorder_level: '', sku: '', barcode: '', vat_applicable: true })
  const [openingUnitMode, setOpeningUnitMode] = useState<UnitMode>('main')
  const [confirmUnit, setConfirmUnit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const used = !!item && vouchers.some(voucher => voucher.stock_lines?.some(line => line.item_id === item.id) || voucher.invoice_items?.some(line => line.item_id === item.id))

  useEffect(() => {
    if (!open || !item) return
    setForm({ name: item.name, category_id: item.category_id || '', unit: item.unit, alternate_unit: item.alternate_unit || '', alternate_conversion: item.alternate_conversion ? String(item.alternate_conversion) : '', sell_rate: String(item.sell_rate || 0), opening_qty: String(item.opening_qty || 0), opening_rate: String(item.opening_rate || 0), reorder_level: item.reorder_level == null ? '' : String(item.reorder_level), sku: item.sku || '', barcode: item.barcode || '', vat_applicable: item.vat_applicable !== false })
    setOpeningUnitMode('main')
    setConfirmUnit(false); setError('')
  }, [open, item])

  if (!item) return null
  const unitChanged = form.unit.trim() !== item.unit
  const stockBasisChanged = Number(form.opening_qty) !== item.opening_qty || Number(form.opening_rate) !== item.opening_rate
  const save = async () => {
    if (!form.name.trim() || !form.unit.trim()) return setError('Name and unit are required.')
    const altUnit = form.alternate_unit.trim()
    const altFactor = Number(form.alternate_conversion)
    if (altUnit && altUnit.toLowerCase() === form.unit.trim().toLowerCase()) return setError('Main and alternative units must be different.')
    if (altUnit && altFactor <= 1) return setError('Main units per alternative must be greater than 1.')
    if (used && (unitChanged || stockBasisChanged) && !confirmUnit) return setError('Confirm the stock-basis change. Historical vouchers will not be rewritten.')
    setSaving(true)
    try {
      const openingFactor = openingUnitMode === 'alternate' && altUnit ? altFactor : 1
      await alterItem(item.id, { name: form.name.trim(), category_id: form.category_id || undefined, unit: form.unit.trim(), alternate_unit: altUnit || null, alternate_conversion: altUnit ? altFactor : null, sell_rate: Number(form.sell_rate) || 0, opening_qty: toBaseQty(Number(form.opening_qty) || 0, openingFactor), opening_rate: toBaseRate(Number(form.opening_rate) || 0, openingFactor), reorder_level: form.reorder_level === '' ? null : Number(form.reorder_level), sku: form.sku.trim(), barcode: form.barcode.trim(), vat_applicable: form.vat_applicable })
      onClose()
    } catch (e: unknown) { setError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Alter Item</DialogTitle></DialogHeader>
      <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2"><Label>Item Name</Label><Input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label>Category</Label><SearchableSelect value={form.category_id} onValueChange={value => setForm({ ...form, category_id: value })} placeholder="Select category" options={itemCategories.filter(category => !category.is_archived).map(category => ({ value: category.id, label: category.name }))} /></div>
        <div className="space-y-1.5"><Label>Main Unit</Label><Input value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })} /></div>
        <div className="space-y-1.5"><Label>Sell Rate</Label><Input type="number" value={form.sell_rate} onChange={event => setForm({ ...form, sell_rate: event.target.value })} /></div>
        <div className="space-y-1.5"><Label>Alternative Unit</Label><Input value={form.alternate_unit} onChange={event => setForm({ ...form, alternate_unit: event.target.value })} placeholder="Optional" /></div>
        <div className="space-y-1.5"><Label>Conversion Quantity</Label><Input type="number" min="1.0001" placeholder="Enter manually" value={form.alternate_conversion} onChange={event => setForm({ ...form, alternate_conversion: event.target.value })} /><p className="text-[11px] text-muted-foreground">Number of main units in one alternative unit</p></div>
        {form.alternate_unit.trim() && Number(form.alternate_conversion) > 1 && <p className="text-xs text-muted-foreground sm:col-span-2">1 {form.alternate_unit.trim()} = {form.alternate_conversion} {form.unit.trim()}</p>}
        <div className="space-y-1.5"><Label>Opening Qty</Label><Input type="number" value={form.opening_qty} onChange={event => setForm({ ...form, opening_qty: event.target.value })} /></div>
        <div className="space-y-1.5"><Label>Opening Rate</Label><Input type="number" value={form.opening_rate} onChange={event => setForm({ ...form, opening_rate: event.target.value })} /></div>
        {form.alternate_unit.trim() && Number(form.alternate_conversion) > 1 && <div className="space-y-1.5 sm:col-span-2"><Label>Opening Stock Unit</Label><SearchableSelect value={openingUnitMode} onValueChange={value => setOpeningUnitMode(value as UnitMode)} options={[{ value: 'main', label: form.unit }, { value: 'alternate', label: form.alternate_unit }]} /><p className="text-xs text-muted-foreground">Values are currently shown in the selected unit. Switching this selector does not convert already entered values.</p></div>}
        <div className="space-y-1.5"><Label>Reorder Level</Label><Input type="number" value={form.reorder_level} onChange={event => setForm({ ...form, reorder_level: event.target.value })} /></div>
        <div className="space-y-1.5"><Label>SKU</Label><Input value={form.sku} onChange={event => setForm({ ...form, sku: event.target.value })} /></div>
        <div className="space-y-1.5"><Label>Barcode</Label><Input value={form.barcode} onChange={event => setForm({ ...form, barcode: event.target.value })} /></div>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.vat_applicable} onChange={event => setForm({ ...form, vat_applicable: event.target.checked })} className="h-4 w-4 accent-primary" />VAT applicable</label>
        {used && (unitChanged || stockBasisChanged) && <label className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:col-span-2"><input type="checkbox" checked={confirmUnit} onChange={event => setConfirmUnit(event.target.checked)} className="mt-0.5 h-4 w-4" />I understand historical vouchers will not be rewritten and this change affects current stock calculations.</label>}
        {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
      </div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Item'}</Button></DialogFooter>
    </DialogContent></Dialog>
  )
}

export function MastersPage() {
  const navigate = useNavigate()
  const { company, accounts, rawAccounts, accountCategories, parties, items, itemCategories, stock, alterAccount, alterParty, alterItem, alterAccountCategory, alterItemCategory } = useAppStore()
  const [tab, setTab] = useState('ledgers')
  const [searchByTab, setSearchByTab] = useState<Record<string, string>>({ ledgers: '', categories: '', items: '', history: '' })
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [newItemOpen, setNewItemOpen] = useState(false)
  const [categoryDialog, setCategoryDialog] = useState<{ kind: 'account' | 'item'; category?: AccountCategory | ItemCategory | null } | null>(null)
  const [changeLogs, setChangeLogs] = useState<MasterChangeLog[]>([])
  const [historyError, setHistoryError] = useState('')
  const search = searchByTab[tab] || ''
  const q = normalizeSearch(search)
  const partyByAccount = new Map(parties.map(party => [party.account_id, party]))
  const categoryById = new Map(accountCategories.map(category => [category.id, category]))
  const itemCategoryById = new Map(itemCategories.map(category => [category.id, category]))
  const ledgerRows = rawAccounts.filter(account => { const party = partyByAccount.get(account.id); return !q || normalizeSearch(`${account.name} ${account.group} ${account.type} ${party?.name || ''} ${party?.type || ''} ${account.is_archived || party?.is_archived ? 'archived' : account.is_system ? 'system' : 'active'}`).includes(q) }).sort((a, b) => a.name.localeCompare(b.name))
  const itemRows = items.filter(item => !q || normalizeSearch(`${item.name} ${itemCategoryById.get(item.category_id || '')?.name || ''} ${item.unit} ${item.alternate_unit || ''} ${item.sku || ''} ${item.barcode || ''} ${item.is_archived ? 'archived' : 'active'}`).includes(q)).sort((a, b) => a.name.localeCompare(b.name))
  const filteredAccountCategories = accountCategories.filter(category => !q || normalizeSearch(`${category.name} ${category.account_type} ${category.is_archived ? 'archived' : 'active'}`).includes(q))
  const filteredItemCategories = itemCategories.filter(category => !q || normalizeSearch(`${category.name} item ${category.is_archived ? 'archived' : 'active'}`).includes(q))
  const filteredChangeLogs = changeLogs.filter(log => !q || normalizeSearch(`${log.record_type} ${log.action} ${Object.keys(log.new_values || {}).join(' ')} ${new Date(log.created_at).toLocaleString()}`).includes(q))
  const searchPlaceholder = `Search ${tab === 'items' ? 'items' : tab}…`
  const selectedParty = editingAccount ? partyByAccount.get(editingAccount.id) : null

  useEffect(() => {
    if (tab !== 'history' || !company) return
    fetchMasterChangeLogs(company.id).then(logs => { setChangeLogs(logs); setHistoryError('') }).catch(error => setHistoryError(error.message))
  }, [tab, company])

  const openLedger = (account?: Account) => { setEditingAccount(account || null); setLedgerOpen(true) }
  const toggleLedger = async (account: Account) => {
    const party = partyByAccount.get(account.id)
    if (party) await alterParty(party.id, { is_archived: !party.is_archived })
    else await alterAccount(account.id, { is_archived: !account.is_archived })
  }

  return (
    <div><PageHeader title="Masters" description="Create, alter, categorize, archive, and restore business masters" />
      <PageContent className="space-y-4">
        <Tabs value={tab} onValueChange={setTab}><div className="flex flex-wrap items-center justify-between gap-3"><TabsList><TabsTrigger value="ledgers">Ledgers</TabsTrigger><TabsTrigger value="categories">Categories</TabsTrigger><TabsTrigger value="items">Items & Stock</TabsTrigger><TabsTrigger value="history">Change History</TabsTrigger></TabsList>
          <div className="flex gap-2"><div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearchByTab(current => ({ ...current, [tab]: event.target.value }))} placeholder={searchPlaceholder} className="w-64 pl-8" /></div>{tab === 'ledgers' && <Button onClick={() => openLedger()}><Plus className="mr-1.5 h-4 w-4" />New Ledger</Button>}{tab === 'items' && <Button onClick={() => setNewItemOpen(true)}><Plus className="mr-1.5 h-4 w-4" />New Item</Button>}</div></div>
          {search && ((tab === 'ledgers' && ledgerRows.length === 0) || (tab === 'items' && itemRows.length === 0)) && <p className="w-full rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No matching {tab}.</p>}
          <TabsContent value="ledgers"><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Ledger</th><th className="report-th text-left">Category</th><th className="report-th text-left">Type</th><th className="report-th text-right">Balance</th><th className="report-th text-left">Status</th><th className="report-th"></th></tr></thead><tbody>{ledgerRows.map(account => { const current = accounts.find(item => item.id === account.id); const party = partyByAccount.get(account.id); const archived = party?.is_archived || account.is_archived; return <tr key={account.id} className={`border-t ${archived ? 'opacity-55' : ''}`}><td className="report-td font-medium">{account.name}{party && <span className="ml-2 text-xs text-muted-foreground">{party.type}</span>}</td><td className="report-td text-muted-foreground">{categoryById.get(account.category_id || '')?.name || account.group}</td><td className="report-td">{account.type}</td><td className="report-td text-right num font-semibold">{fmtMoney(current?.balance || 0)}</td><td className="report-td"><Badge variant={archived ? 'secondary' : account.is_system ? 'outline' : 'default'}>{archived ? 'Archived' : account.is_system ? 'System' : 'Active'}</Badge></td><td className="report-td"><div className="flex justify-end gap-1"><Button title="Open ledger report" variant="ghost" size="icon" onClick={() => navigate(`/reports/ledger?account=${encodeURIComponent(account.id)}`)}><ExternalLink className="h-4 w-4" /></Button><Button title="Alter ledger" variant="ghost" size="icon" onClick={() => openLedger(account)}><Pencil className="h-4 w-4" /></Button>{!account.is_system && <Button title={archived ? 'Restore ledger' : 'Archive ledger'} variant="ghost" size="icon" onClick={() => toggleLedger(account)}>{archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button>}</div></td></tr>})}</tbody></table></div></Card></TabsContent>
          <TabsContent value="categories"><div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><CategoryTable title="Account Categories" categories={filteredAccountCategories} counts={filteredAccountCategories.map(category => rawAccounts.filter(account => account.category_id === category.id).length)} onAdd={() => setCategoryDialog({ kind: 'account' })} onEdit={category => setCategoryDialog({ kind: 'account', category })} onArchive={category => alterAccountCategory(category.id, { is_archived: !category.is_archived })} /><CategoryTable title="Item Categories" categories={filteredItemCategories} counts={filteredItemCategories.map(category => items.filter(item => item.category_id === category.id).length)} onAdd={() => setCategoryDialog({ kind: 'item' })} onEdit={category => setCategoryDialog({ kind: 'item', category })} onArchive={category => alterItemCategory(category.id, { is_archived: !category.is_archived })} /></div></TabsContent>
          <TabsContent value="items"><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Item</th><th className="report-th text-left">Category</th><th className="report-th text-left">Units</th><th className="report-th text-right">Stock</th><th className="report-th text-right">Sell Rate</th><th className="report-th text-left">SKU / Barcode</th><th className="report-th"></th></tr></thead><tbody>{itemRows.map(item => { const current = stock.find(entry => entry.id === item.id); return <tr key={item.id} className={`border-t ${item.is_archived ? 'opacity-55' : ''}`}><td className="report-td font-medium">{item.name}{item.is_archived && <Badge variant="secondary" className="ml-2">Archived</Badge>}</td><td className="report-td text-muted-foreground">{itemCategoryById.get(item.category_id || '')?.name || 'General'}</td><td className="report-td">{item.unit}{item.alternate_unit ? <span className="block text-xs text-muted-foreground">1 {item.alternate_unit} = {item.alternate_conversion} {item.unit}</span> : null}</td><td className="report-td text-right num">{formatStockQuantity(current?.qty || 0, item)}</td><td className="report-td text-right num">{fmtMoney(item.sell_rate)}</td><td className="report-td text-xs text-muted-foreground">{item.sku || '-'} / {item.barcode || '-'}</td><td className="report-td"><div className="flex justify-end gap-1"><Button title="Alter item" variant="ghost" size="icon" onClick={() => setEditingItem(item)}><Pencil className="h-4 w-4" /></Button><Button title={item.is_archived ? 'Restore item' : 'Archive item'} variant="ghost" size="icon" onClick={() => alterItem(item.id, { is_archived: !item.is_archived })}>{item.is_archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button></div></td></tr>})}</tbody></table></div></Card></TabsContent>
          <TabsContent value="history"><Card className="overflow-hidden">{historyError ? <p className="p-4 text-sm text-destructive">{historyError}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">When</th><th className="report-th text-left">Record</th><th className="report-th text-left">Action</th><th className="report-th text-left">Changed Fields</th></tr></thead><tbody>{filteredChangeLogs.map(log => <tr key={log.id} className="border-t"><td className="report-td whitespace-nowrap text-muted-foreground">{new Date(log.created_at).toLocaleString()}</td><td className="report-td font-medium">{log.record_type.replaceAll('_', ' ')}</td><td className="report-td">{log.action.replaceAll('_', ' ')}</td><td className="report-td text-muted-foreground">{Object.keys(log.new_values || {}).join(', ') || '-'}</td></tr>)}{filteredChangeLogs.length === 0 && <tr><td colSpan={4} className="p-12 text-center text-muted-foreground">{search ? 'No matching history records.' : 'No master changes recorded yet.'}</td></tr>}</tbody></table></div>}</Card></TabsContent>
        </Tabs>
      </PageContent>
      <LedgerDialog account={editingAccount} party={selectedParty} open={ledgerOpen} onClose={() => { setLedgerOpen(false); setEditingAccount(null) }} />
      <ItemDialog item={editingItem} open={!!editingItem} onClose={() => setEditingItem(null)} />
      <ItemForm open={newItemOpen} onClose={() => setNewItemOpen(false)} />
      <CategoryDialog kind={categoryDialog?.kind || 'account'} category={categoryDialog?.category} open={!!categoryDialog} onClose={() => setCategoryDialog(null)} />
    </div>
  )
}

function CategoryTable({ title, categories, counts, onAdd, onEdit, onArchive }: { title: string; categories: (AccountCategory | ItemCategory)[]; counts: number[]; onAdd: () => void; onEdit: (category: AccountCategory | ItemCategory) => void; onArchive: (category: AccountCategory | ItemCategory) => void }) {
  return <Card className="overflow-hidden"><div className="flex items-center justify-between border-b p-4"><h3 className="font-serif font-bold">{title}</h3><Button size="sm" variant="outline" onClick={onAdd}><Plus className="mr-1 h-3.5 w-3.5" />New</Button></div><table className="w-full text-sm"><tbody>{categories.map((category, index) => { const system = 'is_system' in category && category.is_system; return <tr key={category.id} className={`border-t first:border-t-0 ${category.is_archived ? 'opacity-55' : ''}`}><td className="px-4 py-3 font-medium">{category.name}<p className="text-xs font-normal text-muted-foreground">{'account_type' in category ? category.account_type : 'Item category'} | {counts[index]} record(s)</p></td><td className="px-4 py-3"><div className="flex justify-end gap-1">{!system && <Button title="Alter category" variant="ghost" size="icon" onClick={() => onEdit(category)}><Pencil className="h-4 w-4" /></Button>}<Button title={category.is_archived ? 'Restore category' : 'Archive category'} variant="ghost" size="icon" disabled={system || (!category.is_archived && counts[index] > 0)} onClick={() => onArchive(category)}>{category.is_archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button></div></td></tr>})}{categories.length === 0 && <tr><td colSpan={2} className="p-10 text-center text-muted-foreground">No matching categories.</td></tr>}</tbody></table></Card>
}
