import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Printer, Trash2 } from 'lucide-react'
import { useAppStore, type ReturnSaveParams } from '@/store/useAppStore'
import { buildReturnVoucherData, inventoryIssueCost, invoiceRateFromAmount, round6, type ReturnItemInput } from '@/lib/engine'
import { makeBsKey } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { partyTerminology } from '@/lib/partyTerminology'
import { resolveSystemAccountId } from '@/lib/engine'
import { bankAccounts, legacySettlementAccountId } from '@/lib/banks'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { fromBaseRate, toBaseQty, toBaseRate, unitFactor, unitName, type UnitMode } from '@/lib/units'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { focusLastSearchableSelect } from '@/lib/searchableSelectFocus'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { publicErrorMessage } from '@/lib/security'
import { friendlyVoucherDateError, validateVoucherDateForNumbering } from '@/lib/voucherDateValidation'
import { notifyError } from '@/lib/notifications'
import { formatRateInput, hasAtMostSixDecimalPlaces, rateInputNumber } from '@/lib/rateFormat'
import { ItemForm } from './OtherForms'
import { LedgerBalanceHint } from './LedgerBalanceHint'
import { VoucherNumberField } from './VoucherNumberField'
import type { StockCondition, Voucher } from '@/types'
import { SubmissionLock } from '@/lib/submissionLock'
import { stableFormSnapshot, useUnsavedChangesGuard } from '@/lib/unsavedChanges'
import { beginVoucherPrint, cancelVoucherPrint, completeVoucherPrint, useVoucherShortcuts, type VoucherPrintRequest } from '@/lib/voucherShortcuts'

interface ReturnFormProps {
  type: 'Sales Return' | 'Purchase Return'
  open: boolean
  onClose: () => void
  voucher?: Voucher | null
}

interface ReturnLine extends Omit<ReturnItemInput, 'rate'> {
  rate: string | number
  amount_input?: string
  original_qty: number
  returned_qty: number
  original_base_qty?: number
  returned_base_qty?: number
}

const LedgerDialog = lazy(() => import('@/pages/Masters').then(module => ({ default: module.LedgerDialog })))

export function ReturnForm({ type, open, onClose, voucher }: ReturnFormProps) {
  const { company, vouchers, items, stock, accounts, accountCategories, parties, getPartyByAccountId, saveReturnVoucher, updateReturnVoucher, saveDraftVoucher, deleteDraftVoucher } = useAppStore()
  const originalType = type === 'Sales Return' ? 'Sales' : 'Purchase'
  const isSalesReturn = type === 'Sales Return'
  const vatEnabled = company?.vat_enabled ?? true
  const [partyAccountId, setPartyAccountId] = useState('')
  const [originalId, setOriginalId] = useState('')
  const [dateBs, setDateBs] = useState(() => selectedFiscalYearEndBs(company))
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [settlementMode, setSettlementMode] = useState<'party' | 'cash' | 'bank'>('party')
  const cashAccountId = company ? resolveSystemAccountId(accounts, company.id, 'cash') : ''
  const banks = bankAccounts(accounts, accountCategories, !!voucher)
  const defaultBankId = banks[0]?.id || ''
  const [settlementAccountId, setSettlementAccountId] = useState('')
  const [stockCondition, setStockCondition] = useState<StockCondition>('saleable')
  const [manualVatRate, setManualVatRate] = useState(vatEnabled ? 13 : 0)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [dateInvalid, setDateInvalid] = useState(false)
  const submissionLock = useRef(new SubmissionLock()).current
  const [error, setError] = useState('')
  const [showPartyForm, setShowPartyForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [newItemLineIdx, setNewItemLineIdx] = useState<number | null>(null)
  const partyTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const initializedFormRef = useRef<string | null>(null)
  const baselineRef = useRef('')
  const snapshotRef = useRef('')
  const workingDraftIdRef = useRef<string | undefined>(voucher?.status === 'Draft' ? voucher.id : undefined)
  const freshAfterDraftRef = useRef(false)
  const pendingManualLineFocus = useRef(false)

  const emptyManualLine = useCallback((): ReturnLine => ({
    item_id: '', item_name: '', unit: '', entry_unit: '', conversion_factor: 1,
    qty: 0, rate: 0, cost_rate: 0, original_qty: 0, returned_qty: 0, original_base_qty: 0, returned_base_qty: 0,
  }), [])

  const fiscalStart = selectedFiscalYearStartBs(company)
  const fiscalEndKey = makeBsKey(`${Number(fiscalStart.slice(0, 4)) + 1}-${fiscalStart.slice(5)}`)
  const originals = useMemo(() => vouchers
    .filter(entry => {
      const key = entry.date_bs_key || makeBsKey(entry.date_bs)
      const isEditingSource = !!voucher && entry.id === voucher.original_voucher_id
      return entry.type === originalType && !entry.cancelled && (entry.invoice_items?.length || 0) > 0 &&
        (isEditingSource || (key >= makeBsKey(fiscalStart) && key < fiscalEndKey))
    })
    .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq), [vouchers, originalType, voucher, fiscalStart, fiscalEndKey])
  const original = originals.find(entry => entry.id === originalId)

  const makeLines = useCallback((source: Voucher, editing?: Voucher | null) => (source.invoice_items || []).map(line => {
    const selectedItem = items.find(item => item.id === line.item_id)
    const existing = editing?.invoice_items?.find(item => item.source_invoice_item_id === line.id)
    const returnedBaseQty = line.id ? vouchers
      .filter(entry => entry.id !== voucher?.id && entry.type === type && !entry.cancelled && entry.original_voucher_id === source.id)
      .flatMap(entry => entry.invoice_items || [])
      .filter(item => item.source_invoice_item_id === line.id)
      .reduce((sum, item) => sum + (item.base_qty ?? toBaseQty(item.qty, item.conversion_factor || 1)), 0) : 0
    const sourceFactor = line.conversion_factor || 1
    const sourceBaseQty = line.base_qty ?? toBaseQty(line.qty, sourceFactor)
    const entryFactor = existing?.conversion_factor || sourceFactor
    const entryUnit = existing?.entry_unit || existing?.unit || line.entry_unit || line.unit || selectedItem?.unit || ''
    const derivedCostRate = source.type === 'Sales'
      ? inventoryIssueCost(items, vouchers, source.id, line.item_id, company?.inventory_valuation_method)?.rate
      : source.stock_lines?.find(stockLine => stockLine.item_id === line.item_id && stockLine.direction === 'in')?.rate
    return {
      id: existing?.id,
      source_invoice_item_id: line.id || '',
      item_id: line.item_id,
      item_name: line.item_name || selectedItem?.name || line.item_id,
      unit: entryUnit,
      entry_unit: entryUnit,
      conversion_factor: entryFactor,
      base_qty: existing?.base_qty ?? toBaseQty(existing?.qty || 0, entryFactor),
      qty: existing?.qty || 0,
      rate: formatRateInput(existing?.rate ?? line.rate),
      amount_input: existing?.amount == null ? undefined : String(existing.amount),
      cost_rate: derivedCostRate ?? existing?.cost_rate ?? line.cost_rate ?? stock.find(entry => entry.id === line.item_id)?.avg_cost ?? 0,
      original_qty: line.qty,
      returned_qty: returnedBaseQty * entryFactor,
      original_base_qty: sourceBaseQty,
      returned_base_qty: returnedBaseQty,
      is_service: !!selectedItem?.is_service,
    }
  }), [company?.inventory_valuation_method, items, stock, type, voucher?.id, vouchers])

  useEffect(() => {
    const formIdentity = `${type}:${voucher?.id || 'new'}`
    if (!open) {
      initializedFormRef.current = null
      baselineRef.current = ''
      workingDraftIdRef.current = undefined
      freshAfterDraftRef.current = false
      setPartyAccountId(''); setOriginalId(''); setDateBs(selectedFiscalYearEndBs(company)); setLines([emptyManualLine()]); setSettlementMode('party'); setSettlementAccountId(''); setStockCondition('saleable'); setManualVatRate(vatEnabled ? 13 : 0); setReason(''); setError(''); setDateInvalid(false)
      return
    }
    if (initializedFormRef.current === formIdentity) return
    initializedFormRef.current = formIdentity
    baselineRef.current = ''
    workingDraftIdRef.current = voucher?.status === 'Draft' ? voucher.id : undefined
    freshAfterDraftRef.current = false
    if (voucher) {
      const draft = voucher.status === 'Draft' ? voucher.draft_payload as Partial<{
        partyAccountId: string; originalId: string; dateBs: string; lines: ReturnLine[]; settlementMode: 'party' | 'cash' | 'bank'; settlementAccountId: string; stockCondition: StockCondition; manualVatRate: number; reason: string
      }> | null : null
      const source = vouchers.find(entry => entry.id === voucher.original_voucher_id)
      setPartyAccountId(draft?.partyAccountId ?? voucher.party_account_id ?? source?.party_account_id ?? '')
      setOriginalId(draft?.originalId ?? voucher.original_voucher_id ?? '')
      setDateBs(draft?.dateBs ?? voucher.date_bs)
      setSettlementMode(draft?.settlementMode ?? voucher.settlement_mode ?? (source?.party_account_id ? 'party' : 'cash'))
      setSettlementAccountId(draft?.settlementAccountId ?? legacySettlementAccountId(voucher) ?? (voucher.is_cash ? cashAccountId : defaultBankId))
      setStockCondition(draft?.stockCondition ?? voucher.stock_lines?.[0]?.stock_condition ?? (voucher.restock_items === false ? 'damaged' : 'saleable'))
      setManualVatRate(draft?.manualVatRate ?? voucher.vat_rate ?? 0)
      setReason(draft?.reason ?? voucher.return_reason ?? voucher.narration ?? '')
      if (draft?.lines?.length) setLines(draft.lines.map(line => ({ ...line, amount_input: line.amount_input ?? (line.amount == null ? undefined : String(line.amount)) })))
      else if (source) setLines(makeLines(source, voucher))
      else setLines((voucher.invoice_items || []).map(line => ({ ...line, rate: formatRateInput(line.rate), amount_input: line.amount == null ? undefined : String(line.amount), source_invoice_item_id: undefined, item_name: line.item_name || items.find(item => item.id === line.item_id)?.name || '', unit: line.unit || items.find(item => item.id === line.item_id)?.unit || '', entry_unit: line.entry_unit || line.unit, conversion_factor: line.conversion_factor || 1, cost_rate: line.cost_rate || stock.find(entry => entry.id === line.item_id)?.avg_cost || 0, original_qty: 0, returned_qty: 0, original_base_qty: 0, returned_base_qty: 0 })))
    } else {
      setLines(current => current.length ? current : [emptyManualLine()])
    }
    window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
  }, [open, voucher, vouchers, makeLines, cashAccountId, defaultBankId, emptyManualLine, items, stock, vatEnabled, company, type])

  const selectParty = (accountId: string) => {
    setPartyAccountId(accountId)
    if (original && original.party_account_id !== accountId) {
      setOriginalId('')
      setLines([emptyManualLine()])
    }
    setSettlementMode('party')
  }

  const selectOriginal = (id: string) => {
    if (id === '__manual__') {
      setOriginalId('')
      setLines([emptyManualLine()])
      setSettlementMode(partyAccountId ? 'party' : 'cash')
      return
    }
    const source = originals.find(entry => entry.id === id)
    setOriginalId(id)
    if (!source) return setLines([])
    setPartyAccountId(source.party_account_id || '')
    setSettlementMode(source.party_account_id ? 'party' : 'cash')
    setSettlementAccountId(cashAccountId)
    setLines(makeLines(source))
  }

  const updateManualItem = (index: number, itemId: string) => {
    const selected = items.find(item => item.id === itemId)
    setLines(current => current.map((line, row) => row === index ? {
      ...line, item_id: itemId, item_name: selected?.name || '', unit: selected?.unit || '', entry_unit: selected?.unit || '',
      conversion_factor: 1, base_qty: 0, rate: 0, amount_input: undefined, cost_rate: selected?.is_service ? 0 : (stock.find(entry => entry.id === itemId)?.avg_cost || selected?.opening_rate || 0), is_service: !!selected?.is_service,
    } : line))
  }

  const lineOriginalBaseQty = (line: ReturnLine) => line.original_base_qty ?? toBaseQty(line.original_qty || 0, line.conversion_factor || 1)
  const lineReturnedBaseQty = (line: ReturnLine) => line.returned_base_qty ?? toBaseQty(line.returned_qty || 0, line.conversion_factor || 1)

  const updateReturnUnit = (index: number, mode: UnitMode) => setLines(current => current.map((line, row) => {
    if (row !== index) return line
    const item = items.find(entry => entry.id === line.item_id)
    const oldFactor = line.conversion_factor || 1
    const factor = unitFactor(item, mode)
    const convertedRate = fromBaseRate(toBaseRate(rateInputNumber(line.rate), oldFactor), factor)
    return {
      ...line,
      base_qty: toBaseQty(line.qty || 0, factor),
      entry_unit: unitName(item, mode),
      unit: unitName(item, mode),
      conversion_factor: factor,
      rate: formatRateInput(convertedRate),
      original_qty: round6(lineOriginalBaseQty(line) * factor),
      returned_qty: round6(lineReturnedBaseQty(line) * factor),
    }
  }))

  const updateLineQuantity = (index: number, value: string) => setLines(current => current.map((line, row) => {
    if (row !== index) return line
    const qty = Number(value)
    const derivedRate = line.amount_input !== undefined && line.amount_input !== ''
      ? invoiceRateFromAmount(Number(line.amount_input), qty)
      : null
    return { ...line, qty, base_qty: toBaseQty(qty, line.conversion_factor || 1), ...(derivedRate !== null ? { rate: String(derivedRate) } : {}) }
  }))

  const updateLineRate = (index: number, value: string) => setLines(current => current.map((line, row) => row === index ? { ...line, rate: value, amount_input: undefined } : line))

  const updateLineAmount = (index: number, value: string) => {
    const line = lines[index]
    if (!line) return
    if (value === '') {
      setLines(current => current.map((entry, row) => row === index ? { ...entry, amount_input: '', rate: '' } : entry))
      return
    }
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0) return
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      setError('Enter a quantity greater than zero before entering the line amount.')
      return
    }
    setLines(current => current.map((entry, row) => row === index ? { ...entry, amount_input: value, rate: String(invoiceRateFromAmount(amount, entry.qty) ?? 0) } : entry))
    setError('')
  }

  const selectedItems = lines.filter(line => original ? line.qty > 0 : !!line.item_id || line.qty > 0)
  const numericSelectedItems = useMemo(() => selectedItems.map(line => ({
    ...line,
    rate: rateInputNumber(line.rate),
    amount: round6(line.amount_input !== undefined && line.amount_input !== '' ? Number(line.amount_input) : line.qty * rateInputNumber(line.rate)),
    base_qty: toBaseQty(line.qty, line.conversion_factor || 1),
  })), [selectedItems])
  const preview = numericSelectedItems.length && (original || partyAccountId) ? buildReturnVoucherData({
    type, original, party_account_id: partyAccountId, vat_rate: manualVatRate, items: numericSelectedItems, settlement_mode: settlementMode, settlement_account_id: settlementMode === 'party' ? partyAccountId : settlementAccountId,
    restock_items: true, stock_condition: stockCondition, system_accounts: { cash: 'cash', bank: 'bank', sales_return: 'sales_return', purchase_return: 'purchase_return', vat_payable: 'vat_payable', vat_receivable: 'vat_receivable' },
  }) : null
  const dateValidation = useMemo(() => company ? validateVoucherDateForNumbering({ company, vouchers, type, dateBs, currentVoucherId: voucher?.status === 'Draft' ? undefined : voucher?.id, invoiceNo: voucher?.invoice_no, status: 'Completed' }) : { valid: true }, [company, vouchers, type, dateBs, voucher?.id, voucher?.invoice_no, voucher?.status])
  const formSnapshot = stableFormSnapshot({ partyAccountId, originalId, dateBs, lines, settlementMode, settlementAccountId, stockCondition, manualVatRate, reason })
  snapshotRef.current = formSnapshot
  const dirty = open && baselineRef.current !== '' && formSnapshot !== baselineRef.current
  const confirmDiscard = useUnsavedChangesGuard(open, dirty)
  useEffect(() => {
    if (!pendingManualLineFocus.current) return
    pendingManualLineFocus.current = false
    const frame = window.requestAnimationFrame(() => focusLastSearchableSelect('Select item...'))
    return () => window.cancelAnimationFrame(frame)
  }, [lines.length])

  useEffect(() => {
    if (dateInvalid && dateValidation.valid) setDateInvalid(false)
  }, [dateInvalid, dateValidation.valid])

  const save = async (status: Voucher['status'] = 'Completed', shouldPrint = false) => {
    setError('')
    if (status === 'Completed' && !dateValidation.valid) {
      const message = friendlyVoucherDateError(null, dateValidation) || 'Cannot save voucher. Voucher date is invalid.'
      setDateInvalid(true)
      setError(message)
      notifyError(message)
      setTimeout(() => dateInputRef.current?.focus(), 0)
      return
    }
    if (!original && !partyAccountId) return setError(`Select a ${partyTerminology(isSalesReturn ? 'customer' : 'supplier').singular}.`)
    if (!reason.trim()) return setError('Enter the reason for the return.')
    if (!selectedItems.length) return setError('Enter a quantity for at least one item.')
    for (const line of numericSelectedItems) {
      if (!line.item_id || !Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.rate) || line.rate < 0 || !Number.isFinite(line.amount) || line.amount < 0) return setError('Select an item and enter a quantity greater than zero for every return line. Rate and amount can be zero but cannot be negative.')
      if (!hasAtMostSixDecimalPlaces(line.qty) || !hasAtMostSixDecimalPlaces(line.rate) || !hasAtMostSixDecimalPlaces(line.amount)) return setError('Quantity, rate, and amount support up to six decimal places.')
      if (original) {
        const remainingBase = round6(lineOriginalBaseQty(line) - lineReturnedBaseQty(line))
        const requestedBase = toBaseQty(line.qty, line.conversion_factor || 1)
        if (requestedBase > remainingBase + 0.0001) return setError(`${line.item_name} has only ${round6(remainingBase * (line.conversion_factor || 1))} ${line.entry_unit || line.unit} remaining to return.`)
      }
    }
    if (settlementMode !== 'party' && !settlementAccountId) return setError('Select a settlement account.')
    const returnItems: ReturnItemInput[] = numericSelectedItems.map(({ original_qty: _originalQty, returned_qty: _returnedQty, original_base_qty: _originalBaseQty, returned_base_qty: _returnedBaseQty, amount_input: _amountInput, ...item }) => item)
    const params: ReturnSaveParams = { type, original_voucher_id: original?.id, party_account_id: original?.party_account_id || partyAccountId, vat_rate: original ? original.vat_rate : manualVatRate, items: returnItems, settlement_mode: settlementMode, settlement_account_id: settlementMode === 'party' ? (original?.party_account_id || partyAccountId) : settlementAccountId, restock_items: true, stock_condition: stockCondition, return_reason: reason.trim(), date_bs: dateBs }
    if (!submissionLock.tryAcquire()) return
    let printRequest: VoucherPrintRequest | undefined = shouldPrint ? beginVoucherPrint() : undefined
    setSaving(true)
    try {
      const targetVoucherId = freshAfterDraftRef.current ? undefined : (voucher?.id || workingDraftIdRef.current)
      if (targetVoucherId) await updateReturnVoucher(targetVoucherId, params, status)
      else await saveReturnVoucher(params, status)
      workingDraftIdRef.current = undefined
      completeVoucherPrint(printRequest, type, voucher)
      printRequest = undefined
      if (voucher) {
        onClose()
      } else {
        baselineRef.current = ''
        setPartyAccountId('')
        setOriginalId('')
        setDateBs(selectedFiscalYearEndBs(company))
        setLines([emptyManualLine()])
        setSettlementMode('party')
        setSettlementAccountId('')
        setStockCondition('saleable')
        setManualVatRate(vatEnabled ? 13 : 0)
        setReason('')
        setError('')
        setDateInvalid(false)
        window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
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
        setError(publicErrorMessage(e, `saving ${isSalesReturn ? 'sales' : 'purchase'} return`))
      }
    } finally { submissionLock.release(); setSaving(false) }
  }

  useVoucherShortcuts({ open, disabled: saving, draftDisabled: saving, onSave: () => { void save('Completed') }, onSaveAndPrint: () => { void save('Completed', true) }, onSaveDraft: !voucher || voucher.status === 'Draft' ? () => { void saveDraft() } : undefined })

  const deleteDraft = async () => {
    if (!voucher || voucher.status !== 'Draft') return
    setSaving(true)
    try { await deleteDraftVoucher(voucher.id); onClose() }
    catch (e: unknown) { setError(publicErrorMessage(e, 'deleting draft voucher')) }
    finally { setSaving(false) }
  }

  const saveDraft = async () => {
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
        narration: reason,
        party_account_id: partyAccountId || null,
        is_cash: settlementMode === 'cash',
        total: preview?.total || 0,
        draft_payload: { partyAccountId, originalId, dateBs, lines: numericSelectedItems.map(line => ({ ...line, rate: formatRateInput(line.rate) })), settlementMode, settlementAccountId, stockCondition, manualVatRate, reason },
      })
      workingDraftIdRef.current = undefined
      freshAfterDraftRef.current = true
      baselineRef.current = ''
      setPartyAccountId(''); setOriginalId(''); setDateBs(selectedFiscalYearEndBs(company)); setLines([emptyManualLine()]); setSettlementMode('party'); setSettlementAccountId(''); setStockCondition('saleable'); setManualVatRate(vatEnabled ? 13 : 0); setReason(''); setError(''); setDateInvalid(false)
      window.setTimeout(() => { baselineRef.current = snapshotRef.current }, 0)
    } catch (e: unknown) { setError(publicErrorMessage(e, `saving ${isSalesReturn ? 'sales' : 'purchase'} return draft`)) }
    finally { setSaving(false) }
  }

  const party = partyAccountId ? getPartyByAccountId(partyAccountId) : null
  const activeSettlementAccountId = settlementMode === 'party' ? partyAccountId : settlementAccountId
  const activeSettlementAccount = accounts.find(account => account.id === activeSettlementAccountId)
  const documentName = vatEnabled ? (isSalesReturn ? 'Credit Note' : 'Debit Note') : type
  const canSaveDraft = !voucher || voucher.status === 'Draft'
  const completedEdit = !!voucher && voucher.status !== 'Draft'

  return <>
    <Dialog open={open} onOpenChange={value => { if (!value) void confirmDiscard().then(confirmed => { if (confirmed) onClose() }) }}>
      <DialogContent onClickCapture={event => { const target = event.target; if (target instanceof Element && target.closest('button')?.textContent?.includes('Add item')) pendingManualLineFocus.current = true }} className="voucher-dialog max-w-4xl max-h-[92vh] overflow-y-auto md:left-[calc(50%+7rem)] md:w-[calc(100vw-15rem)]">
        <DialogHeader><DialogTitle>{voucher && !freshAfterDraftRef.current ? 'Alter' : 'New'} {documentName}</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Return Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} min={selectedFiscalYearStartBs(company)} max={selectedFiscalYearEndBs(company)} tabIndex={-1} error={dateInvalid} showErrorText={false} inputRef={dateInputRef} /></div>
            <VoucherNumberField type={type} dateBs={dateBs} voucher={voucher} />
          </div>

          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <div className="min-w-0 space-y-1.5"><Label>{partyTerminology(isSalesReturn ? 'customer' : 'supplier').singular}</Label><div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"><SearchableSelect triggerRef={partyTriggerRef} autoFocus={!voucher} value={partyAccountId} onValueChange={selectParty} disabled={!!voucher && !!original} placeholder={`Select ${partyTerminology(isSalesReturn ? 'customer' : 'supplier').singular}`} searchPlaceholder={`Search ${partyTerminology(isSalesReturn ? 'customer' : 'supplier').plural}...`} options={parties.filter(entry => entry.type === (isSalesReturn ? 'customer' : 'supplier') && (!entry.is_archived || entry.account_id === partyAccountId)).map(entry => ({ value: entry.account_id, label: entry.name, searchText: `${entry.phone || ''} ${entry.pan_vat || ''} ${entry.address || ''}`, disabled: !!entry.is_archived }))} /><Button type="button" variant="outline" disabled={!!voucher && !!original} onClick={() => setShowPartyForm(true)}><Plus className="mr-1 h-4 w-4" />New</Button></div><LedgerBalanceHint account={accounts.find(account => account.id === partyAccountId)} party={party} /></div>
            <div className="min-w-0 space-y-1.5"><Label>{originalType === 'Sales' ? 'Sales Invoice' : 'Purchase Bill'} (optional)</Label><SearchableSelect value={originalId || '__manual__'} onValueChange={selectOriginal} disabled={!!voucher} placeholder="Manual return without bill" searchPlaceholder={`Search current fiscal year ${originalType.toLowerCase()} bills...`} options={[{ value: '__manual__', label: 'No bill — enter return manually' }, ...originals.map(entry => { const entryParty = entry.party_account_id ? getPartyByAccountId(entry.party_account_id)?.name : 'Cash'; return { value: entry.id, label: `${entry.invoice_no || entry.seq} | ${fmtDate(entry.date_bs)} | ${entryParty} | ${fmtMoney(entry.total)}`, searchText: `${entry.type} ${entry.date_bs} ${entryParty} ${entry.total}` } })]} /><p className="text-xs text-muted-foreground">All eligible current fiscal year bills are shown.</p></div>
          </div>

          {original && <div className="min-w-0 truncate rounded-md border bg-muted/20 p-3 text-sm" title={`${original.invoice_no || original.seq} | ${party?.name || 'Cash'} | VAT ${original.vat_rate || 0}% | Total ${fmtMoney(original.total)}`}><span className="font-medium">Original document:</span> {original.invoice_no || original.seq} | {party?.name || 'Cash'} | VAT {original.vat_rate || 0}% | Total {fmtMoney(original.total)}</div>}

          {original && <div className="max-w-full overflow-x-auto rounded-md border"><table className="w-full min-w-[720px] table-fixed text-sm"><colgroup><col className="w-[25%]" /><col className="w-[12%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[13%]" /></colgroup><thead><tr className="bg-muted/50"><th className="report-th text-left">Item</th><th className="report-th text-right">Original</th><th className="report-th text-right">Remaining</th><th className="report-th text-right">Return Qty</th><th className="report-th text-left">Unit</th><th className="report-th text-right">Rate</th><th className="report-th text-right">Amount</th></tr></thead><tbody>{lines.map((line, index) => {
            const item = items.find(entry => entry.id === line.item_id)
            const factor = line.conversion_factor || 1
            const originalQty = round6(lineOriginalBaseQty(line) * factor)
            const remaining = round6((lineOriginalBaseQty(line) - lineReturnedBaseQty(line)) * factor)
            const lineRate = rateInputNumber(line.rate)
            const amountValue = line.amount_input !== undefined ? line.amount_input : String(round6(line.qty * lineRate))
            const mode: UnitMode = item?.alternate_unit && line.entry_unit === item.alternate_unit ? 'alternate' : 'main'
            const unitCompatible = !!item && !item.is_service && !!item.alternate_unit && (line.entry_unit === item.unit || line.entry_unit === item.alternate_unit)
            const selectedUnit = line.entry_unit || line.unit || item?.unit || ''
            return <tr key={line.source_invoice_item_id} className="border-t"><td className="report-td truncate font-medium" title={line.item_name}>{line.item_name}</td><td className="report-td whitespace-nowrap text-right num">{originalQty} <span className="font-sans text-xs text-muted-foreground">{selectedUnit}</span></td><td className="report-td whitespace-nowrap text-right num font-semibold">{remaining} <span className="font-sans text-xs text-muted-foreground">{selectedUnit}</span></td><td className="report-td"><Input type="number" min="0" max={remaining} step="any" value={line.qty || ''} onChange={event => updateLineQuantity(index, event.target.value)} onWheel={event => event.currentTarget.blur()} className="w-full min-w-0 text-right" /></td><td className="report-td min-w-0">{unitCompatible ? <SearchableSelect value={mode} onValueChange={value => updateReturnUnit(index, value as UnitMode)} options={[{ value: 'main', label: item.unit }, { value: 'alternate', label: item.alternate_unit! }]} /> : <span className="block truncate" title={selectedUnit}>{selectedUnit}</span>}</td><td className="report-td whitespace-nowrap text-right num">{fmtMoney(lineRate)}</td><td className="report-td"><Input type="number" min="0" step="any" value={amountValue} onChange={event => updateLineAmount(index, event.target.value)} onWheel={event => event.currentTarget.blur()} className="w-full min-w-0 text-right" /></td></tr>
          })}</tbody></table></div>}

          {!original && <div className="space-y-2 overflow-x-auto rounded-md border p-2"><div className="grid min-w-[760px] grid-cols-[minmax(15rem,1fr)_7rem_8rem_9rem_10rem_2rem] gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><span>Item</span><span>Qty</span><span>Unit</span><span>Rate</span><span className="text-right">Amount</span><span /></div>{lines.map((line, index) => { const item = items.find(entry => entry.id === line.item_id); const mode: UnitMode = item?.alternate_unit && !item.is_service && line.entry_unit === item.alternate_unit ? 'alternate' : 'main'; const lineRate = rateInputNumber(line.rate); const amountValue = line.amount_input !== undefined ? line.amount_input : String(round6(line.qty * lineRate)); return <div key={index} className="grid min-w-[760px] grid-cols-[minmax(15rem,1fr)_7rem_8rem_9rem_10rem_2rem] items-center gap-2"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1"><SearchableSelect value={line.item_id} onValueChange={value => updateManualItem(index, value)} placeholder="Select item..." searchPlaceholder="Search item, SKU or barcode..." options={items.filter(entry => !entry.is_archived).map(entry => ({ value: entry.id, label: entry.is_service ? `${entry.name} (Service)` : entry.name, searchText: `${entry.sku || ''} ${entry.barcode || ''} ${entry.unit} ${entry.alternate_unit || ''} ${entry.is_service ? 'service' : ''}` }))} /><Button type="button" variant="outline" size="icon" aria-label="Create new item" onClick={() => { setNewItemLineIdx(index); setShowItemForm(true) }}><Plus className="h-4 w-4" /></Button></div><Input type="number" min="0" step="any" value={line.qty || ''} onChange={event => updateLineQuantity(index, event.target.value)} onWheel={event => event.currentTarget.blur()} placeholder="Qty" />{item?.alternate_unit && !item.is_service ? <SearchableSelect value={mode} onValueChange={value => updateReturnUnit(index, value as UnitMode)} options={[{ value: 'main', label: item.unit }, { value: 'alternate', label: item.alternate_unit }]} /> : <div className="flex h-8 items-center px-2 text-sm">{item?.is_service ? 'Service' : item?.unit || '—'}</div>}<Input type="number" min="0" step="any" value={line.rate === '' ? '' : line.rate} onChange={event => updateLineRate(index, event.target.value)} onBlur={() => setLines(current => current.map((entry, row) => row === index ? { ...entry, rate: formatRateInput(entry.rate) } : entry))} onWheel={event => event.currentTarget.blur()} placeholder="Rate" /><Input type="number" min="0" step="any" value={amountValue} onChange={event => updateLineAmount(index, event.target.value)} onWheel={event => event.currentTarget.blur()} className="text-right" placeholder="Amount" /><Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, row) => row !== index))}><Trash2 className="h-4 w-4" /></Button></div>})}<Button type="button" variant="outline" size="sm" onClick={() => setLines(current => [...current, emptyManualLine()])}><Plus className="mr-1 h-4 w-4" />Add item</Button></div>}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Settlement</Label><SearchableSelect autoFocus={!!voucher} value={settlementMode} onValueChange={value => { const mode = value as 'party' | 'cash' | 'bank'; setSettlementMode(mode); if (mode === 'cash') setSettlementAccountId(cashAccountId); if (mode === 'bank') setSettlementAccountId(defaultBankId) }} options={[...(partyAccountId ? [{ value: 'party', label: `Adjust ${partyTerminology(isSalesReturn ? 'customer' : 'supplier').singular} balance` }] : []), { value: 'cash', label: `Cash ${isSalesReturn ? 'refund' : 'received'}` }, { value: 'bank', label: `Bank account ${isSalesReturn ? 'refund' : 'received'}` }]} />{settlementMode === 'bank' && <SearchableSelect value={settlementAccountId} onValueChange={setSettlementAccountId} placeholder="Select bank account" options={banks.map(account => ({ value: account.id, label: account.name, searchText: `${account.name} Bank`, disabled: !!account.is_archived }))} />}<LedgerBalanceHint account={activeSettlementAccount} party={settlementMode === 'party' ? party : null} /></div>
            <div className="space-y-1.5"><Label>{isSalesReturn ? 'Stock Destination' : 'Stock Source'}</Label><SearchableSelect value={stockCondition} onValueChange={value => setStockCondition(value as StockCondition)} options={[{ value: 'saleable', label: 'Saleable' }, { value: 'expired', label: 'Expired' }, { value: 'damaged', label: 'Damage' }]} /></div>
          </div>

          <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
            <div className="min-w-0 space-y-3">
              {vatEnabled && <div className="w-48 space-y-1.5"><Label>VAT Rate</Label>{original ? <Input value={`${original.vat_rate || 0}% (From original bill)`} readOnly tabIndex={-1} className="bg-muted/40" /> : <SearchableSelect value={String(manualVatRate)} onValueChange={value => setManualVatRate(Number(value))} options={[{ value: '13', label: '13% (Standard)' }, { value: '0', label: '0% (Exempt)' }]} />}</div>}
              <div className="space-y-1.5"><Label>Return Reason</Label><Textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} className="min-h-[3.75rem] resize-none" placeholder="Damaged goods, wrong item, sundry debtor return..." /></div>
            </div>

            {preview && <div className="h-full w-full space-y-2 rounded-md bg-muted/40 p-3 text-sm"><div className="flex justify-between gap-4"><span>Gross Return</span><span className="num">{fmtMoney(preview.subtotal)}</span></div><div className="flex justify-between gap-4"><span>Allocated Discount</span><span className="num">- {fmtMoney(preview.discount)}</span></div>{vatEnabled && <div className="flex justify-between gap-4"><span>VAT Reversal ({preview.vat_rate}%)</span><span className="num">{fmtMoney(preview.vat_amount)}</span></div>}<div className="flex justify-between gap-4 border-t pt-2 font-serif text-base font-bold"><span>Return Total</span><span className="num">{fmtMoney(preview.total)}</span></div></div>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          {voucher?.status === 'Draft' && <Button variant="destructive" onClick={deleteDraft} disabled={saving}>Delete Draft</Button>}
          <Button variant="outline" onClick={() => void confirmDiscard().then(confirmed => { if (confirmed) onClose() })}>Cancel</Button>
          {canSaveDraft && <Button variant="outline" onClick={saveDraft} disabled={saving}>{saving ? 'Saving...' : voucher?.status === 'Draft' && !freshAfterDraftRef.current ? 'Update Draft' : 'Save as Draft'}{!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+D</kbd>}</Button>}
          <Button onClick={() => save('Completed')} disabled={saving} title="Save voucher (Alt+S)">{saving ? 'Saving...' : completedEdit ? 'Save Changes' : 'Save Voucher'}{!saving && <kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+S</kbd>}</Button>
          <Button variant="outline" onClick={() => save('Completed', true)} disabled={saving} title="Save and print (Alt+P)"><Printer className="mr-1 h-4 w-4" />Save &amp; Print<kbd className="ml-2 rounded border border-current/25 px-1 py-0.5 text-[9px] font-semibold">Alt+P</kbd></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {showPartyForm && <LedgerDialog open onClose={() => setShowPartyForm(false)} defaultPartyType={isSalesReturn ? 'customer' : 'supplier'} onCreated={account => { selectParty(account.id); setShowPartyForm(false) }} />}
    <ItemForm open={showItemForm} onClose={() => { setShowItemForm(false); setNewItemLineIdx(null) }} onCreated={item => {
      if (newItemLineIdx !== null) {
        const costRate = item.is_service ? 0 : (stock.find(entry => entry.id === item.id)?.avg_cost || item.opening_rate || 0)
        setLines(current => current.map((line, index) => index === newItemLineIdx ? { ...line, item_id: item.id, item_name: item.name, qty: 0, unit: item.unit, entry_unit: item.unit, conversion_factor: 1, base_qty: 0, rate: 0, amount_input: undefined, cost_rate: costRate, is_service: item.is_service, original_qty: 0, returned_qty: 0, original_base_qty: 0, returned_base_qty: 0 } : line))
      }
      setShowItemForm(false)
      setNewItemLineIdx(null)
    }} />
  </>
}
