import { lazy, useState, useEffect, useMemo, useRef } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
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
import { UnitCombobox } from '@/components/inputs/UnitCombobox'
import { validateItemUnits } from '@/lib/itemUnits'
import { formatRateInput, rateInputNumber } from '@/lib/rateFormat'
import { Textarea } from '@/components/ui/misc'
import { publicErrorMessage } from '@/lib/security'
import { friendlyVoucherDateError, validateVoucherDateForNumbering } from '@/lib/voucherDateValidation'
import { notifyError } from '@/lib/notifications'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { LedgerBalanceHint } from './LedgerBalanceHint'
import { VoucherNumberField } from './VoucherNumberField'
import { SubmissionLock } from '@/lib/submissionLock'
import { formatMasterName } from '@/lib/nameFormat'
import type { Item, Voucher } from '@/types'
import type { VoucherLine } from '@/types'

const LedgerDialog = lazy(() => import('@/pages/Masters').then(module => ({ default: module.LedgerDialog })))
const CategoryDialog = lazy(() => import('@/pages/Masters').then(module => ({ default: module.CategoryDialog })))

function itemFormError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : ''
  if (/stock item\b.*already exists?|duplicate item/i.test(message)) return 'Stock item already exist'
  if (/unit\b.*already exists?|main and alternative units must be different/i.test(message)) return 'Unit already exist'
  return publicErrorMessage(error, 'saving item')
}

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
  const [unit, setUnit] = useState('Pcs')
  const [alternateUnit, setAlternateUnit] = useState('')
  const [alternateConversion, setAlternateConversion] = useState(0)
  const [openingUnitMode, setOpeningUnitMode] = useState<UnitMode>('main')
  const [sellRate, setSellRate] = useState('0')
  const [openingQty, setOpeningQty] = useState(0)
  const [openingRate, setOpeningRate] = useState('0')
  const [reorderLevel, setReorderLevel] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [vatApplicable, setVatApplicable] = useState(true)
  const [isService, setIsService] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submissionLock = useRef(new SubmissionLock()).current

  useEffect(() => {
    if (open && !categoryId) setCategoryId(itemCategories.find(category => category.name === 'General' && !category.is_archived)?.id || itemCategories.find(category => !category.is_archived)?.id || '')
    if (!open) { setName(''); setUnit('Pcs'); setAlternateUnit(''); setAlternateConversion(0); setOpeningUnitMode('main'); setSellRate('0'); setOpeningQty(0); setOpeningRate('0'); setReorderLevel(''); setCategoryId(''); setCategoryDialogOpen(false); setSku(''); setBarcode(''); setVatApplicable(true); setIsService(false); setError('') }
  }, [open, categoryId, itemCategories])

  const handleSave = async () => {
    const itemName = formatMasterName(name)
    setName(itemName)
    if (!itemName) { setError('Enter an item name.'); return }
    const mainUnit = isService ? 'Service' : unit.trim()
    const altUnit = isService ? '' : alternateUnit.trim()
    if (!isService) {
      const unitError = validateItemUnits(mainUnit, altUnit)
      if (unitError) { setError(unitError); return }
      if (altUnit && alternateConversion <= 1) { setError('Alternative units per main unit must be greater than 1.'); return }
    }
    const factor = !isService && openingUnitMode === 'alternate' && altUnit ? alternateConversion : 1
    if (!submissionLock.tryAcquire()) return
    setSaving(true)
    try {
      const item = await addItem({ name: itemName, unit: mainUnit, alternate_unit: altUnit || null, alternate_conversion: altUnit ? alternateConversion : null, sell_rate: rateInputNumber(sellRate), opening_qty: isService ? 0 : toBaseQty(openingQty, factor), opening_rate: isService ? 0 : toBaseRate(rateInputNumber(openingRate), factor), reorder_level: isService ? undefined : (reorderLevel ? Number(reorderLevel) : undefined), category_id: categoryId || undefined, sku: sku.trim(), barcode: barcode.trim(), vat_applicable: vatApplicable, is_service: isService })
      onCreated?.(item)
      onClose()
    } catch (e: unknown) {
      setError(itemFormError(e))
    } finally { submissionLock.release(); setSaving(false) }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Item</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Item Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => setName(current => formatMasterName(current))} placeholder="Rice 25kg Bag" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <div className="flex gap-1.5">
              <SearchableSelect className="min-w-0 flex-1" value={categoryId} onValueChange={setCategoryId} placeholder="Select category" options={itemCategories.filter(category => !category.is_archived).map(category => ({ value: category.id, label: categoryOptionLabel(itemCategories, category.id), searchText: categoryPath(itemCategories, category.id) }))} />
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Create new item category" title="Create new category" onClick={() => setCategoryDialogOpen(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm"><input type="checkbox" checked={isService} onChange={e => setIsService(e.target.checked)} className="h-4 w-4 accent-primary" />This item is a service</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!isService && <div className="space-y-1.5">
              <Label>Main Unit</Label>
              <UnitCombobox value={unit} onValueChange={setUnit} exclude={[alternateUnit]} />
            </div>}
            <div className="space-y-1.5">
              <Label>Default Sell Rate / Main Unit (Rs)</Label>
              <Input type="number" step="any" value={sellRate} onChange={e => setSellRate(e.target.value)} onBlur={() => setSellRate(current => formatRateInput(current))} placeholder="0" />
            </div>
          </div>
          {!isService && <><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Alternative Unit (optional)</Label><UnitCombobox value={alternateUnit} onValueChange={value => { setAlternateUnit(value); if (!value) { setAlternateConversion(0); setOpeningUnitMode('main') } }} optional exclude={[unit]} /></div>
            <div className="space-y-1.5"><Label>Conversion Quantity</Label><Input type="number" min="1.0001" step="any" value={alternateConversion || ''} onChange={e => setAlternateConversion(Number(e.target.value))} placeholder={alternateUnit ? 'Enter manually' : 'Select alternative unit first'} disabled={!alternateUnit} /><p className="text-[11px] text-muted-foreground">Number of alternative units in one main unit</p></div>
          </div>
          {alternateUnit.trim() && alternateConversion > 1 && <p className="text-xs text-muted-foreground">1 {unit.trim() || 'main unit'} = {alternateConversion} {alternateUnit.trim()}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Opening Stock Qty</Label>
              <Input type="number" step="any" value={openingQty || ''} onChange={e => setOpeningQty(Number(e.target.value))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Opening Cost / Selected Unit (Rs)</Label>
              <Input type="number" step="any" value={openingRate} onChange={e => setOpeningRate(e.target.value)} onBlur={() => setOpeningRate(current => formatRateInput(current))} placeholder="0" />
            </div>
          </div>
          {alternateUnit.trim() && alternateConversion > 1 && <div className="space-y-1.5"><Label>Opening Stock Unit</Label><SearchableSelect value={openingUnitMode} onValueChange={value => setOpeningUnitMode(value as UnitMode)} options={[{ value: 'main', label: unit.trim() || 'pcs' }, { value: 'alternate', label: alternateUnit.trim() }]} /></div>}
          <div className="space-y-1.5">
            <Label>Reorder Level (optional)</Label>
            <Input type="number" step="any" value={reorderLevel} onChange={e => setReorderLevel(e.target.value)} placeholder="Alert when stock falls below…" />
          </div>
          </>}<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
    <CategoryDialog kind="item" open={categoryDialogOpen} onClose={() => setCategoryDialogOpen(false)} onCreated={category => setCategoryId(category.id)} />
    </>
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
  const { company, accounts, accountCategories, parties, vouchers, saveReceipt, savePayment, updateReceipt, updatePayment, saveDraftVoucher, deleteDraftVoucher } = useAppStore()
  const isReceipt = type === 'Receipt'
  const isEditing = !!voucher

  const [dateBs, setDateBs] = useState(() => selectedFiscalYearEndBs(company))
  const [allocations, setAllocations] = useState<{ account_id: string; amount: string; invoice_allocations: { invoice_voucher_id: string; amount: string }[] }[]>([{ account_id: '', amount: '', invoice_allocations: [] }])
  const cashAccountId = company ? resolveSystemAccountId(accounts, company.id, 'cash') : ''
  const banks = bankAccounts(accounts, accountCategories, !!voucher)
  const [moneyAccountId, setMoneyAccountId] = useState('')
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ledgerLineIndex, setLedgerLineIndex] = useState<number | null>(null)
  const moneyAccountTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const submissionLock = useRef(new SubmissionLock()).current
  const [dateInvalid, setDateInvalid] = useState(false)

  useEffect(() => {
    if (open && voucher) {
      const draft = voucher.status === 'Draft' ? voucher.draft_payload as Partial<{ dateBs: string; allocations: typeof allocations; moneyAccountId: string; narration: string }> | null : null
      setDateBs(voucher.date_bs)
      const settlementId = legacySettlementAccountId(voucher) || cashAccountId
      setMoneyAccountId(draft?.moneyAccountId || settlementId)
      const restored = (voucher.lines || []).filter(line => line.account_id !== settlementId).map(line => ({ account_id: line.account_id, amount: String(isReceipt ? line.credit || 0 : line.debit || 0), invoice_allocations: (voucher.settlements || []).filter(row => row.party_account_id === line.account_id).map(row => ({ invoice_voucher_id: row.invoice_voucher_id, amount: String(row.amount) })) })).filter(line => Number(line.amount) > 0)
      setAllocations(draft?.allocations?.length ? draft.allocations : restored.length ? restored : [{ account_id: voucher.party_account_id || '', amount: String(voucher.total || ''), invoice_allocations: [] }])
      setNarration(draft?.narration ?? voucher.narration ?? '')
      setError('')
      setDateInvalid(false)
    } else if (open) {
      setMoneyAccountId(cashAccountId)
    } else if (!open) {
      setDateBs(selectedFiscalYearEndBs(company)); setAllocations([{ account_id: '', amount: '', invoice_allocations: [] }]); setMoneyAccountId(cashAccountId); setNarration(''); setError(''); setDateInvalid(false)
    }
  }, [open, voucher, cashAccountId, isReceipt, company])

  const moneyIds = new Set([cashAccountId, ...bankAccounts(accounts, accountCategories, true).map(account => account.id)])
  const selectedIds = new Set(allocations.map(allocation => allocation.account_id).filter(Boolean))
  const allocationAccounts = accounts.filter(account => !moneyIds.has(account.id) && (!account.is_archived || (!!voucher && selectedIds.has(account.id))))
  const total = round2(allocations.reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0))
  const dateValidation = useMemo(() => company ? validateVoucherDateForNumbering({ company, vouchers, type, dateBs, currentVoucherId: voucher?.status === 'Draft' ? undefined : voucher?.id, invoiceNo: voucher?.invoice_no, status: 'Completed' }) : { valid: true }, [company, vouchers, type, dateBs, voucher?.id, voucher?.invoice_no, voucher?.status])
  useEffect(() => {
    if (dateInvalid && dateValidation.valid) setDateInvalid(false)
  }, [dateInvalid, dateValidation.valid])
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

  const handleSave = async (status: Voucher['status'] = 'Completed') => {
    if (status === 'Completed' && !dateValidation.valid) {
      const message = friendlyVoucherDateError(null, dateValidation) || 'Cannot save voucher. Voucher date is invalid.'
      setDateInvalid(true)
      setError(message)
      notifyError(message)
      setTimeout(() => dateInputRef.current?.focus(), 0)
      return
    }
    const validAllocations = allocations.map(allocation => ({ account_id: allocation.account_id, amount: Number(allocation.amount), invoice_allocations: allocation.invoice_allocations.map(row => ({ invoice_voucher_id: row.invoice_voucher_id, amount: Number(row.amount) })).filter(row => row.amount > 0) }))
    if (validAllocations.some(allocation => !allocation.account_id || allocation.amount <= 0)) { setError('Select a ledger and enter a positive amount for every row.'); return }
    if (new Set(validAllocations.map(allocation => allocation.account_id)).size !== validAllocations.length) { setError('A ledger can appear only once.'); return }
    if (validAllocations.some(allocation => round2(allocation.invoice_allocations.reduce((sum, row) => sum + row.amount, 0)) > allocation.amount)) { setError('Invoice allocations cannot exceed the ledger amount.'); return }
    if (!submissionLock.tryAcquire()) return
    setSaving(true)
    try {
      if (isReceipt) {
        if (voucher) await updateReceipt(voucher.id, { allocations: validAllocations, deposit_to_account_id: moneyAccountId, narration, date_bs: dateBs }, status)
        else await saveReceipt({ allocations: validAllocations, deposit_to_account_id: moneyAccountId, narration, date_bs: dateBs }, status)
      } else {
        if (voucher) await updatePayment(voucher.id, { allocations: validAllocations, paid_from_account_id: moneyAccountId, narration, date_bs: dateBs }, status)
        else await savePayment({ allocations: validAllocations, paid_from_account_id: moneyAccountId, narration, date_bs: dateBs }, status)
      }
      if (voucher) {
        onClose()
      } else {
        setDateBs(selectedFiscalYearEndBs(company))
        setAllocations([{ account_id: '', amount: '', invoice_allocations: [] }])
        setMoneyAccountId(cashAccountId)
        setNarration('')
        setError('')
        setDateInvalid(false)
      }
    } catch (e: unknown) {
      const friendlyDateError = friendlyVoucherDateError(e, dateValidation)
      if (friendlyDateError) {
        setDateInvalid(true)
        setError(friendlyDateError)
        notifyError(friendlyDateError)
        setTimeout(() => dateInputRef.current?.focus(), 0)
      } else {
        setError(publicErrorMessage(e, `saving ${type.toLowerCase()}`))
      }
    } finally { submissionLock.release(); setSaving(false) }
  }

  const handleDeleteDraft = async () => {
    if (!voucher || voucher.status !== 'Draft') return
    setSaving(true)
    try { await deleteDraftVoucher(voucher.id); onClose() }
    catch (e: unknown) { setError(publicErrorMessage(e, 'deleting draft voucher')) }
    finally { setSaving(false) }
  }

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
        type,
        date_bs: dateBs,
        narration,
        party_account_id: allocations.find(allocation => allocation.account_id)?.account_id || null,
        is_cash: moneyAccountId === cashAccountId,
        total,
        draft_payload: { dateBs, allocations, moneyAccountId, narration },
      })
      onClose()
    } catch (e: unknown) { setError(publicErrorMessage(e, `saving ${type.toLowerCase()} draft`)) }
    finally { setSaving(false) }
  }

  const canSaveDraft = !voucher || voucher.status === 'Draft'
  const completedEdit = !!voucher && voucher.status !== 'Draft'

  return (
    <>
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="voucher-dialog max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEditing ? 'Edit' : 'New'} {type}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} min={selectedFiscalYearStartBs(company)} max={selectedFiscalYearEndBs(company)} tabIndex={-1} error={dateInvalid} showErrorText={false} inputRef={dateInputRef} /></div>
            <VoucherNumberField type={type} dateBs={dateBs} voucher={voucher} />
          </div>
          <div className="space-y-1.5">
            <Label>{isReceipt ? 'Deposit to account' : 'Pay from account'}</Label>
            <SearchableSelect triggerRef={moneyAccountTriggerRef} autoFocus value={moneyAccountId} onValueChange={setMoneyAccountId} options={[{ value: cashAccountId, label: 'Cash', group: 'Cash' }, ...banks.map(account => ({ value: account.id, label: account.name, searchText: `${account.name} Bank ${account.type === 'Liability' ? 'Overdraft Bank OD Liability' : 'Current Assets'}`, group: account.type === 'Liability' ? 'Bank OD A/c' : 'Bank Accounts', disabled: !!account.is_archived }))]} />
            <LedgerBalanceHint account={selectedMoneyAccount} />
          </div>
          <div className="space-y-2">
            <div className="hidden grid-cols-[minmax(0,1fr)_10rem_2.25rem] gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid"><span>Ledger</span><span className="text-right">Amount</span><span /></div>
            {allocations.map((allocation, index) => {
              const selectedAccount = accounts.find(account => account.id === allocation.account_id)
              const selectedParty = parties.find(party => party.account_id === allocation.account_id)
              return <div key={index} className="grid grid-cols-[minmax(0,1fr)_7rem_2.25rem] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_2.25rem]">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex min-w-0 gap-1.5">
                    <SearchableSelect className="min-w-0 flex-1" value={allocation.account_id} onValueChange={value => updateAllocation(index, 'account_id', value)} placeholder="Select ledger..." options={allocationAccounts.map(account => ({ value: account.id, label: account.name, searchText: `${categoryPath(accountCategories, account.category_id)} ${account.group} ${account.type}`, disabled: !!account.is_archived || (selectedIds.has(account.id) && account.id !== allocation.account_id) }))} />
                    <Button type="button" variant="outline" size="icon" title="Create ledger" aria-label="Create ledger" className="h-9 w-9 shrink-0" onClick={() => setLedgerLineIndex(index)}><Plus className="h-4 w-4" /></Button>
                  </div>
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
          {voucher?.status === 'Draft' && <Button variant="destructive" onClick={handleDeleteDraft} disabled={saving}>Delete Draft</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {canSaveDraft && <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving...' : voucher?.status === 'Draft' ? 'Update Draft' : 'Save as Draft'}</Button>}
          <Button onClick={() => handleSave('Completed')} disabled={saving}>{saving ? 'Saving...' : completedEdit ? 'Save Changes' : 'Complete Voucher'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {ledgerLineIndex !== null && <LedgerDialog open onClose={() => setLedgerLineIndex(null)} onCreated={account => {
      updateAllocation(ledgerLineIndex, 'account_id', account.id)
      setLedgerLineIndex(null)
    }} />}
    </>
  )
}

// ─── Journal Form ─────────────────────────────────────────────────────────────

interface JournalFormProps { open: boolean; onClose: () => void; voucher?: Voucher | null }

interface JLine { account_id: string; debit: number; credit: number }

export function JournalForm({ open, onClose, voucher }: JournalFormProps) {
  const { company, accounts, accountCategories, parties, vouchers, saveJournal, updateJournal, saveDraftVoucher, deleteDraftVoucher } = useAppStore()
  const manualJournalNumbering = company?.journal_numbering_mode === 'manual'
  const partyByAccount = new Map(parties.map(party => [party.account_id, party]))
  const journalAccounts = accounts.filter(account => {
    const party = partyByAccount.get(account.id)
    return !account.is_archived && !party?.is_archived
  })
  const isEditing = !!voucher

  const [dateBs, setDateBs] = useState(() => selectedFiscalYearEndBs(company))
  const [journalInvoiceNo, setJournalInvoiceNo] = useState(voucher?.invoice_no || '')
  const [jLines, setJLines] = useState<JLine[]>([
    { account_id: '', debit: 0, credit: 0 },
    { account_id: '', debit: 0, credit: 0 },
  ])
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dateInvalid, setDateInvalid] = useState(false)
  const firstAccountTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const [ledgerLineIndex, setLedgerLineIndex] = useState<number | null>(null)
  const submissionLock = useRef(new SubmissionLock()).current

  useEffect(() => {
    if (open && voucher) {
      const draft = voucher.status === 'Draft' ? voucher.draft_payload as Partial<{ dateBs: string; journalInvoiceNo: string; jLines: JLine[]; narration: string }> | null : null
      setDateBs(voucher.date_bs)
      setJournalInvoiceNo(draft?.journalInvoiceNo ?? voucher.invoice_no ?? '')
      setJLines(draft?.jLines?.length ? draft.jLines : (voucher.lines || []).map(l => ({
        account_id: l.account_id,
        debit: l.debit || 0,
        credit: l.credit || 0,
      })))
      setNarration(draft?.narration ?? voucher.narration ?? '')
      setError('')
      setDateInvalid(false)
    } else if (open) {
      setJournalInvoiceNo('')
    } else if (!open) {
      setDateBs(selectedFiscalYearEndBs(company))
      setJournalInvoiceNo('')
      setJLines([{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }])
      setNarration('')
      setError('')
      setLedgerLineIndex(null)
      setDateInvalid(false)
    }
  }, [open, voucher, company])

  const totalDebit = round2(jLines.reduce((s, l) => s + (l.debit || 0), 0))
  const totalCredit = round2(jLines.reduce((s, l) => s + (l.credit || 0), 0))
  const diff = round2(totalDebit - totalCredit)
  const balanced = Math.abs(diff) < 0.005
  const dateValidation = useMemo(() => company ? validateVoucherDateForNumbering({ company, vouchers, type: 'Journal', dateBs, currentVoucherId: voucher?.status === 'Draft' ? undefined : voucher?.id, invoiceNo: company.journal_numbering_mode === 'manual' ? journalInvoiceNo : voucher?.invoice_no, status: 'Completed' }) : { valid: true }, [company, vouchers, dateBs, voucher?.id, voucher?.invoice_no, voucher?.status, journalInvoiceNo])
  useEffect(() => {
    if (dateInvalid && dateValidation.valid) setDateInvalid(false)
  }, [dateInvalid, dateValidation.valid])

  const updateLine = (idx: number, field: keyof JLine, value: string | number) => {
    const next = [...jLines]
    if (field === 'debit' && Number(value) > 0) next[idx] = { ...next[idx], debit: Number(value), credit: 0 }
    else if (field === 'credit' && Number(value) > 0) next[idx] = { ...next[idx], credit: Number(value), debit: 0 }
    else next[idx] = { ...next[idx], [field]: field === 'account_id' ? value : Number(value) }
    setJLines(next)
  }

  const handleSave = async (status: Voucher['status'] = 'Completed') => {
    if (manualJournalNumbering && !journalInvoiceNo.trim()) { setError('Enter the Journal voucher number.'); return }
    if (journalInvoiceNo.trim().length > 100) { setError('Journal voucher number cannot exceed 100 characters.'); return }
    if (status === 'Completed' && !dateValidation.valid) {
      const message = friendlyVoucherDateError(null, dateValidation) || 'Cannot save voucher. Voucher date is invalid.'
      const isDateProblem = !!dateValidation.previous || !!dateValidation.next || /date/i.test(dateValidation.message || '')
      if (isDateProblem) {
        setDateInvalid(true)
        setTimeout(() => dateInputRef.current?.focus(), 0)
      }
      setError(message)
      notifyError(message)
      return
    }
    const validLines = jLines.filter(l => l.account_id && (l.debit > 0 || l.credit > 0))
    if (validLines.length < 2) { setError('Add at least two lines.'); return }
    if (!balanced) { setError(`Debits and credits differ by ${fmtMoney(Math.abs(diff))}.`); return }
    if (!submissionLock.tryAcquire()) return
    setSaving(true)
    try {
      const params = { lines: validLines as Omit<VoucherLine, 'id' | 'voucher_id'>[], narration, date_bs: dateBs, invoice_no: manualJournalNumbering ? journalInvoiceNo.trim() : undefined }
      if (voucher) await updateJournal(voucher.id, params, status)
      else await saveJournal(params, status)
      if (voucher) {
        onClose()
      } else {
        setDateBs(selectedFiscalYearEndBs(company))
        setJournalInvoiceNo('')
        setJLines([{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }])
        setNarration('')
        setError('')
        setDateInvalid(false)
      }
    } catch (e: unknown) {
      const friendlyDateError = friendlyVoucherDateError(e, dateValidation)
      if (friendlyDateError) {
        setDateInvalid(true)
        setError(friendlyDateError)
        notifyError(friendlyDateError)
        setTimeout(() => dateInputRef.current?.focus(), 0)
      } else {
        setError(publicErrorMessage(e, 'saving journal voucher'))
      }
    } finally { submissionLock.release(); setSaving(false) }
  }

  const handleDeleteDraft = async () => {
    if (!voucher || voucher.status !== 'Draft') return
    setSaving(true)
    try { await deleteDraftVoucher(voucher.id); onClose() }
    catch (e: unknown) { setError(publicErrorMessage(e, 'deleting draft voucher')) }
    finally { setSaving(false) }
  }

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
        type: 'Journal',
        date_bs: dateBs,
        narration,
        total: totalDebit || totalCredit,
        draft_payload: { dateBs, journalInvoiceNo, jLines, narration },
      })
      onClose()
    } catch (e: unknown) { setError(publicErrorMessage(e, 'saving journal draft')) }
    finally { setSaving(false) }
  }

  const canSaveDraft = !voucher || voucher.status === 'Draft'
  const completedEdit = !!voucher && voucher.status !== 'Draft'

  return (
    <>
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="voucher-dialog max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEditing ? 'Edit' : 'New'} Journal Entry</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Use this for adjustments not covered by other voucher types: depreciation, write-offs, opening balances, etc.
        </p>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} min={selectedFiscalYearStartBs(company)} max={selectedFiscalYearEndBs(company)} tabIndex={-1} error={dateInvalid} showErrorText={false} inputRef={dateInputRef} /></div>
            {manualJournalNumbering ? <div className="space-y-1.5"><Label>Voucher Number</Label><Input value={journalInvoiceNo} onChange={event => setJournalInvoiceNo(event.target.value)} maxLength={100} placeholder="Enter Journal voucher number" tabIndex={-1} /></div> : <VoucherNumberField type="Journal" dateBs={dateBs} voucher={voucher} />}
          </div>

          {/* Lines header */}
          <div className="hidden grid-cols-[2fr_1fr_1fr_auto] gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Account</span><span>Debit</span><span>Credit</span><span></span>
          </div>
          {jLines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-center sm:border-0 sm:p-0">
              <div className="col-span-2 flex min-w-0 gap-1 sm:col-span-1">
              <SearchableSelect triggerRef={idx === 0 ? firstAccountTriggerRef : undefined} autoFocus={idx === 0} className="min-w-0 flex-1" value={line.account_id} onValueChange={v => updateLine(idx, 'account_id', v)} placeholder="Select account…" options={journalAccounts.sort((a,b) => a.name.localeCompare(b.name)).map(account => {
                const party = partyByAccount.get(account.id)
                return {
                  value: account.id,
                  label: account.name,
                  group: party ? (party.type === 'customer' ? 'Customers' : 'Suppliers') : account.type,
                  searchText: `${categoryPath(accountCategories, account.category_id)} ${account.group} ${account.type} ${party?.phone || ''} ${party?.pan_vat || ''} ${party?.address || ''}`,
                }
              })} />
              <Button type="button" variant="outline" size="icon" tabIndex={-1} className="h-9 w-9 shrink-0" aria-label="Create new ledger" title="Create new ledger" onClick={() => setLedgerLineIndex(idx)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
              </div>
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
          {voucher?.status === 'Draft' && <Button variant="destructive" onClick={handleDeleteDraft} disabled={saving}>Delete Draft</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {canSaveDraft && <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving...' : voucher?.status === 'Draft' ? 'Update Draft' : 'Save as Draft'}</Button>}
          <Button onClick={() => handleSave('Completed')} disabled={saving || !balanced}>{saving ? 'Saving...' : completedEdit ? 'Save Changes' : 'Complete Voucher'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {ledgerLineIndex !== null && <LedgerDialog open onClose={() => setLedgerLineIndex(null)} onCreated={account => {
      setJLines(current => current.map((line, index) => index === ledgerLineIndex ? { ...line, account_id: account.id } : line))
      setLedgerLineIndex(null)
    }} />}
    </>
  )
}
