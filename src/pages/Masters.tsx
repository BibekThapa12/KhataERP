import { useEffect, useMemo, useRef, useState } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { AlertCircle, Archive, ChevronDown, ChevronRight, ExternalLink, FileText, Folder, FolderPlus, Landmark, MoreHorizontal, Package, Pencil, Plus, RotateCcw, Search, Tag, Trash2, UserRound, Wrench } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { fetchMasterChangeLogs } from '@/lib/supabase'
import { cn, fmtMoney } from '@/lib/utils'
import { toBaseQty, toBaseRate, type UnitMode } from '@/lib/units'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { UnitCombobox } from '@/components/inputs/UnitCombobox'
import { ExpandCollapseControls } from '@/components/ExpandCollapseControls'
import { normalizeSearch } from '@/lib/search'
import { buildCategoryTree, categoryDepth, categoryDescendantIds, categoryOptionLabel, categoryPath, flattenCategoryTree, subtreeHeight, type CategoryTreeNode } from '@/lib/categoryHierarchy'
import { partyTerminology } from '@/lib/partyTerminology'
import { validateItemUnits } from '@/lib/itemUnits'
import type { Account, AccountCategory, AccountType, Item, ItemCategory, MasterChangeLog, Party } from '@/types'

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense']

export function CategoryDialog({ kind, category, parentCategory, open, onClose }: { kind: 'account' | 'item'; category?: AccountCategory | ItemCategory | null; parentCategory?: AccountCategory | ItemCategory | null; open: boolean; onClose: () => void }) {
  const { accountCategories, itemCategories, addAccountCategory, alterAccountCategory, addItemCategory, alterItemCategory } = useAppStore()
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('Expense')
  const [parentId, setParentId] = useState('root')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(category?.name || '')
    setType(kind === 'account' && (category || parentCategory) ? ((category || parentCategory) as AccountCategory).account_type : 'Expense')
    setParentId(category?.parent_category_id || parentCategory?.id || 'root')
    setError('')
  }, [open, category, parentCategory, kind])

  const save = async () => {
    if (!name.trim()) return setError('Enter a category name.')
    setSaving(true)
    try {
      if (kind === 'account') {
        if (category) await alterAccountCategory(category.id, { name: name.trim(), account_type: type, parent_category_id: parentId === 'root' ? null : parentId })
        else await addAccountCategory({ name: name.trim(), account_type: type, parent_category_id: parentId === 'root' ? null : parentId })
      } else if (category) await alterItemCategory(category.id, { name: name.trim(), parent_category_id: parentId === 'root' ? null : parentId })
      else await addItemCategory({ name: name.trim(), parent_category_id: parentId === 'root' ? null : parentId })
      onClose()
    } catch (e: unknown) { setError((e as Error).message) } finally { setSaving(false) }
  }

  const allCategories = kind === 'account' ? accountCategories : itemCategories
  const descendants = category ? categoryDescendantIds(allCategories, category.id) : new Set<string>()
  const ownHeight = category ? subtreeHeight(allCategories, category.id) : 1
  const parentOptions = allCategories.filter(candidate => !candidate.is_archived && candidate.id !== category?.id && !descendants.has(candidate.id) && categoryDepth(allCategories, candidate.id) + ownHeight <= 3 && (kind === 'item' || (candidate as AccountCategory).account_type === type))
  const selectedParent = parentId === 'root' ? undefined : allCategories.find(candidate => candidate.id === parentId)
  const systemCategory = kind === 'account' && !!(category as AccountCategory | undefined)?.is_system

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{category ? 'Alter' : 'New'} {kind === 'account' ? 'Account' : 'Item'} Category</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={event => setName(event.target.value)} autoFocus disabled={systemCategory} /></div>
          {kind === 'account' && <div className="space-y-1.5"><Label>Account Type</Label><SearchableSelect value={type} onValueChange={value => { setType(value as AccountType); setParentId('root') }} disabled={!!selectedParent || !!(category as AccountCategory | undefined)?.is_system} options={ACCOUNT_TYPES.map(value => ({ value, label: value }))} /></div>}
          <div className="space-y-1.5"><Label>Parent Category</Label><SearchableSelect value={parentId} disabled={systemCategory} onValueChange={value => { setParentId(value); const parent = allCategories.find(candidate => candidate.id === value); if (kind === 'account' && parent) setType((parent as AccountCategory).account_type) }} options={[{ value: 'root', label: 'Top level' }, ...parentOptions.map(parent => ({ value: parent.id, label: categoryOptionLabel(allCategories, parent.id), searchText: categoryPath(allCategories, parent.id), group: 'account_type' in parent ? parent.account_type : undefined }))]} /></div>
          {systemCategory && <p className="text-xs text-muted-foreground">System account groups are protected and cannot be changed.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving || systemCategory}>{saving ? 'Saving...' : 'Save Category'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LedgerDialog({ account, party, defaultCategoryId, open, onClose }: { account?: Account | null; party?: Party | null; defaultCategoryId?: string; open: boolean; onClose: () => void }) {
  const { accountCategories, addAccount, alterAccount, alterParty, vouchers } = useAppStore()
  const activeCategories = useMemo(() => accountCategories.filter(category => !category.is_archived), [accountCategories])
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [partyType, setPartyType] = useState<'customer' | 'supplier'>('customer')
  const [defaultCreditDays, setDefaultCreditDays] = useState('0')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isUsed = !!account && vouchers.some(voucher => voucher.lines?.some(line => line.account_id === account.id))

  useEffect(() => {
    if (!open) return
    setName(account?.name || '')
    setCategoryId(account?.category_id || defaultCategoryId || activeCategories[0]?.id || '')
    setPartyType(party?.type || 'customer')
    setDefaultCreditDays(String(party?.default_credit_days ?? 0))
    setOpeningBalance(String(account?.opening_balance || 0))
    setError('')
  }, [open, account, party, defaultCategoryId, activeCategories])

  useEffect(() => {
    if (!party) return
    const terms = partyTerminology(partyType)
    const requiredName = terms.category
    const requiredType = terms.accountType
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
        const creditDays = Number(defaultCreditDays)
        if (!Number.isInteger(creditDays) || creditDays < 0) throw new Error('Default Credit Days must be a whole number of 0 or more.')
        await alterParty(party.id, { name: name.trim(), type: partyType, default_credit_days: creditDays })
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
        <div className="min-w-0 space-y-4 py-2">
          <div className="space-y-1.5"><Label>Ledger Name</Label><Input value={name} onChange={event => setName(event.target.value)} autoFocus /></div>
          {party ? (
            <><div className="space-y-1.5"><Label>Party Type</Label><SearchableSelect value={partyType} onValueChange={value => setPartyType(value as 'customer' | 'supplier')} options={[{ value: 'customer', label: partyTerminology('customer').plural, searchText: partyTerminology('customer').searchAliases }, { value: 'supplier', label: partyTerminology('supplier').plural, searchText: partyTerminology('supplier').searchAliases }]} /></div><div className="space-y-1.5"><Label>Default Credit Days</Label><Input type="number" min="0" step="1" value={defaultCreditDays} onChange={event => setDefaultCreditDays(event.target.value)} /><p className="text-xs text-muted-foreground">Used automatically on new credit invoices.</p></div></>
          ) : (
            <div className="space-y-1.5"><Label>Category</Label><SearchableSelect value={categoryId} onValueChange={setCategoryId} disabled={!!account?.is_system} placeholder="Select category" options={activeCategories.map(category => ({ value: category.id, label: categoryOptionLabel(accountCategories, category.id), searchText: categoryPath(accountCategories, category.id), group: category.account_type }))} /></div>
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

export function ItemDialog({ item, open, onClose }: { item: Item | null; open: boolean; onClose: () => void }) {
  const { itemCategories, vouchers, alterItem } = useAppStore()
  const [form, setForm] = useState({ name: '', category_id: '', unit: 'Pcs', alternate_unit: '', alternate_conversion: '', sell_rate: '0', opening_qty: '0', opening_rate: '0', reorder_level: '', sku: '', barcode: '', vat_applicable: true })
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
    if (!form.name.trim()) return setError('Item name is required.')
    const altUnit = form.alternate_unit.trim()
    const altFactor = Number(form.alternate_conversion)
    const unitError = validateItemUnits(form.unit, altUnit, [item.unit, item.alternate_unit || ''])
    if (unitError) return setError(unitError)
    if (altUnit && altFactor <= 1) return setError('Alternative units per main unit must be greater than 1.')
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
        <div className="space-y-1.5 sm:col-span-2"><Label>Category</Label><SearchableSelect value={form.category_id} onValueChange={value => setForm({ ...form, category_id: value })} placeholder="Select category" options={itemCategories.filter(category => !category.is_archived).map(category => ({ value: category.id, label: categoryOptionLabel(itemCategories, category.id), searchText: categoryPath(itemCategories, category.id) }))} /></div>
        <div className="space-y-1.5"><Label>Main Unit</Label><UnitCombobox value={form.unit} onValueChange={value => setForm({ ...form, unit: value })} exclude={[form.alternate_unit]} /></div>
        <div className="space-y-1.5"><Label>Sell Rate</Label><Input type="number" value={form.sell_rate} onChange={event => setForm({ ...form, sell_rate: event.target.value })} /></div>
        <div className="space-y-1.5"><Label>Alternative Unit</Label><UnitCombobox value={form.alternate_unit} onValueChange={value => { setForm({ ...form, alternate_unit: value, alternate_conversion: value ? form.alternate_conversion : '' }); if (!value) setOpeningUnitMode('main') }} optional exclude={[form.unit]} /></div>
        <div className="space-y-1.5"><Label>Conversion Quantity</Label><Input type="number" min="1.0001" placeholder={form.alternate_unit ? 'Enter manually' : 'Select alternative unit first'} value={form.alternate_conversion} onChange={event => setForm({ ...form, alternate_conversion: event.target.value })} disabled={!form.alternate_unit} /><p className="text-[11px] text-muted-foreground">Number of alternative units in one main unit</p></div>
        {form.alternate_unit.trim() && Number(form.alternate_conversion) > 1 && <p className="text-xs text-muted-foreground sm:col-span-2">1 {form.unit.trim()} = {form.alternate_conversion} {form.alternate_unit.trim()}</p>}
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
  const { company, accounts, rawAccounts, accountCategories, parties, loading, error, alterAccount, alterParty, alterAccountCategory } = useAppStore()
  const [tab, setTab] = useState('ledgers')
  const [searchByTab, setSearchByTab] = useState<Record<string, string>>({ ledgers: '', categories: '', history: '' })
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ category?: AccountCategory | null; parentCategory?: AccountCategory | null } | null>(null)
  const [changeLogs, setChangeLogs] = useState<MasterChangeLog[]>([])
  const [historyError, setHistoryError] = useState('')
  const search = searchByTab[tab] || ''
  const q = normalizeSearch(search)
  const partyByAccount = new Map(parties.map(party => [party.account_id, party]))
  const ledgerRows = rawAccounts.filter(account => { const party = partyByAccount.get(account.id); return !q || normalizeSearch(`${account.name} ${account.group} ${account.type} ${party?.name || ''} ${party ? partyTerminology(party.type).searchAliases : ''} ${account.is_archived || party?.is_archived ? 'archived' : account.is_system ? 'system' : 'active'}`).includes(q) }).sort((a, b) => a.name.localeCompare(b.name))
  const accountCategoryTree = buildCategoryTree(accountCategories, rawAccounts)
  const filteredChangeLogs = changeLogs.filter(log => !q || normalizeSearch(`${log.record_type} ${log.action} ${Object.keys(log.new_values || {}).join(' ')} ${new Date(log.created_at).toLocaleString()}`).includes(q))
  const searchPlaceholder = `Search ${tab}…`
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
        <Tabs value={tab} onValueChange={setTab}><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="overflow-x-auto pb-1"><TabsList className="w-max"><TabsTrigger value="ledgers">Ledgers</TabsTrigger><TabsTrigger value="categories">Account Categories</TabsTrigger><TabsTrigger value="history">Change History</TabsTrigger></TabsList></div>
          <div className="flex flex-wrap gap-2">{tab !== 'categories' && <div className="relative min-w-0 flex-1 sm:flex-none"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearchByTab(current => ({ ...current, [tab]: event.target.value }))} placeholder={searchPlaceholder} className="w-full pl-8 sm:w-64" /></div>}{tab === 'ledgers' && <Button onClick={() => openLedger()}><Plus className="mr-1.5 h-4 w-4" />New Ledger</Button>}</div></div>
          {search && tab === 'ledgers' && ledgerRows.length === 0 && <p className="w-full rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No matching ledgers.</p>}
          <TabsContent value="ledgers"><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Ledger</th><th className="report-th text-left">Category</th><th className="report-th text-left">Type</th><th className="report-th text-right">Balance</th><th className="report-th text-left">Status</th><th className="report-th"></th></tr></thead><tbody>{ledgerRows.map(account => { const current = accounts.find(item => item.id === account.id); const party = partyByAccount.get(account.id); const archived = party?.is_archived || account.is_archived; return <tr key={account.id} className={`border-t ${archived ? 'opacity-55' : ''}`}><td className="report-td font-medium">{account.name}{party && <span className="ml-2 text-xs text-muted-foreground">{partyTerminology(party.type).singular}</span>}</td><td className="report-td text-muted-foreground">{categoryPath(accountCategories, account.category_id) || account.group}</td><td className="report-td">{account.type}</td><td className="report-td text-right num font-semibold">{fmtMoney(current?.balance || 0)}</td><td className="report-td"><Badge variant={archived ? 'secondary' : account.is_system ? 'outline' : 'default'}>{archived ? 'Archived' : account.is_system ? 'System' : 'Active'}</Badge></td><td className="report-td"><div className="flex justify-end gap-1"><Button title="Open ledger report" variant="ghost" size="icon" onClick={() => navigate(`/reports/ledger?account=${encodeURIComponent(account.id)}`)}><ExternalLink className="h-4 w-4" /></Button><Button title="Alter ledger" variant="ghost" size="icon" onClick={() => openLedger(account)}><Pencil className="h-4 w-4" /></Button>{!account.is_system && <Button title={archived ? 'Restore ledger' : 'Archive ledger'} variant="ghost" size="icon" onClick={() => toggleLedger(account)}>{archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button>}</div></td></tr>})}</tbody></table></div></Card></TabsContent>
          <TabsContent value="categories"><div className="space-y-4"><CategoryTable kind="account" title="Account Categories" rows={accountCategoryTree} loading={loading} error={error} onAdd={() => setCategoryDialog({})} onAddChild={parentCategory => setCategoryDialog({ parentCategory: parentCategory as AccountCategory })} onEdit={category => setCategoryDialog({ category: category as AccountCategory })} onArchive={category => alterAccountCategory(category.id, { is_archived: !category.is_archived })} /><CategoryLegend kind="account" /></div></TabsContent>
          <TabsContent value="history"><Card className="overflow-hidden">{historyError ? <p className="p-4 text-sm text-destructive">{historyError}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">When</th><th className="report-th text-left">Record</th><th className="report-th text-left">Action</th><th className="report-th text-left">Changed Fields</th></tr></thead><tbody>{filteredChangeLogs.map(log => <tr key={log.id} className="border-t"><td className="report-td whitespace-nowrap text-muted-foreground">{new Date(log.created_at).toLocaleString()}</td><td className="report-td font-medium">{log.record_type.replaceAll('_', ' ')}</td><td className="report-td">{log.action.replaceAll('_', ' ')}</td><td className="report-td text-muted-foreground">{Object.keys(log.new_values || {}).join(', ') || '-'}</td></tr>)}{filteredChangeLogs.length === 0 && <tr><td colSpan={4} className="p-12 text-center text-muted-foreground">{search ? 'No matching history records.' : 'No master changes recorded yet.'}</td></tr>}</tbody></table></div>}</Card></TabsContent>
        </Tabs>
      </PageContent>
      <LedgerDialog account={editingAccount} party={selectedParty} open={ledgerOpen} onClose={() => { setLedgerOpen(false); setEditingAccount(null) }} />
      <CategoryDialog kind="account" category={categoryDialog?.category} parentCategory={categoryDialog?.parentCategory} open={!!categoryDialog} onClose={() => setCategoryDialog(null)} />
    </div>
  )
}

type CategoryRow = CategoryTreeNode<AccountCategory, Account> | CategoryTreeNode<ItemCategory, Item>

type CategoryStatus = 'all' | 'active' | 'inactive'

function filterCategoryTree(rows: CategoryRow[], query: string, status: CategoryStatus): CategoryRow[] {
  return rows.flatMap(row => {
    const children = filterCategoryTree(row.children, query, status)
    const statusMatches = status === 'all' || (status === 'inactive' ? row.category.is_archived : !row.category.is_archived)
    const queryMatches = !query || normalizeSearch(`${row.path} ${'account_type' in row.category ? row.category.account_type : 'item category'} ${row.category.is_archived ? 'inactive archived' : 'active'}`).includes(query)
    return (statusMatches && queryMatches) || children.length ? [{ ...row, children } as CategoryRow] : []
  })
}

function flattenVisibleCategoryTree(rows: CategoryRow[], expanded: Set<string>, revealAll: boolean): CategoryRow[] {
  return rows.flatMap(row => [row, ...(revealAll || expanded.has(row.category.id) ? flattenVisibleCategoryTree(row.children, expanded, revealAll) : [])])
}

function CategoryIcon({ kind, row, childCount = row.children.length, className = 'h-4 w-4' }: { kind: 'account' | 'item'; row: CategoryRow; childCount?: number; className?: string }) {
  const name = row.category.name.toLowerCase()
  const iconClass = cn(className, 'shrink-0 text-[#806f5b]')
  if (childCount) return <Folder className={iconClass} />
  if (kind === 'item') {
    if (/repair|maintenance|service/.test(name)) return <Wrench className={iconClass} />
    if (row.depth >= 3 || /accessor/.test(name)) return <Tag className={iconClass} />
    return <Package className={iconClass} />
  }
  if (/bank/.test(name)) return <Landmark className={iconClass} />
  if (/debtor|creditor|customer|supplier/.test(name)) return <UserRound className={iconClass} />
  return <FileText className={iconClass} />
}

export function CategoryLegend({ kind }: { kind: 'account' | 'item' }) {
  const entries = [
    { label: 'Parent Category', icon: Folder },
    { label: kind === 'account' ? 'Account Category' : 'Item Category', icon: kind === 'account' ? Landmark : Package },
    { label: 'Sub Category', icon: Tag },
    { label: 'Leaf Category', icon: FileText },
  ]
  return <div className="col-span-full flex flex-wrap items-center gap-x-8 gap-y-2 border-l px-4 py-1 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Legend:</span>{entries.map(entry => <span key={entry.label} className="flex items-center gap-2"><entry.icon className="h-4 w-4 text-[#806f5b]" />{entry.label}</span>)}</div>
}

function CategoryActions({ row, onAddChild, onEdit, onArchive, onError }: { row: CategoryRow; onAddChild: (category: AccountCategory | ItemCategory) => void; onEdit: (category: AccountCategory | ItemCategory) => void; onArchive: (category: AccountCategory | ItemCategory) => Promise<void> | void; onError: (message: string) => void }) {
  const category = row.category
  const system = 'is_system' in category && category.is_system
  const canAddChild = row.depth < 3 && !category.is_archived
  const canDelete = !system && !category.is_archived && row.totalCount === 0
  const runArchive = async () => {
    try { await onArchive(category) } catch (error: unknown) { onError((error as Error).message) }
  }

  return <DropdownMenuPrimitive.Root>
    <DropdownMenuPrimitive.Trigger asChild>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Actions for ${category.name}`} onClick={event => event.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button>
    </DropdownMenuPrimitive.Trigger>
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content align="end" sideOffset={4} className="z-[80] min-w-44 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
        <DropdownMenuPrimitive.Item disabled={system} onSelect={() => onEdit(category)} className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><Pencil className="h-3.5 w-3.5" />Edit</DropdownMenuPrimitive.Item>
        <DropdownMenuPrimitive.Item disabled={!canAddChild} onSelect={() => onAddChild(category)} className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><FolderPlus className="h-3.5 w-3.5" />Add child category</DropdownMenuPrimitive.Item>
        <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" />
        {category.is_archived
          ? <DropdownMenuPrimitive.Item disabled={system} onSelect={runArchive} className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Restore</DropdownMenuPrimitive.Item>
          : <DropdownMenuPrimitive.Item disabled={!canDelete} onSelect={runArchive} className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-destructive outline-none focus:bg-destructive/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete</DropdownMenuPrimitive.Item>}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  </DropdownMenuPrimitive.Root>
}

export function CategoryTable({ kind, title, rows, loading, error, onAdd, onAddChild, onEdit, onArchive }: { kind: 'account' | 'item'; title: string; rows: CategoryRow[]; loading: boolean; error: string | null; onAdd: () => void; onAddChild: (category: AccountCategory | ItemCategory) => void; onEdit: (category: AccountCategory | ItemCategory) => void; onArchive: (category: AccountCategory | ItemCategory) => Promise<void> | void }) {
  const initialIds = () => new Set(flattenCategoryTree(rows).filter(row => row.children.length).map(row => row.category.id))
  const [expanded, setExpanded] = useState<Set<string>>(initialIds)
  const [selectedId, setSelectedId] = useState<string | null>(() => rows[0]?.category.id || null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CategoryStatus>('all')
  const [actionError, setActionError] = useState('')
  const knownIds = useRef(new Set(flattenCategoryTree(rows).map(row => row.category.id)))
  const query = normalizeSearch(search)
  const filteredTree = filterCategoryTree(rows, query, status)
  const visibleRows = flattenVisibleCategoryTree(filteredTree, expanded, !!query)
  const recordLabel = kind === 'account' ? 'account' : 'item'
  const childCountById = new Map(flattenCategoryTree(rows).map(row => [row.category.id, row.children.length]))
  const expandableIds = flattenCategoryTree(filteredTree).filter(row => row.children.length).map(row => row.category.id)
  const allExpanded = expandableIds.length > 0 && expandableIds.every(id => expanded.has(id))

  useEffect(() => {
    const allRows = flattenCategoryTree(rows)
    const newParents = allRows.filter(row => row.children.length && !knownIds.current.has(row.category.id)).map(row => row.category.id)
    if (newParents.length) setExpanded(current => new Set([...current, ...newParents]))
    knownIds.current = new Set(allRows.map(row => row.category.id))
  }, [rows])

  useEffect(() => {
    if (!selectedId && rows[0]) setSelectedId(rows[0].category.id)
  }, [rows, selectedId])

  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return <Card className="min-w-0 overflow-hidden">
    <div className="border-b p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="min-w-0 truncate font-serif font-bold">{title}</h3><Button size="sm" variant="outline" onClick={onAdd}><Plus className="mr-1 h-3.5 w-3.5" />New</Button></div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} className="w-full pl-8" /></div>
        <SearchableSelect value={status} onValueChange={value => setStatus(value as CategoryStatus)} className="sm:w-32" options={[{ value: 'all', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <ExpandCollapseControls expanded={allExpanded} onToggle={() => { if (allExpanded) { setSearch(''); setExpanded(new Set()) } else setExpanded(new Set(expandableIds)) }} />
      </div>
    </div>
    {(error || actionError) && <div role="alert" className="flex items-start gap-2 border-b bg-destructive/5 px-3 py-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{actionError || error}</span></div>}
    {loading ? <div className="space-y-px bg-border" aria-label={`Loading ${title.toLowerCase()}`}>{[0, 1, 2, 3].map(index => <div key={index} className="flex h-12 items-center gap-3 bg-card px-3"><div className="h-4 w-4 animate-pulse rounded bg-muted" /><div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${45 + index * 8}%` }} /></div>)}</div>
      : visibleRows.length ? <div role="tree" aria-label={title} className="divide-y">
        {visibleRows.map(row => {
          const category = row.category
          const hasChildren = row.children.length > 0
          const childCount = childCountById.get(category.id) || 0
          const open = !!query || expanded.has(category.id)
          const selected = selectedId === category.id
          return <div key={category.id} role="treeitem" aria-level={row.depth} aria-expanded={hasChildren ? open : undefined} aria-selected={selected} tabIndex={0} onClick={() => setSelectedId(category.id)} onFocus={() => setSelectedId(category.id)} className={cn('group relative grid min-h-12 cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring', selected && 'bg-muted/60', category.is_archived && 'text-muted-foreground')}>
            {row.depth > 1 && <><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l border-dashed border-border" style={{ left: `${0.75 + (row.depth - 1) * 1.125}rem` }} /><span aria-hidden="true" className="pointer-events-none absolute w-4 border-t border-dashed border-border" style={{ left: `${0.75 + (row.depth - 1) * 1.125}rem`, top: '50%' }} /></>}
            <div className="flex min-w-0 items-center" style={{ paddingLeft: `${(row.depth - 1) * 1.125}rem` }}>
              {hasChildren ? <button type="button" aria-label={`${open ? 'Collapse' : 'Expand'} ${category.name}`} className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground" onClick={event => { event.stopPropagation(); toggle(category.id) }}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> : <span className="mr-1 h-6 w-6 shrink-0" />}
              <CategoryIcon kind={kind} row={row} childCount={childCount} />
              <div className="ml-3 min-w-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold">{category.name}</span>{category.is_archived && <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">Inactive</Badge>}</div><p className="truncate text-[11px] text-muted-foreground">{'account_type' in category ? category.account_type : 'Item category'}</p></div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="hidden items-center gap-3 whitespace-nowrap text-[11px] text-muted-foreground sm:flex"><span title={`Records directly assigned to ${category.name}`} className="rounded bg-background/80 px-2 py-1"><strong className="font-medium text-foreground">{row.directCount}</strong> direct</span><span title={`Records in ${category.name} and all child categories`} className="rounded bg-background/80 px-2 py-1"><strong className="font-medium text-foreground">{row.totalCount}</strong> total</span><span title={`Categories immediately below ${category.name}`} className="rounded bg-background/80 px-2 py-1"><strong className="font-medium text-foreground">{childCount}</strong> {childCount === 1 ? 'child' : 'children'}</span></div>
              <CategoryActions row={row} onAddChild={onAddChild} onEdit={onEdit} onArchive={onArchive} onError={setActionError} />
            </div>
            <p className="col-span-2 pl-7 text-[11px] text-muted-foreground sm:hidden" style={{ marginLeft: `${(row.depth - 1) * 1.125}rem` }}>{row.directCount} direct {recordLabel}{row.directCount === 1 ? '' : 's'} / {row.totalCount} total {recordLabel}{row.totalCount === 1 ? '' : 's'} / {childCount} {childCount === 1 ? 'child' : 'children'}</p>
          </div>
        })}
      </div> : <div className="px-4 py-10 text-center"><p className="text-sm font-medium">{search || status !== 'all' ? 'No matching categories' : 'No categories yet'}</p><p className="mt-1 text-xs text-muted-foreground">{search || status !== 'all' ? 'Try changing your search or status filter.' : `Create a ${recordLabel} category to get started.`}</p></div>}
  </Card>
}
