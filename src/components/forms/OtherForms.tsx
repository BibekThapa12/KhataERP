import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { todayBs } from '@/lib/nepaliDate'
import { resolveSystemAccountId, round2 } from '@/lib/engine'
import { toBaseQty, toBaseRate, type UnitMode } from '@/lib/units'
import { categoryOptionLabel, categoryPath } from '@/lib/categoryHierarchy'
import { bankAccounts, legacySettlementAccountId } from '@/lib/banks'
import { suggestSettlementAllocations } from '@/lib/managementReports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { LedgerBalanceHint } from './LedgerBalanceHint'
import type { Item, Voucher } from '@/types'
import type { VoucherLine } from '@/types'

// ─── Item Form ────────────────────────────────────────────────────────────────

interface ItemFormProps {
  open: boolean
  onClose: () => void
  onCreated?: (item: Item) => void
}

export function ItemForm({ open, onClose, onCreated }: ItemFormProps) {
  const addItem = useAppStore(s => s.addItem)
  const itemCategories = useAppStore(s => s.itemCategories)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('pcs')
  const [alternateUnit, setAlternateUnit] = useState('')
  const [alternateConversion, setAlternateConversion] = useState(0)
  const [openingUnitMode, setOpeningUnitMode] = useState<UnitMode>('main')
  const [sellRate, setSellRate] = useState(0)
  const [openingQty, setOpeningQty] = useState(0)
  const [openingRate, setOpeningRate] = useState(0)
  const [reorderLevel, setReorderLevel] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [vatApplicable, setVatApplicable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && !categoryId) setCategoryId(itemCategories.find(category => category.name === 'General' && !category.is_archived)?.id || itemCategories.find(category => !category.is_archived)?.id || '')
    if (!open) { setName(''); setUnit('pcs'); setAlternateUnit(''); setAlternateConversion(0); setOpeningUnitMode('main'); setSellRate(0); setOpeningQty(0); setOpeningRate(0); setReorderLevel(''); setCategoryId(''); setSku(''); setBarcode(''); setVatApplicable(true); setError('') }
  }, [open, categoryId, itemCategories])

  const handleSave = async () => {
    if (!name.trim()) { setError('Enter an item name.'); return }
    const mainUnit = unit.trim() || 'pcs'
    const altUnit = alternateUnit.trim()
    if (altUnit && altUnit.toLowerCase() === mainUnit.toLowerCase()) { setError('Main and alternative units must be different.'); return }
    if (altUnit && alternateConversion <= 1) { setError('Alternative units per main unit must be greater than 1.'); return }
    const factor = openingUnitMode === 'alternate' && altUnit ? alternateConversion : 1
    setSaving(true)
    try {
      const item = await addItem({ name: name.trim(), unit: mainUnit, alternate_unit: altUnit || null, alternate_conversion: altUnit ? alternateConversion : null, sell_rate: sellRate, opening_qty: toBaseQty(openingQty, factor), opening_rate: toBaseRate(openingRate, factor), reorder_level: reorderLevel ? Number(reorderLevel) : undefined, category_id: categoryId || undefined, sku: sku.trim(), barcode: barcode.trim(), vat_applicable: vatApplicable })
      onCreated?.(item)
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Item</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Item Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Rice 25kg Bag" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <SearchableSelect value={categoryId} onValueChange={setCategoryId} placeholder="Select category" options={itemCategories.filter(category => !category.is_archived).map(category => ({ value: category.id, label: categoryOptionLabel(itemCategories, category.id), searchText: categoryPath(itemCategories, category.id) }))} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Main Unit</Label>
              <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="pcs, kg, box…" />
            </div>
            <div className="space-y-1.5">
              <Label>Default Sell Rate / Main Unit (Rs)</Label>
              <Input type="number" step="any" value={sellRate || ''} onChange={e => setSellRate(Number(e.target.value))} placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Alternative Unit (optional)</Label><Input value={alternateUnit} onChange={e => setAlternateUnit(e.target.value)} placeholder="box, carton…" /></div>
            <div className="space-y-1.5"><Label>Conversion Quantity</Label><Input type="number" min="1.0001" step="any" value={alternateConversion || ''} onChange={e => setAlternateConversion(Number(e.target.value))} placeholder="Enter manually" /><p className="text-[11px] text-muted-foreground">Number of alternative units in one main unit</p></div>
          </div>
          {alternateUnit.trim() && alternateConversion > 1 && <p className="text-xs text-muted-foreground">1 {unit.trim() || 'main unit'} = {alternateConversion} {alternateUnit.trim()}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Opening Stock Qty</Label>
              <Input type="number" step="any" value={openingQty || ''} onChange={e => setOpeningQty(Number(e.target.value))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Opening Cost / Selected Unit (Rs)</Label>
              <Input type="number" step="any" value={openingRate || ''} onChange={e => setOpeningRate(Number(e.target.value))} placeholder="0" />
            </div>
          </div>
          {alternateUnit.trim() && alternateConversion > 1 && <div className="space-y-1.5"><Label>Opening Stock Unit</Label><SearchableSelect value={openingUnitMode} onValueChange={value => setOpeningUnitMode(value as UnitMode)} options={[{ value: 'main', label: unit.trim() || 'pcs' }, { value: 'alternate', label: alternateUnit.trim() }]} /></div>}
          <div className="space-y-1.5">
            <Label>Reorder Level (optional)</Label>
            <Input type="number" step="any" value={reorderLevel} onChange={e => setReorderLevel(e.target.value)} placeholder="Alert when stock falls below…" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>SKU</Label><Input value={sku} onChange={e => setSku(e.target.value)} placeholder="Optional" /></div>
            <div className="space-y-1.5"><Label>Barcode</Label><Input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Optional" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vatApplicable} onChange={e => setVatApplicable(e.target.checked)} className="h-4 w-4 accent-primary" />VAT applicable</label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Item'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Receipt / Payment Form ───────────────────────────────────────────────────

interface ReceiptPaymentFormProps {
  type: 'Receipt' | 'Payment'
  open: boolean
  onClose: () => void
  voucher?: Voucher | null
}

export function ReceiptPaymentForm({ type, open, onClose, voucher }: ReceiptPaymentFormProps) {
  const { company, accounts, accountCategories, parties, vouchers, saveReceipt, savePayment, updateReceipt, updatePayment } = useAppStore()
  const isReceipt = type === 'Receipt'
  const isEditing = !!voucher

  const [dateBs, setDateBs] = useState(todayBs())
  const [allocations, setAllocations] = useState<{ account_id: string; amount: string; invoice_allocations: { invoice_voucher_id: string; amount: string }[] }[]>([{ account_id: '', amount: '', invoice_allocations: [] }])
  const cashAccountId = company ? resolveSystemAccountId(accounts, company.id, 'cash') : ''
  const banks = bankAccounts(accounts, accountCategories, !!voucher)
  const [moneyAccountId, setMoneyAccountId] = useState('')
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && voucher) {
      setDateBs(voucher.date_bs)
      const settlementId = legacySettlementAccountId(voucher) || cashAccountId
      setMoneyAccountId(settlementId)
      const restored = (voucher.lines || []).filter(line => line.account_id !== settlementId).map(line => ({ account_id: line.account_id, amount: String(isReceipt ? line.credit || 0 : line.debit || 0), invoice_allocations: (voucher.settlements || []).filter(row => row.party_account_id === line.account_id).map(row => ({ invoice_voucher_id: row.invoice_voucher_id, amount: String(row.amount) })) })).filter(line => Number(line.amount) > 0)
      setAllocations(restored.length ? restored : [{ account_id: voucher.party_account_id || '', amount: String(voucher.total || ''), invoice_allocations: [] }])
      setNarration(voucher.narration || '')
      setError('')
    } else if (open) {
      setMoneyAccountId(cashAccountId)
    } else if (!open) {
      setDateBs(todayBs()); setAllocations([{ account_id: '', amount: '', invoice_allocations: [] }]); setMoneyAccountId(cashAccountId); setNarration(''); setError('')
    }
  }, [open, voucher, cashAccountId, isReceipt])

  const moneyIds = new Set([cashAccountId, ...bankAccounts(accounts, accountCategories, true).map(account => account.id)])
  const selectedIds = new Set(allocations.map(allocation => allocation.account_id).filter(Boolean))
  const allocationAccounts = accounts.filter(account => !moneyIds.has(account.id) && (!account.is_archived || (!!voucher && selectedIds.has(account.id))))
  const total = round2(allocations.reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0))
  const partyAccountIds = new Set(parties.filter(party => party.type === (isReceipt ? 'customer' : 'supplier')).map(party => party.account_id))
  const invoiceById = new Map(vouchers.map(entry => [entry.id, entry]))
  const selectedMoneyAccount = accounts.find(account => account.id === moneyAccountId)
  const updateAllocation = (index: number, field: 'account_id' | 'amount', value: string) => setAllocations(current => current.map((allocation, row) => {
    if (row !== index) return allocation
    const next = { ...allocation, [field]: value }
    next.invoice_allocations = partyAccountIds.has(next.account_id) ? suggestSettlementAllocations(isReceipt ? 'receivable' : 'payable', next.account_id, Number(next.amount), parties, accounts, vouchers, dateBs, voucher?.id).map(item => ({ ...item, amount: String(item.amount) })) : []
    return next
  }))
  const updateInvoiceAllocation = (allocationIndex: number, invoiceId: string, value: string) => setAllocations(current => current.map((allocation, index) => index === allocationIndex ? { ...allocation, invoice_allocations: allocation.invoice_allocations.map(row => row.invoice_voucher_id === invoiceId ? { ...row, amount: value } : row) } : allocation))

  const handleSave = async () => {
    const validAllocations = allocations.map(allocation => ({ account_id: allocation.account_id, amount: Number(allocation.amount), invoice_allocations: allocation.invoice_allocations.map(row => ({ invoice_voucher_id: row.invoice_voucher_id, amount: Number(row.amount) })).filter(row => row.amount > 0) }))
    if (validAllocations.some(allocation => !allocation.account_id || allocation.amount <= 0)) { setError('Select a ledger and enter a positive amount for every row.'); return }
    if (new Set(validAllocations.map(allocation => allocation.account_id)).size !== validAllocations.length) { setError('A ledger can appear only once.'); return }
    if (validAllocations.some(allocation => round2(allocation.invoice_allocations.reduce((sum, row) => sum + row.amount, 0)) > allocation.amount)) { setError('Invoice allocations cannot exceed the ledger amount.'); return }
    setSaving(true)
    try {
      if (isReceipt) {
        if (voucher) await updateReceipt(voucher.id, { allocations: validAllocations, deposit_to_account_id: moneyAccountId, narration, date_bs: dateBs })
        else await saveReceipt({ allocations: validAllocations, deposit_to_account_id: moneyAccountId, narration, date_bs: dateBs })
      } else {
        if (voucher) await updatePayment(voucher.id, { allocations: validAllocations, paid_from_account_id: moneyAccountId, narration, date_bs: dateBs })
        else await savePayment({ allocations: validAllocations, paid_from_account_id: moneyAccountId, narration, date_bs: dateBs })
      }
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEditing ? 'Edit' : 'New'} {type}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <NepaliDateInput value={dateBs} onChange={setDateBs} />
          </div>
          <div className="space-y-1.5">
            <Label>{isReceipt ? 'Deposit to account' : 'Pay from account'}</Label>
            <SearchableSelect value={moneyAccountId} onValueChange={setMoneyAccountId} options={[{ value: cashAccountId, label: 'Cash', group: 'Cash' }, ...banks.map(account => ({ value: account.id, label: account.name, searchText: `${account.name} Bank Current Assets`, group: 'Bank Accounts', disabled: !!account.is_archived }))]} />
            <LedgerBalanceHint account={selectedMoneyAccount} />
          </div>
          <div className="space-y-2">
            <div className="hidden grid-cols-[minmax(0,1fr)_10rem_2.25rem] gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid"><span>Ledger</span><span className="text-right">Amount</span><span /></div>
            {allocations.map((allocation, index) => {
              const selectedAccount = accounts.find(account => account.id === allocation.account_id)
              const selectedParty = parties.find(party => party.account_id === allocation.account_id)
              return <div key={index} className="grid grid-cols-[minmax(0,1fr)_7rem_2.25rem] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_2.25rem]">
                <div className="min-w-0 space-y-1.5">
                  <SearchableSelect value={allocation.account_id} onValueChange={value => updateAllocation(index, 'account_id', value)} placeholder="Select ledger..." options={allocationAccounts.map(account => ({ value: account.id, label: account.name, searchText: `${categoryPath(accountCategories, account.category_id)} ${account.group} ${account.type}`, disabled: !!account.is_archived || (selectedIds.has(account.id) && account.id !== allocation.account_id) }))} />
                  <LedgerBalanceHint account={selectedAccount} party={selectedParty} />
                </div>
                <Input type="number" min="0.01" step="any" value={allocation.amount} onChange={event => updateAllocation(index, 'amount', event.target.value)} placeholder="0.00" className="text-right" />
                <Button type="button" variant="ghost" size="icon" disabled={allocations.length === 1} onClick={() => setAllocations(current => current.filter((_, row) => row !== index))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            })}
            <div className="flex flex-wrap items-center justify-between gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setAllocations(current => [...current, { account_id: '', amount: '', invoice_allocations: [] }])}><Plus className="mr-1.5 h-4 w-4" />Add ledger</Button><p className="text-sm font-semibold">Total: <span className="num">{fmtMoney(total)}</span></p></div>
          </div>
          {allocations.some(allocation => allocation.invoice_allocations.length > 0) && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Invoice allocations (oldest due first)</p>
              {allocations.map((allocation, allocationIndex) => allocation.invoice_allocations.map(row => {
                const invoice = invoiceById.get(row.invoice_voucher_id)
                return <div key={`${allocationIndex}-${row.invoice_voucher_id}`} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 text-sm"><span className="truncate">{invoice?.invoice_no || invoice?.seq || 'Invoice'} <span className="text-muted-foreground">Due {invoice?.due_date_bs || invoice?.date_bs}</span></span><Input type="number" min="0" step="any" value={row.amount} onChange={event => updateInvoiceAllocation(allocationIndex, row.invoice_voucher_id, event.target.value)} className="h-8 text-right" /></div>
              }))}
              {allocations.map((allocation, index) => partyAccountIds.has(allocation.account_id) && <p key={`unapplied-${index}`} className="text-xs text-muted-foreground">{accounts.find(account => account.id === allocation.account_id)?.name}: unapplied {fmtMoney(Math.max(0, Number(allocation.amount) - allocation.invoice_allocations.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)))}</p>)}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Narration (optional)</Label>
            <Input value={narration} onChange={e => setNarration(e.target.value)} placeholder="Note…" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : `${isEditing ? 'Update' : 'Save'} ${type}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Journal Form ─────────────────────────────────────────────────────────────

interface JournalFormProps { open: boolean; onClose: () => void; voucher?: Voucher | null }

interface JLine { account_id: string; debit: number; credit: number }

export function JournalForm({ open, onClose, voucher }: JournalFormProps) {
  const { accounts, accountCategories, parties, saveJournal, updateJournal } = useAppStore()
  const partyByAccount = new Map(parties.map(party => [party.account_id, party]))
  const journalAccounts = accounts.filter(account => {
    const party = partyByAccount.get(account.id)
    return !account.is_archived && !party?.is_archived
  })
  const isEditing = !!voucher

  const [dateBs, setDateBs] = useState(todayBs())
  const [jLines, setJLines] = useState<JLine[]>([
    { account_id: '', debit: 0, credit: 0 },
    { account_id: '', debit: 0, credit: 0 },
  ])
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && voucher) {
      setDateBs(voucher.date_bs)
      setJLines((voucher.lines || []).map(l => ({
        account_id: l.account_id,
        debit: l.debit || 0,
        credit: l.credit || 0,
      })))
      setNarration(voucher.narration || '')
      setError('')
    } else if (!open) {
      setDateBs(todayBs())
      setJLines([{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }])
      setNarration('')
      setError('')
    }
  }, [open, voucher])

  const totalDebit = round2(jLines.reduce((s, l) => s + (l.debit || 0), 0))
  const totalCredit = round2(jLines.reduce((s, l) => s + (l.credit || 0), 0))
  const diff = round2(totalDebit - totalCredit)
  const balanced = Math.abs(diff) < 0.005

  const updateLine = (idx: number, field: keyof JLine, value: string | number) => {
    const next = [...jLines]
    if (field === 'debit' && Number(value) > 0) next[idx] = { ...next[idx], debit: Number(value), credit: 0 }
    else if (field === 'credit' && Number(value) > 0) next[idx] = { ...next[idx], credit: Number(value), debit: 0 }
    else next[idx] = { ...next[idx], [field]: field === 'account_id' ? value : Number(value) }
    setJLines(next)
  }

  const handleSave = async () => {
    const validLines = jLines.filter(l => l.account_id && (l.debit > 0 || l.credit > 0))
    if (validLines.length < 2) { setError('Add at least two lines.'); return }
    if (!balanced) { setError(`Debits and credits differ by ${fmtMoney(Math.abs(diff))}.`); return }
    setSaving(true)
    try {
      const params = { lines: validLines as Omit<VoucherLine, 'id' | 'voucher_id'>[], narration, date_bs: dateBs }
      if (voucher) await updateJournal(voucher.id, params)
      else await saveJournal(params)
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEditing ? 'Edit' : 'New'} Journal Entry</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Use this for adjustments not covered by other voucher types: depreciation, write-offs, opening balances, etc.
        </p>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <NepaliDateInput value={dateBs} onChange={setDateBs} className="max-w-[180px]" />
          </div>

          {/* Lines header */}
          <div className="hidden grid-cols-[2fr_1fr_1fr_auto] gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Account</span><span>Debit</span><span>Credit</span><span></span>
          </div>
          {jLines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-center sm:border-0 sm:p-0">
              <SearchableSelect className="col-span-2 sm:col-span-1" value={line.account_id} onValueChange={v => updateLine(idx, 'account_id', v)} placeholder="Select account…" options={journalAccounts.sort((a,b) => a.name.localeCompare(b.name)).map(account => {
                const party = partyByAccount.get(account.id)
                return {
                  value: account.id,
                  label: account.name,
                  group: party ? (party.type === 'customer' ? 'Customers' : 'Suppliers') : account.type,
                  searchText: `${categoryPath(accountCategories, account.category_id)} ${account.group} ${account.type} ${party?.phone || ''} ${party?.pan_vat || ''} ${party?.address || ''}`,
                }
              })} />
              <Input type="number" min="0" step="any" value={line.debit || ''} disabled={line.credit > 0} onChange={e => updateLine(idx, 'debit', e.target.value)} placeholder="0.00" className="text-right disabled:bg-muted" />
              <Input type="number" min="0" step="any" value={line.credit || ''} disabled={line.debit > 0} onChange={e => updateLine(idx, 'credit', e.target.value)} placeholder="0.00" className="text-right disabled:bg-muted" />
              <Button variant="ghost" size="icon" tabIndex={-1} className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => setJLines(jLines.filter((_, i) => i !== idx))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <LedgerBalanceHint className="col-span-2 sm:col-span-4" account={accounts.find(account => account.id === line.account_id)} party={partyByAccount.get(line.account_id)} />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setJLines([...jLines, { account_id: '', debit: 0, credit: 0 }])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add line
          </Button>

          {/* Balance check */}
          <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Total Debit</span><span className="num debit-amt">{fmtMoney(totalDebit)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total Credit</span><span className="num credit-amt">{fmtMoney(totalCredit)}</span></div>
            <div className={`flex justify-between font-semibold border-t border-border pt-1 ${balanced ? 'text-forest' : 'text-destructive'}`}>
              <span>{balanced ? 'Balanced ✓' : 'Difference'}</span>
              <span className="num">{balanced ? fmtMoney(0) : fmtMoney(Math.abs(diff))}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Narration</Label>
            <Textarea value={narration} onChange={e => setNarration(e.target.value)} placeholder="What is this adjustment for?" rows={2} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !balanced}>{saving ? 'Saving...' : `${isEditing ? 'Update' : 'Save'} Journal Entry`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
