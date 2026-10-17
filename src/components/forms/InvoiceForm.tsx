import { lazy, useState, useEffect, useMemo, useRef } from 'react'
import { CalendarDays, Plus, Printer, Tag, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { addDaysToBs } from '@/lib/nepaliDate'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { invoiceRateFromAmount, invoiceSubtotal, resolveSystemAccountId } from '@/lib/engine'
import { formatStockQuantity, fromBaseRate, toBaseQty, toBaseRate, unitFactor, unitName, type UnitMode } from '@/lib/units'
import { partyTerminology } from '@/lib/partyTerminology'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ItemForm } from './OtherForms'
import { LedgerBalanceHint } from './LedgerBalanceHint'
import { publicErrorMessage } from '@/lib/security'
import { friendlyVoucherDateError, validateVoucherDateForNumbering } from '@/lib/voucherDateValidation'
import { notifyError } from '@/lib/notifications'
import { formatRateInput, hasAtMostSixDecimalPlaces, rateInputNumber } from '@/lib/rateFormat'
import { VoucherNumberField } from './VoucherNumberField'
import { SubmissionLock } from '@/lib/submissionLock'
import { stableFormSnapshot, useUnsavedChangesGuard } from '@/lib/unsavedChanges'
import type { Voucher } from '@/types'
import { beginVoucherPrint, cancelVoucherPrint, completeVoucherPrint, focusVoucherDialogAfterSave, useVoucherShortcuts, type VoucherPrintRequest } from '@/lib/voucherShortcuts'
import { repriceSalesLines } from '@/lib/pricing'
import type { PricingSnapshot } from '@/types'
import { applyInvoiceQuantityInput, releaseInvoicePricingLocks } from '@/lib/invoiceLineEditing'
import { useGlobalCreateShortcut } from '@/lib/globalCreateShortcut'
import { CreateShortcutHint, ItemCreateShortcutHint } from '@/components/ui/shortcut-hint'
import { focusAfterNestedDialogCloses } from '@/lib/searchableSelectFocus'
import { itemSelectorOption, partySelectorOption } from '@/lib/selectorOptions'
import { fetchVoucherItemSerials } from '@/lib/supabase'
import { SerialNumberEditor } from './SerialNumberEditor'

const LedgerDialog = lazy(() => import('@/pages/Masters').then(module => ({ default: module.LedgerDialog })))

interface LineItem { item_id: string; qty: number; rate: string | number; unit_mode: UnitMode; entry_unit?: string; conversion_factor?: number; amount_input?: string; serial_numbers?: string[]; pricing_rule_id?: string; pricing_slab_id?: string; calculated_rate?: number; price_overridden?: boolean; pricing_snapshot?: PricingSnapshot; pricing_warning?: string; pricing_locked?: boolean }
type DiscountMode = 'flat' | 'percent'

function round2Local(n: number) { return Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000 }

function PartyDetailDisplay({ label, value, emptyText = '—' }: { label: string; value?: string | null; emptyText?: string }) {
  const displayValue = value?.trim() || emptyText
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold leading-4 text-foreground">{label}</p>
      <p
        className={`mt-2 truncate text-sm leading-5 ${value?.trim() ? 'text-foreground' : 'text-muted-foreground'}`}
        title={value?.trim() ? value.trim() : undefined}
      >
        {displayValue}
      </p>
    </div>
  )
}

interface InvoiceFormProps {
  type: 'Sales' | 'Purchase'
  open: boolean
  onClose: () => void
  voucher?: Voucher | null
}

export function InvoiceForm({ type, open, onClose, voucher }: InvoiceFormProps) {
  const isSales = type === 'Sales'
  const { company, accounts, items, itemCategories, pricingRules, parties, vouchers, getStockEntry, saveSalesVoucher, savePurchaseVoucher, updateSalesVoucher, updatePurchaseVoucher, saveDraftVoucher, deleteDraftVoucher } = useAppStore()
  const vatEnabled = company?.vat_enabled ?? true

  const [dateBs, setDateBs] = useState(() => selectedFiscalYearEndBs(company))
  const [isCash, setIsCash] = useState(false)
  const [partyAccountId, setPartyAccountId] = useState('')
  const [creditDays, setCreditDays] = useState(0)
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [lines, setLines] = useState<LineItem[]>([{ item_id: '', qty: 0, rate: 0, unit_mode: 'main' }])
  const [vatRate, setVatRate] = useState(13)
  const [discount, setDiscount] = useState(0)
  const [discountMode, setDiscountMode] = useState<DiscountMode>('flat')
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dateInvalid, setDateInvalid] = useState(false)
  const [showPartyForm, setShowPartyForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [newItemLineIdx, setNewItemLineIdx] = useState<number | null>(null)
  const partyTriggerRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const createContextRef = useRef<{ kind: 'party' } | { kind: 'item'; index: number } | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const itemTriggerRefs = useRef<Array<HTMLElement | null>>([])
  const pendingLineFocus = useRef<number | null>(null)
  const submissionLock = useRef(new SubmissionLock()).current
  const initializedFormRef = useRef<string | null>(null)
  const pricingReadyFormRef = useRef<string | null>(null)
  const baselineRef = useRef('')
  const snapshotRef = useRef('')
  const workingDraftIdRef = useRef<string | undefined>(voucher?.status === 'Draft' ? voucher.id : undefined)
  const freshAfterDraftRef = useRef(false)

  const partyType = isSales ? 'customer' : 'supplier'
  const partyTerms = partyTerminology(partyType)
  const partyList = parties.filter(p => p.type === partyType && !p.is_archived)
  const selectedParty = parties.find(party => party.account_id === partyAccountId)
  const selectedPartyAccount = accounts.find(account => account.id === partyAccountId)
  const selectedPartyAddress = selectedParty?.address?.trim() || selectedPartyAccount?.address?.trim() || ''
  const selectedPartyPhone = selectedParty?.phone?.trim() || selectedPartyAccount?.contact_no?.trim() || ''
  const selectedPartyPanNo = selectedParty?.pan_vat?.trim() || selectedPartyAccount?.pan_no?.trim() || ''
  const cashAccountId = company ? resolveSystemAccountId(accounts, company.id, 'cash') : ''
  const cashAccount = accounts.find(account => account.id === cashAccountId)
  const isEditing = !!voucher && !freshAfterDraftRef.current
  const dueDateBs = (() => {
    try { return addDaysToBs(dateBs, isCash ? 0 : creditDays) } catch { return '' }
  })()

  useGlobalCreateShortcut({
    active: open && !isCash,
    disabled: saving,
    scopeRef: dialogRef,
    onCreate: () => setShowPartyForm(true),
  })

  useGlobalCreateShortcut({
    active: open,
    disabled: saving,
    scopeRef: dialogRef,
    shortcutKey: 'i',
    onCreate: selectorTrigger => {
      const active = document.activeElement instanceof Element ? document.activeElement : null
      const row = selectorTrigger?.closest<HTMLElement>('[data-create-line]') || active?.closest<HTMLElement>('[data-create-line]')
      const rowIndex = row ? Number(row.dataset.createLine) : -1
      const context = Number.isInteger(rowIndex) && rowIndex >= 0
        ? { kind: 'item' as const, index: rowIndex }
        : createContextRef.current?.kind === 'item' ? createContextRef.current : null
      if (context?.kind === 'item' && context.index < lines.length) {
        setNewItemLineIdx(context.index); setShowItemForm(true); return
      }
      setNewItemLineIdx(0); setShowItemForm(true)
    },
  })

  // Totals
  const numericLines = useMemo(() => lines.map(line => ({
    ...line,
    rate: rateInputNumber(line.rate),
    amount: round2Local(line.amount_input !== undefined && line.amount_input !== '' ? Number(line.amount_input) : line.qty * rateInputNumber(line.rate)),
  })), [lines])
  const subtotal = invoiceSubtotal(numericLines)
  const totalQuantity = useMemo(
    () => round2Local(lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)),
    [lines],
  )
  const totalQuantityLabel = totalQuantity.toLocaleString('en-IN', { maximumFractionDigits: 6 })
  const discountAmount = round2Local(Math.min(subtotal, Math.max(0, discountMode === 'percent' ? subtotal * (discount / 100) : discount)))
  const taxable = round2Local(subtotal - discountAmount)
  const effectiveVatRate = vatEnabled ? vatRate : 0
  const vatAmount = round2Local(taxable * (effectiveVatRate / 100))
  const total = round2Local(taxable + vatAmount)
  const dateValidation = useMemo(() => company ? validateVoucherDateForNumbering({ company, vouchers, type, dateBs, currentVoucherId: voucher?.status === 'Draft' ? undefined : voucher?.id, invoiceNo: voucher?.invoice_no, status: 'Completed' }) : { valid: true }, [company, vouchers, type, dateBs, voucher?.id, voucher?.invoice_no, voucher?.status])
  const formSnapshot = stableFormSnapshot({ dateBs, isCash, partyAccountId, creditDays, supplierInvoiceNo, lines, vatRate, discount, discountMode, narration })
  snapshotRef.current = formSnapshot
  const dirty = open && baselineRef.current !== '' && formSnapshot !== baselineRef.current
  const confirmDiscard = useUnsavedChangesGuard(open, dirty, onClose)

  useEffect(() => {
    if (dateInvalid && dateValidation.valid) setDateInvalid(false)
  }, [dateInvalid, dateValidation.valid])

  useEffect(() => {
    const formIdentity = `${type}:${voucher?.id || 'new'}`
    if (!open) {
      initializedFormRef.current = null
      baselineRef.current = ''
      workingDraftIdRef.current = undefined
      freshAfterDraftRef.current = false
    } else if (initializedFormRef.current === formIdentity) {
      return
    } else {
      initializedFormRef.current = formIdentity
      baselineRef.current = ''
      workingDraftIdRef.current = voucher?.status === 'Draft' ? voucher.id : undefined
      freshAfterDraftRef.current = false
    }
    if (open && voucher) {
      const draft = voucher.status === 'Draft' ? voucher.draft_payload as Partial<{
        dateBs: string; isCash: boolean; partyAccountId: string; creditDays: number; supplierInvoiceNo: string; lines: LineItem[]; vatRate: number; discount: number; discountMode: DiscountMode; narration: string
      }> | null : null
      setDateBs(voucher.date_bs)
      setIsCash(draft?.isCash ?? voucher.is_cash)
      setPartyAccountId(draft?.partyAccountId ?? voucher.party_account_id ?? '')
      const voucherParty = parties.find(party => party.account_id === voucher.party_account_id)
      setCreditDays(draft?.creditDays ?? (voucher.is_cash ? 0 : (voucher.credit_days ?? voucherParty?.default_credit_days ?? 0)))
      setSupplierInvoiceNo(draft?.supplierInvoiceNo ?? voucher.supplier_invoice_no ?? '')
      setLines(draft?.lines?.length ? draft.lines.map(line => ({
        ...line,
        pricing_locked: !!line.pricing_snapshot,
        pricing_snapshot: line.pricing_snapshot ? { ...line.pricing_snapshot, locked_from_draft: true } : undefined,
      })) : (voucher.invoice_items || []).map(i => {
        const item = items.find(entry => entry.id === i.item_id)
        const factor = i.conversion_factor || 1
        return { item_id: i.item_id, qty: i.qty, rate: formatRateInput(i.rate), amount_input: i.amount == null ? undefined : String(i.amount), unit_mode: factor > 1 ? 'alternate' : 'main', entry_unit: i.entry_unit || i.unit || item?.unit, conversion_factor: factor, serial_numbers: i.serial_numbers, pricing_rule_id: i.pricing_rule_id || undefined, pricing_slab_id: i.pricing_slab_id || undefined, calculated_rate: i.calculated_rate ?? undefined, price_overridden: i.price_overridden, pricing_snapshot: i.pricing_snapshot || undefined, pricing_locked: isSales }
      }))
      setVatRate(vatEnabled ? (draft?.vatRate ?? voucher.vat_rate ?? 13) : 0)
      setDiscount(draft?.discount ?? voucher.discount ?? 0)
      setDiscountMode(draft?.discountMode ?? 'flat')
      setNarration(draft?.narration ?? voucher.narration ?? '')
      setError('')
      setDateInvalid(false)
    } else if (!open) {
      setDateBs(selectedFiscalYearEndBs(company)); setIsCash(false); setPartyAccountId(''); setCreditDays(0); setSupplierInvoiceNo('')
      setLines([{ item_id: '', qty: 0, rate: 0, unit_mode: 'main' }]); setVatRate(vatEnabled ? 13 : 0)
      setDiscount(0); setDiscountMode('flat'); setNarration(''); setError(''); setDateInvalid(false)
    }
    if (open) {
      window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
    }
  }, [open, voucher, vatEnabled, items, parties, company, type, isSales])

  useEffect(() => {
    if (!open || !company || !voucher || voucher.status === 'Draft') return
    const serialized = (voucher.invoice_items || []).filter(line => items.find(item => item.id === line.item_id)?.is_serialized)
    if (!serialized.length) return
    let cancelled = false
    Promise.all(serialized.map(async line => ({ itemId: line.item_id, serials: await fetchVoucherItemSerials(company.id, voucher.id, line.item_id) })))
      .then(results => {
        if (cancelled) return
        const byItem = new Map(results.map(result => [result.itemId, result.serials]))
        setLines(current => current.map(line => byItem.has(line.item_id) ? { ...line, serial_numbers: byItem.get(line.item_id) } : line))
        window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
      })
      .catch(cause => { if (!cancelled) setError(publicErrorMessage(cause, 'loading invoice serial numbers')) })
    return () => { cancelled = true }
  }, [company, items, open, voucher])

  useEffect(() => {
    if (!open) {
      pricingReadyFormRef.current = null
      return
    }
    if (!isSales) return
    const formIdentity = `${type}:${voucher?.id || 'new'}`
    // Opening a draft queues its persisted lines in the hydration effect above.
    // Do not let this effect overwrite that queued state with the previous
    // form's blank line during the same React effect cycle.
    if (pricingReadyFormRef.current !== formIdentity) {
      pricingReadyFormRef.current = formIdentity
      return
    }
    const unlocked = lines.map((line, index) => ({ line, index })).filter(({ line }) => !line.pricing_locked)
    if (!unlocked.length) return
    const input = unlocked.map(({ line, index }) => {
      const item = items.find(entry => entry.id === line.item_id)
      const factor = line.conversion_factor || unitFactor(item, line.unit_mode)
      const automaticBase = item ? fromBaseRate(item.sell_rate || 0, factor) : rateInputNumber(line.rate)
      return { ...line, key: String(index), rate: line.price_overridden ? rateInputNumber(line.rate) : automaticBase }
    })
    const priced = repriceSalesLines({ lines: input, items, categories: itemCategories, rules: pricingRules, dateBs })
    const next = [...lines]
    priced.forEach((result, pricedIndex) => {
      const index = unlocked[pricedIndex].index
      const current = lines[index]
      next[index] = {
        ...current,
        rate: formatRateInput(result.rate),
        amount_input: current.price_overridden ? current.amount_input : undefined,
        calculated_rate: result.calculated_rate,
        pricing_rule_id: result.pricing_rule_id,
        pricing_slab_id: result.pricing_slab_id,
        pricing_snapshot: result.pricing_snapshot,
        pricing_warning: result.pricing_warning,
      }
    })
    if (JSON.stringify(next) !== JSON.stringify(lines)) setLines(next)
  }, [dateBs, isSales, itemCategories, items, lines, open, pricingRules, type, voucher?.id, voucher?.status])

  const selectParty = (accountId: string) => {
    setPartyAccountId(accountId)
    setCreditDays(parties.find(party => party.account_id === accountId)?.default_credit_days ?? 0)
  }

  const toggleCash = (checked: boolean) => {
    setIsCash(checked)
    setCreditDays(checked ? 0 : (parties.find(party => party.account_id === partyAccountId)?.default_credit_days ?? 0))
  }

  const updateLine = (idx: number, field: keyof LineItem, value: string | number) => {
    const next = [...lines]
    if (field === 'item_id') {
      const item = items.find(i => i.id === value)
      next[idx] = { ...next[idx], item_id: value as string, unit_mode: 'main', entry_unit: item?.unit, conversion_factor: 1, amount_input: undefined, serial_numbers: [], price_overridden: false, pricing_rule_id: undefined, pricing_slab_id: undefined, calculated_rate: undefined, pricing_snapshot: undefined, pricing_warning: undefined, pricing_locked: false }
      if (!isSales) {
        const stock = getStockEntry(value as string)
        if (stock.avg_cost > 0) next[idx].rate = formatRateInput(stock.avg_cost)
        const item = items.find(i => i.id === value)
        if (item?.sell_rate && isSales) next[idx].rate = formatRateInput(item.sell_rate)
      } else {
        const item = items.find(i => i.id === value)
        if (item?.sell_rate) next[idx].rate = formatRateInput(item.sell_rate)
      }
    } else if (field === 'rate') {
      next[idx] = { ...next[idx], rate: value, amount_input: undefined, price_overridden: isSales, pricing_snapshot: next[idx].pricing_snapshot ? { ...next[idx].pricing_snapshot!, price_overridden: true } : undefined }
    } else if (field === 'qty') {
      next[idx] = applyInvoiceQuantityInput(next[idx], value)
      if (isSales) {
        setLines(releaseInvoicePricingLocks(next))
        return
      }
    } else {
      next[idx] = { ...next[idx], [field]: Number(value) }
    }
    setLines(next)
  }

  const roundLineRate = (idx: number) => {
    setLines(current => current.map((line, row) => row === idx ? { ...line, rate: formatRateInput(line.rate) } : line))
  }

  const updateLineAmount = (idx: number, value: string) => {
    const line = lines[idx]
    if (!line) return
    if (value === '') {
      const next = [...lines]
      next[idx] = { ...line, amount_input: '', rate: '', price_overridden: isSales, pricing_snapshot: line.pricing_snapshot ? { ...line.pricing_snapshot, price_overridden: true } : undefined }
      setLines(next)
      return
    }
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0) return
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      setError('Enter a quantity greater than zero before entering the line amount.')
      return
    }
    const next = [...lines]
    next[idx] = { ...line, amount_input: value, rate: String(invoiceRateFromAmount(amount, line.qty) ?? 0), price_overridden: isSales, pricing_snapshot: line.pricing_snapshot ? { ...line.pricing_snapshot, price_overridden: true } : undefined }
    setLines(next)
    setError('')
  }

  const updateUnit = (idx: number, mode: UnitMode) => {
    const next = [...lines]
    const line = next[idx]
    const item = items.find(entry => entry.id === line.item_id)
    const oldFactor = line.conversion_factor || unitFactor(item, line.unit_mode)
    const baseRate = toBaseRate(rateInputNumber(line.rate), oldFactor)
    const factor = unitFactor(item, mode)
    const calculatedBaseRate = line.calculated_rate == null ? null : toBaseRate(line.calculated_rate, oldFactor)
    const calculatedRate = calculatedBaseRate == null ? undefined : fromBaseRate(calculatedBaseRate, factor)
    next[idx] = {
      ...line,
      unit_mode: mode,
      entry_unit: unitName(item, mode),
      conversion_factor: factor,
      rate: formatRateInput(fromBaseRate(baseRate, factor)),
      calculated_rate: calculatedRate,
      pricing_snapshot: line.pricing_snapshot && calculatedRate != null
        ? { ...line.pricing_snapshot, calculated_entry_rate: calculatedRate }
        : line.pricing_snapshot,
    }
    setLines(next)
  }

  const addLine = () => {
    pendingLineFocus.current = lines.length
    setLines(current => [...current, { item_id: '', qty: 0, rate: 0, unit_mode: 'main' }])
  }

  useEffect(() => {
    if (pendingLineFocus.current === null) return
    const index = pendingLineFocus.current
    pendingLineFocus.current = null
    const frame = window.requestAnimationFrame(() => itemTriggerRefs.current[index]?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [lines.length])

  const handleSave = async (status: Voucher['status'] = 'Completed', shouldPrint = false) => {
    if (status === 'Completed' && !dateValidation.valid) {
      const message = friendlyVoucherDateError(null, dateValidation) || 'Cannot save voucher. Voucher date is invalid.'
      setDateInvalid(true)
      setError(message)
      notifyError(message)
      setTimeout(() => dateInputRef.current?.focus(), 0)
      return
    }
    setError('')
    const validLines = numericLines.filter(line => line.item_id && Number.isFinite(line.qty) && line.qty > 0 && Number.isFinite(line.rate) && line.rate >= 0 && Number.isFinite(line.amount) && line.amount >= 0)
    if (!lines.length || validLines.length !== lines.length) { setError('Select an item and enter a quantity greater than zero for every line. Rate can be zero but cannot be negative.'); return }
    if (lines.some(line => !hasAtMostSixDecimalPlaces(line.qty) || !hasAtMostSixDecimalPlaces(line.rate) || (line.amount_input !== undefined && line.amount_input !== '' && !hasAtMostSixDecimalPlaces(line.amount_input)))) { setError('Quantity, rate, and amount support up to six decimal places.'); return }
    if (!isCash && !partyAccountId) { setError(`Select a ${partyTerms.singular} or check "Cash".`); return }
    if (!Number.isInteger(creditDays) || creditDays < 0) { setError('Credit Days must be a whole number of 0 or more.'); return }
    if (!isSales && supplierInvoiceNo.trim().length > 100) { setError('Supplier Invoice No. cannot exceed 100 characters.'); return }
    const serializedLineItems = validLines.filter(line => items.find(item => item.id === line.item_id)?.is_serialized).map(line => line.item_id)
    if (new Set(serializedLineItems).size !== serializedLineItems.length) { setError('Use one invoice line per serialized item so each serial assignment remains unambiguous.'); return }
    for (const line of validLines) {
      const item = items.find(entry => entry.id === line.item_id)
      if (!item?.is_serialized) continue
      const baseQuantity = toBaseQty(line.qty, line.conversion_factor || 1)
      if (!Number.isInteger(baseQuantity)) { setError(`"${item.name}" is serialized. Its base quantity must be a whole number.`); return }
      if ((line.serial_numbers?.length || 0) !== baseQuantity) { setError(`Assign exactly ${baseQuantity} serial ${baseQuantity === 1 ? 'number' : 'numbers'} to "${item.name}".`); return }
    }

    if (isSales) {
      const requestedByItem = new Map<string, number>()
      for (const line of validLines) {
        if (items.find(item => item.id === line.item_id)?.is_service) continue
        requestedByItem.set(line.item_id, (requestedByItem.get(line.item_id) || 0) + toBaseQty(line.qty, line.conversion_factor || 1))
      }
      for (const [itemId, requestedBaseQty] of requestedByItem) {
        const s = getStockEntry(itemId)
        const currentVoucherQty = voucher?.stock_lines
          ?.filter(sl => sl.item_id === itemId && sl.direction === 'out')
          .reduce((sum, sl) => sum + sl.qty, 0) ?? 0
        if (s.qty + currentVoucherQty < requestedBaseQty) {
          const item = items.find(i => i.id === itemId)
          setError(`Not enough stock for "${item?.name}": have ${item ? formatStockQuantity(s.qty + currentVoucherQty, item) : s.qty}, selling ${requestedBaseQty} ${item?.unit || ''}.`)
          return
        }
      }
    }

    if (!submissionLock.tryAcquire()) return
    let printRequest: VoucherPrintRequest | undefined = shouldPrint ? beginVoucherPrint() : undefined
    setSaving(true)
    try {
      const params = { party_account_id: partyAccountId || null, is_cash: isCash, items: validLines.map(({ unit_mode: _mode, amount_input: _amountInput, pricing_warning: _warning, ...line }) => line), vat_rate: effectiveVatRate, credit_days: isCash ? 0 : creditDays, supplier_invoice_no: isSales ? undefined : supplierInvoiceNo.trim(), discount: discountAmount, narration: narration.trim(), date_bs: dateBs }
      const targetVoucherId = freshAfterDraftRef.current ? undefined : (voucher?.id || workingDraftIdRef.current)
      if (isSales) {
        if (targetVoucherId) await updateSalesVoucher(targetVoucherId, params, status)
        else await saveSalesVoucher(params, status)
      } else {
        if (targetVoucherId) await updatePurchaseVoucher(targetVoucherId, params, status)
        else await savePurchaseVoucher(params, status)
      }
      workingDraftIdRef.current = undefined
      completeVoucherPrint(printRequest, type, voucher)
      printRequest = undefined
      if (voucher) {
        onClose()
      } else {
        baselineRef.current = ''
        setDateBs(selectedFiscalYearEndBs(company))
        setIsCash(false)
        setPartyAccountId('')
        setCreditDays(0)
        setSupplierInvoiceNo('')
        setLines([{ item_id: '', qty: 0, rate: 0, unit_mode: 'main' }])
        setVatRate(vatEnabled ? 13 : 0)
        setDiscount(0)
        setDiscountMode('flat')
        setNarration('')
        setError('')
        setDateInvalid(false)
        itemTriggerRefs.current = []
        pendingLineFocus.current = null
        window.setTimeout(() => {
          baselineRef.current = snapshotRef.current
          focusVoucherDialogAfterSave(dialogRef.current)
        }, 0)
      }
    } catch (e: unknown) {
      cancelVoucherPrint(printRequest)
      const friendlyDateError = friendlyVoucherDateError(e, dateValidation)
      if (friendlyDateError) {
        setDateInvalid(true)
        setError(friendlyDateError)
        notifyError(friendlyDateError)
        setTimeout(() => dateInputRef.current?.focus(), 0)
      } else {
        setError(publicErrorMessage(e, `saving ${type.toLowerCase()} invoice`))
      }
    } finally {
      submissionLock.release()
      setSaving(false)
    }
  }

  useVoucherShortcuts({ open, disabled: saving, draftDisabled: saving, scopeRef: dialogRef, onSave: () => { void handleSave('Completed') }, onSaveAndPrint: () => { void handleSave('Completed', true) }, onSaveDraft: !voucher || voucher.status === 'Draft' ? () => { void handleSaveDraft() } : undefined })

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
        type,
        date_bs: dateBs,
        narration: narration.trim(),
        party_account_id: partyAccountId || null,
        is_cash: isCash,
        total,
        draft_payload: { dateBs, isCash, partyAccountId, creditDays, supplierInvoiceNo, lines: numericLines.map(line => ({ ...line, rate: formatRateInput(line.rate) })), vatRate, discount, discountMode, narration },
      })
      workingDraftIdRef.current = undefined
      freshAfterDraftRef.current = true
      baselineRef.current = ''
      setDateBs(selectedFiscalYearEndBs(company)); setIsCash(false); setPartyAccountId(''); setCreditDays(0); setSupplierInvoiceNo('')
      setLines([{ item_id: '', qty: 0, rate: 0, unit_mode: 'main' }]); setVatRate(vatEnabled ? 13 : 0)
      setDiscount(0); setDiscountMode('flat'); setNarration(''); setError(''); setDateInvalid(false)
      itemTriggerRefs.current = []; pendingLineFocus.current = null
      window.setTimeout(() => {
        baselineRef.current = snapshotRef.current
        focusVoucherDialogAfterSave(dialogRef.current)
      }, 0)
    } catch (e: unknown) {
      setError(publicErrorMessage(e, `saving ${type.toLowerCase()} draft`))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDraft = async () => {
    if (!voucher || voucher.status !== 'Draft') return
    setSaving(true)
    try {
      await deleteDraftVoucher(voucher.id)
      onClose()
    } catch (e: unknown) {
      setError(publicErrorMessage(e, 'deleting draft voucher'))
    } finally {
      setSaving(false)
    }
  }

  const canSaveDraft = !voucher || voucher.status === 'Draft'
  const completedEdit = !!voucher && voucher.status !== 'Draft'

  return (
    <>
      <Dialog modal={false} open={open} onOpenChange={o => { if (!o) void confirmDiscard().then(confirmed => { if (confirmed) onClose() }) }}>
        <DialogContent ref={dialogRef} data-selectors-open-on-focus="true" onFocusCapture={event => { const target = event.target instanceof Element ? event.target : null; const line = target?.closest<HTMLElement>('[data-create-line]'); createContextRef.current = line ? { kind: 'item', index: Number(line.dataset.createLine) } : target?.closest('[data-create-context="party"]') ? { kind: 'party' } : null }} className="voucher-dialog invoice-workspace-dialog">
          <DialogHeader className="invoice-workspace-header pr-12 text-left">
            <DialogTitle className="text-xl leading-6">{isEditing ? 'Edit' : 'New'} {type === 'Sales' ? 'Sales Invoice' : 'Purchase Bill'}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              {isEditing
                ? `Update this ${isSales ? 'sales invoice' : 'purchase bill'} without changing its voucher identity.`
                : `Record ${isSales ? 'a customer sale' : 'a supplier purchase'} with item, tax, and payment details.`}
            </DialogDescription>
          </DialogHeader>

          <div className="invoice-workspace-body invoice-workspace-layout">
            <section className="invoice-document-section min-h-min overflow-hidden rounded-lg border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.035)]" aria-labelledby="invoice-document-details">
              <div className="border-b border-border bg-[#fafbfc] px-4 py-2.5">
                <h3 id="invoice-document-details" className="font-['IBM_Plex_Sans'] text-[15px] font-semibold leading-5 text-foreground">Document details</h3>
              </div>

              <div className={`grid items-start gap-x-4 gap-y-3 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-3 ${isSales ? 'xl:grid-cols-[minmax(9.5rem,1fr)_minmax(10rem,1fr)_minmax(8rem,.7fr)_minmax(7rem,.75fr)_minmax(9.5rem,1fr)]' : '2xl:grid-cols-[minmax(9rem,.9fr)_minmax(9.5rem,1fr)_minmax(9.5rem,1fr)_minmax(8rem,.7fr)_minmax(7rem,.65fr)_minmax(9rem,.9fr)]'}`}>
                <div className="min-w-0 space-y-1.5">
                  <Label>Date (BS)</Label>
                  <NepaliDateInput value={dateBs} onChange={setDateBs} min={selectedFiscalYearStartBs(company)} max={selectedFiscalYearEndBs(company)} calendarTabIndex={-1} error={dateInvalid} showErrorText={false} inputRef={dateInputRef} />
                </div>
                <VoucherNumberField type={type} dateBs={dateBs} voucher={voucher} helperText="Assigned on save" className="min-w-0" />
                {!isSales && <div className="min-w-0 space-y-1.5">
                  <Label>Supplier Invoice No.</Label>
                  <Input value={supplierInvoiceNo} onChange={event => setSupplierInvoiceNo(event.target.value)} maxLength={100} placeholder="Physical bill number" />
                </div>}
                <div className="min-w-0 space-y-1.5">
                  <Label>{isSales ? 'Cash sale' : 'Cash purchase'}</Label>
                  <div className="flex h-8 items-center gap-2">
                    <input type="checkbox" id={`${type.toLowerCase()}-cash-mode`} checked={isCash} onChange={event => toggleCash(event.target.checked)} className="h-4 w-4 shrink-0 rounded accent-primary" />
                    <Label htmlFor={`${type.toLowerCase()}-cash-mode`} className="cursor-pointer font-normal">{isSales ? 'Cash sale' : 'Cash purchase'}</Label>
                  </div>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label>Credit days</Label>
                  <Input type="number" min="0" step="1" value={isCash ? 0 : creditDays} disabled={isCash} onChange={e => setCreditDays(Number(e.target.value))} className="w-full" />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label>Due date</Label>
                  <div className="relative">
                    <Input value={dueDateBs} readOnly tabIndex={-1} className="w-full !bg-[#f6f6f6] pr-9" />
                    <CalendarDays aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
              </div>

              {isCash ? (
                <div className="border-t border-border px-4 py-2.5">
                  <LedgerBalanceHint account={cashAccount} />
                </div>
              ) : (
                <div className="grid min-w-0 gap-4 border-t border-border px-4 py-3.5 lg:grid-cols-[minmax(22rem,1.15fr)_minmax(18rem,1fr)] lg:gap-5">
                  <div data-create-context="party" className="min-w-0">
                    <Label>{isSales ? 'Customer' : 'Supplier'}</Label>
                    <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5">
                      <SearchableSelect mode="typeahead" triggerRef={partyTriggerRef} onTriggerFocus={() => { createContextRef.current = { kind: 'party' } }} className="min-w-0" value={partyAccountId} onValueChange={selectParty} placeholder={`Select ${isSales ? 'customer' : 'supplier'}`} searchPlaceholder={`Search ${isSales ? 'customer' : 'supplier'}…`} options={partyList.map(p => partySelectorOption(p, accounts.find(account => account.id === p.account_id)))} />
                      <div className="flex flex-col items-center gap-1">
                        <Button type="button" variant="outline" size="sm" tabIndex={-1} className="shrink-0 bg-white px-3 text-primary hover:bg-primary/5 hover:text-primary" onClick={() => setShowPartyForm(true)}><Plus className="mr-1 h-3.5 w-3.5" />New</Button>
                        <CreateShortcutHint className="ml-0 text-muted-foreground" />
                      </div>
                    </div>
                    <LedgerBalanceHint account={selectedPartyAccount} party={selectedParty} />
                  </div>
                  <div className="grid min-w-0 gap-y-4 sm:grid-cols-3 sm:gap-x-6 lg:border-l lg:border-border lg:pl-5">
                    <PartyDetailDisplay label="Address" value={selectedPartyAddress} />
                    <PartyDetailDisplay label="Phone No." value={selectedPartyPhone} />
                    <PartyDetailDisplay label="PAN No." value={selectedPartyPanNo} />
                  </div>
                </div>
              )}
            </section>

            {/* Line items */}
            <section className="invoice-section invoice-items-section" aria-labelledby="invoice-line-items">
              <div className="mb-3">
                <div>
                  <h3 id="invoice-line-items" className="invoice-section-title">Invoice items</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Quantities, units, rates, and line amounts</p>
                </div>
              </div>
              <div className="mb-1.5 hidden grid-cols-[minmax(0,2.55fr)_minmax(0,0.75fr)_minmax(0,0.55fr)_minmax(0,0.65fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_2rem] gap-1.5 lg:grid">
                {['Item', 'Av. Stock', 'Qty', 'Unit', 'Rate', 'Amount', ''].map(h => (
                  <p key={h} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</p>
                ))}
              </div>
              <div className="invoice-line-list space-y-1">
                {lines.map((line, idx) => {
                  const rate = rateInputNumber(line.rate)
                  const calculatedAmount = round2Local(line.qty * rate)
                  const amountValue = line.amount_input !== undefined ? line.amount_input : (Number.isFinite(calculatedAmount) ? calculatedAmount : '')
                  const selectedItem = items.find(item => item.id === line.item_id)
                  const stock = line.item_id ? getStockEntry(line.item_id) : null
                  const isServiceLine = !!selectedItem?.is_service
                  return (
                    <div key={idx} data-create-line={idx} className="grid grid-cols-2 gap-2 rounded-md border p-2 lg:grid-cols-[minmax(0,2.55fr)_minmax(0,0.75fr)_minmax(0,0.55fr)_minmax(0,0.65fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_2rem] lg:items-start lg:gap-1.5 lg:border-0 lg:p-0">
                      <div className="col-span-2 flex min-w-0 gap-1 lg:col-span-1">
                        <SearchableSelect mode="typeahead" triggerRef={element => { itemTriggerRefs.current[idx] = element }} onTriggerFocus={() => { createContextRef.current = { kind: 'item', index: idx } }} value={line.item_id} onValueChange={v => updateLine(idx, 'item_id', v)} placeholder="Select item…" searchPlaceholder="Search item by name or SKU…" options={items.filter(i => !i.is_archived).map(i => itemSelectorOption(i))} />
                        <Button type="button" variant="outline" size="sm" tabIndex={-1} aria-label="Create new item (Alt+I)" className="h-8 flex-shrink-0 bg-white px-2 hover:bg-white" onClick={() => { setNewItemLineIdx(idx); setShowItemForm(true) }}>
                          <Plus className="h-3.5 w-3.5" /><ItemCreateShortcutHint className="ml-1" />
                        </Button>
                      </div>
                      <div className="col-span-2 min-w-0 space-y-1 lg:col-span-1"><Label className="text-xs lg:hidden">Av. Stock</Label><div className={`flex min-h-8 min-w-0 items-center whitespace-normal break-words text-[11px] leading-tight ${!isServiceLine && stock && stock.qty < 0 ? 'text-destructive' : 'text-muted-foreground'}`} title={!isServiceLine && stock && selectedItem ? formatStockQuantity(stock.qty, selectedItem) : undefined}>{isServiceLine ? 'Service' : stock && selectedItem ? formatStockQuantity(stock.qty, selectedItem) : '—'}</div></div>
                      <div className="space-y-1"><Label className="text-xs lg:hidden">Qty</Label>
                        <Input type="number" min="0.01" step="any" value={line.qty || ''} onChange={e => updateLine(idx, 'qty', e.target.value)} onWheel={event => event.currentTarget.blur()} placeholder="0" className="invoice-entry-value h-8 px-2" />
                        {isSales && !isServiceLine && stock && stock.qty < toBaseQty(line.qty, line.conversion_factor || 1) && line.qty > 0 && (
                          <p className="text-xs text-destructive mt-0.5">Only {selectedItem ? formatStockQuantity(stock.qty, selectedItem) : stock.qty} in stock</p>
                        )}
                      </div>
                      <div className="space-y-1"><Label className="text-xs lg:hidden">Unit</Label>{(() => {
                        const item = items.find(entry => entry.id === line.item_id)
                        const snapshotMatchesCurrent = line.unit_mode === 'main'
                          ? !line.entry_unit || line.entry_unit === item?.unit
                          : line.entry_unit === item?.alternate_unit
                        return item?.alternate_unit && !item.is_service && snapshotMatchesCurrent
                          ? <SearchableSelect tabIndex={-1} className="invoice-entry-value h-8 px-2" value={line.unit_mode} onValueChange={value => updateUnit(idx, value as UnitMode)} options={[{ value: 'main', label: item.unit }, { value: 'alternate', label: item.alternate_unit }]} />
                          : <div className="invoice-entry-value flex h-8 items-center truncate text-muted-foreground">{line.entry_unit || item?.unit || '-'}</div>
                      })()}</div>
                      <div className="space-y-1"><Label className="text-xs lg:hidden">Rate</Label><div className="relative"><Input type="number" min="0" step="any" value={line.rate === '' ? '' : line.rate} onChange={e => updateLine(idx, 'rate', e.target.value)} onBlur={() => roundLineRate(idx)} onWheel={event => event.currentTarget.blur()} placeholder="Rate" className={`invoice-entry-value h-8 px-2 ${line.pricing_rule_id ? 'pr-7' : ''}`} />{line.pricing_rule_id && <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-primary" title={line.price_overridden ? `${line.pricing_snapshot?.rule_name || 'Slab rate'} calculated ${formatRateInput(line.calculated_rate || 0)}; manually overridden` : `${line.pricing_snapshot?.rule_name || 'Slab pricing'}: threshold ${line.pricing_snapshot?.min_quantity} ${line.pricing_snapshot?.quantity_unit}`}><Tag className="h-3.5 w-3.5"/></span>}</div>{line.pricing_warning && <p className="text-[10px] text-amber-700">{line.pricing_warning}</p>}</div>
                      <div className="min-w-0 space-y-1"><Label className="text-xs lg:hidden">Amount</Label><Input type="number" min="0" step="any" value={amountValue} onChange={event => updateLineAmount(idx, event.target.value)} onWheel={event => event.currentTarget.blur()} placeholder="Amount" className="invoice-entry-value h-8 px-2 num font-semibold" /></div>
                      <Button type="button" variant="ghost" size="icon" tabIndex={-1} className="h-8 w-8 self-end text-muted-foreground hover:text-destructive lg:self-auto" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      {selectedItem?.is_serialized && company && <div className="col-span-2 flex items-center gap-2 lg:col-span-7 lg:pl-1">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">Serialized</span>
                        <SerialNumberEditor companyId={company.id} itemId={selectedItem.id} itemName={selectedItem.name} quantity={toBaseQty(line.qty, line.conversion_factor || 1)} mode={isSales ? 'sale' : 'purchase'} value={line.serial_numbers} onChange={serial_numbers => setLines(current => current.map((entry, row) => row === idx ? { ...entry, serial_numbers } : entry))} excludeVoucherId={voucher?.status === 'Completed' ? voucher.id : null} />
                      </div>}
                    </div>
                  )
                })}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3 bg-white hover:bg-white" onClick={addLine}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add line
              </Button>
            </section>

            <section className="invoice-section invoice-adjustments-section min-w-0 space-y-3" aria-labelledby="invoice-adjustments">
                <div>
                  <h3 id="invoice-adjustments" className="invoice-section-title">Adjustments &amp; notes</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Discount, VAT treatment, and narration</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="w-full space-y-1.5 sm:w-40">
                    <Label>Discount</Label>
                    <div className="flex overflow-hidden rounded-md border bg-white focus-within:ring-2 focus-within:ring-ring">
                      <Input type="number" min="0" max={discountMode === 'percent' ? 100 : undefined} step="any" value={discount || ''} onChange={e => setDiscount(Number(e.target.value))} placeholder="0" className="h-8 min-w-0 flex-1 border-0 focus-visible:ring-0" />
                      <div className="flex border-l bg-muted/30 p-0.5">
                        <Button type="button" size="sm" variant={discountMode === 'flat' ? 'default' : 'ghost'} className="h-6 px-2 text-xs" onClick={() => setDiscountMode('flat')}>Rs</Button>
                        <Button type="button" size="sm" variant={discountMode === 'percent' ? 'default' : 'ghost'} className="h-6 px-2 text-xs" onClick={() => setDiscountMode('percent')}>%</Button>
                      </div>
                    </div>
                  </div>
                  {vatEnabled && (
                    <div className="w-full space-y-1.5 sm:w-44">
                      <Label>VAT Rate</Label>
                      <SearchableSelect tabIndex={-1} value={String(vatRate)} onValueChange={v => setVatRate(Number(v))} options={[{ value: '13', label: '13% (Standard)' }, { value: '0', label: '0% (Exempt)' }]} />
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Narration (optional)</Label>
                  <Textarea value={narration} onChange={e => setNarration(e.target.value)} placeholder="Note about this transaction…" rows={2} />
                </div>
            </section>

            <section className="invoice-section invoice-summary-section space-y-3" aria-labelledby="invoice-summary">
                <div>
                  <h3 id="invoice-summary" className="invoice-section-title">Invoice summary</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Calculated from the current invoice lines</p>
                </div>
                <div className="space-y-2 rounded-md bg-muted/45 p-3 text-[14px]">
                  <div className="flex justify-between gap-6"><span className="text-muted-foreground">Total Quantity</span><span className="num font-medium">{totalQuantityLabel}</span></div>
                  <div className="flex justify-between gap-6"><span className="text-muted-foreground">Subtotal</span><span className="num font-medium">{fmtMoney(subtotal)}</span></div>
                  <div className="flex justify-between gap-6"><span className="text-muted-foreground">Discount{discountMode === 'percent' && discount > 0 ? ` (${discount}%)` : ''}</span><span className="num font-medium">- {fmtMoney(discountAmount)}</span></div>
                  {vatEnabled && <div className="flex justify-between gap-6"><span className="text-muted-foreground">VAT ({effectiveVatRate}%)</span><span className="num font-medium">{fmtMoney(vatAmount)}</span></div>}
                  <div className="mt-2 flex justify-between gap-6 border-t border-border pt-2 text-[17px] font-bold">
                    <span>Total</span><span className="num">{fmtMoney(total)}</span>
                  </div>
                </div>
            </section>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="invoice-workspace-footer grid grid-cols-2 gap-2 sm:flex sm:grid-cols-none sm:space-x-0">
            {voucher?.status === 'Draft' && <Button variant="destructive" tabIndex={-1} onClick={handleDeleteDraft} disabled={saving} className="order-5 col-span-2 sm:order-none sm:col-span-1">Delete Draft</Button>}
            <Button variant="outline" tabIndex={-1} onClick={() => void confirmDiscard().then(confirmed => { if (confirmed) onClose() })} className="order-4 sm:order-none">Cancel</Button>
            {canSaveDraft && <Button variant="outline" onClick={handleSaveDraft} disabled={saving} className="order-3 sm:order-none">
              {saving ? 'Saving...' : voucher?.status === 'Draft' && !freshAfterDraftRef.current ? 'Update Draft' : 'Save as Draft'}
              {!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+D</kbd>}
            </Button>}
            <Button onClick={() => handleSave('Completed')} disabled={saving} title="Save voucher (Alt+S)" className="order-1 sm:order-none">
              {saving ? 'Saving...' : completedEdit ? 'Save Changes' : 'Save Voucher'}{!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+S</kbd>}
            </Button>
            <Button variant="outline" onClick={() => handleSave('Completed', true)} disabled={saving} title="Save and print (Alt+P)" className="order-2 sm:order-none">
              <Printer className="mr-1 h-4 w-4" />Save &amp; Print<kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+P</kbd>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showPartyForm && <LedgerDialog open onClose={() => setShowPartyForm(false)} defaultPartyType={partyType}
        onCreated={(account, party) => { setPartyAccountId(account.id); setCreditDays(party?.default_credit_days ?? account.credit_days ?? 0); setShowPartyForm(false); focusAfterNestedDialogCloses(() => partyTriggerRef.current, true) }} />}
      <ItemForm open={showItemForm} onClose={() => setShowItemForm(false)}
        onCreated={(item: import('@/types').Item) => {
          const createdLineIndex = newItemLineIdx
          if (createdLineIndex !== null) {
            const next = [...lines]
            next[createdLineIndex] = { ...next[createdLineIndex], item_id: item.id, rate: formatRateInput(item.sell_rate || 0), unit_mode: 'main', entry_unit: item.unit, conversion_factor: 1 }
            setLines(next)
          }
          setShowItemForm(false)
          setNewItemLineIdx(null)
          if (createdLineIndex !== null) focusAfterNestedDialogCloses(() => itemTriggerRefs.current[createdLineIndex], true)
        }} />
    </>
  )
}
