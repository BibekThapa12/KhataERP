import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore, type ReturnSaveParams } from '@/store/useAppStore'
import { buildReturnVoucherData, inventoryIssueCost, round2, type ReturnItemInput } from '@/lib/engine'
import { makeBsKey, todayBs } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { partyTerminology } from '@/lib/partyTerminology'
import { resolveSystemAccountId } from '@/lib/engine'
import { bankAccounts, legacySettlementAccountId } from '@/lib/banks'
import { selectedFiscalYearStartBs } from '@/lib/reports'
import { fromBaseRate, toBaseQty, toBaseRate, unitFactor, unitName, type UnitMode } from '@/lib/units'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LedgerBalanceHint } from './LedgerBalanceHint'
import { VoucherNumberField } from './VoucherNumberField'
import type { StockCondition, Voucher } from '@/types'
import { SubmissionLock } from '@/lib/submissionLock'

interface ReturnFormProps {
  type: 'Sales Return' | 'Purchase Return'
  open: boolean
  onClose: () => void
  voucher?: Voucher | null
}

interface ReturnLine extends ReturnItemInput {
  original_qty: number
  returned_qty: number
}

export function ReturnForm({ type, open, onClose, voucher }: ReturnFormProps) {
  const { company, vouchers, items, stock, accounts, accountCategories, parties, getPartyByAccountId, saveReturnVoucher, updateReturnVoucher } = useAppStore()
  const originalType = type === 'Sales Return' ? 'Sales' : 'Purchase'
  const isSalesReturn = type === 'Sales Return'
  const vatEnabled = company?.vat_enabled ?? true
  const [partyAccountId, setPartyAccountId] = useState('')
  const [originalId, setOriginalId] = useState('')
  const [dateBs, setDateBs] = useState(todayBs())
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
  const submissionLock = useRef(new SubmissionLock()).current
  const [error, setError] = useState('')
  const partyTriggerRef = useRef<HTMLButtonElement | null>(null)

  const emptyManualLine = useCallback((): ReturnLine => ({
    item_id: '', item_name: '', unit: '', entry_unit: '', conversion_factor: 1,
    qty: 0, rate: 0, cost_rate: 0, original_qty: 0, returned_qty: 0,
  }), [])

  const fiscalStart = selectedFiscalYearStartBs(company)
  const fiscalEndKey = makeBsKey(`${Number(fiscalStart.slice(0, 4)) + 1}-${fiscalStart.slice(5)}`)
  const originals = useMemo(() => vouchers
    .filter(entry => {
      const key = entry.date_bs_key || makeBsKey(entry.date_bs)
      const isEditingSource = !!voucher && entry.id === voucher.original_voucher_id
      return entry.type === originalType && !entry.cancelled && (entry.invoice_items?.length || 0) > 0 &&
        (isEditingSource || (key >= makeBsKey(fiscalStart) && key < fiscalEndKey)) &&
        (!partyAccountId || entry.party_account_id === partyAccountId)
    })
    .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq), [vouchers, originalType, voucher, fiscalStart, fiscalEndKey, partyAccountId])
  const original = originals.find(entry => entry.id === originalId)

  const makeLines = useCallback((source: Voucher, editing?: Voucher | null) => (source.invoice_items || []).map(line => {
    const existing = editing?.invoice_items?.find(item => item.source_invoice_item_id === line.id)
    const returned = line.id ? vouchers
      .filter(entry => entry.id !== voucher?.id && entry.type === type && !entry.cancelled && entry.original_voucher_id === source.id)
      .flatMap(entry => entry.invoice_items || [])
      .filter(item => item.source_invoice_item_id === line.id)
      .reduce((sum, item) => sum + item.qty, 0) : 0
    const derivedCostRate = source.type === 'Sales'
      ? inventoryIssueCost(items, vouchers, source.id, line.item_id, company?.inventory_valuation_method)?.rate
      : source.stock_lines?.find(stockLine => stockLine.item_id === line.item_id && stockLine.direction === 'in')?.rate
    return {
      id: existing?.id,
      source_invoice_item_id: line.id || '',
      item_id: line.item_id,
      item_name: line.item_name || items.find(item => item.id === line.item_id)?.name || line.item_id,
      unit: line.unit || items.find(item => item.id === line.item_id)?.unit || '',
      entry_unit: line.entry_unit || line.unit || items.find(item => item.id === line.item_id)?.unit || '',
      conversion_factor: line.conversion_factor || 1,
      base_qty: toBaseQty(existing?.qty || 0, line.conversion_factor || 1),
      qty: existing?.qty || 0,
      rate: line.rate,
      cost_rate: derivedCostRate ?? existing?.cost_rate ?? line.cost_rate ?? stock.find(entry => entry.id === line.item_id)?.avg_cost ?? 0,
      original_qty: line.qty,
      returned_qty: returned,
    }
  }), [company?.inventory_valuation_method, items, stock, type, voucher?.id, vouchers])

  useEffect(() => {
    if (!open) {
      setPartyAccountId(''); setOriginalId(''); setDateBs(todayBs()); setLines([emptyManualLine()]); setSettlementMode('party'); setSettlementAccountId(''); setStockCondition('saleable'); setManualVatRate(vatEnabled ? 13 : 0); setReason(''); setError('')
      return
    }
    if (voucher) {
      const source = vouchers.find(entry => entry.id === voucher.original_voucher_id)
      setPartyAccountId(voucher.party_account_id || source?.party_account_id || '')
      setOriginalId(voucher.original_voucher_id || '')
      setDateBs(voucher.date_bs)
      setSettlementMode(voucher.settlement_mode || (source?.party_account_id ? 'party' : 'cash'))
      setSettlementAccountId(legacySettlementAccountId(voucher) || (voucher.is_cash ? cashAccountId : defaultBankId))
      setStockCondition(voucher.stock_lines?.[0]?.stock_condition || (voucher.restock_items === false ? 'damaged' : 'saleable'))
      setManualVatRate(voucher.vat_rate || 0)
      setReason(voucher.return_reason || voucher.narration || '')
      if (source) setLines(makeLines(source, voucher))
      else setLines((voucher.invoice_items || []).map(line => ({ ...line, source_invoice_item_id: undefined, item_name: line.item_name || items.find(item => item.id === line.item_id)?.name || '', unit: line.unit || items.find(item => item.id === line.item_id)?.unit || '', entry_unit: line.entry_unit || line.unit, conversion_factor: line.conversion_factor || 1, cost_rate: line.cost_rate || stock.find(entry => entry.id === line.item_id)?.avg_cost || 0, original_qty: 0, returned_qty: 0 })))
    } else {
      setLines(current => current.length ? current : [emptyManualLine()])
    }
  }, [open, voucher, vouchers, makeLines, cashAccountId, defaultBankId, emptyManualLine, items, stock, vatEnabled])

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
      conversion_factor: 1, rate: 0, cost_rate: stock.find(entry => entry.id === itemId)?.avg_cost || selected?.opening_rate || 0,
    } : line))
  }

  const updateManualUnit = (index: number, mode: UnitMode) => setLines(current => current.map((line, row) => {
    if (row !== index) return line
    const item = items.find(entry => entry.id === line.item_id)
    const oldFactor = line.conversion_factor || 1
    const factor = unitFactor(item, mode)
    return { ...line, entry_unit: unitName(item, mode), unit: unitName(item, mode), conversion_factor: factor, rate: fromBaseRate(toBaseRate(line.rate, oldFactor), factor) }
  }))

  const selectedItems = lines.filter(line => line.qty > 0)
  const preview = selectedItems.length && (original || partyAccountId) ? buildReturnVoucherData({
    type, original, party_account_id: partyAccountId, vat_rate: manualVatRate, items: selectedItems, settlement_mode: settlementMode, settlement_account_id: settlementMode === 'party' ? partyAccountId : settlementAccountId,
    restock_items: true, stock_condition: stockCondition, system_accounts: { cash: 'cash', bank: 'bank', sales_return: 'sales_return', purchase_return: 'purchase_return', vat_payable: 'vat_payable', vat_receivable: 'vat_receivable' },
  }) : null

  const save = async () => {
    setError('')
    if (!original && !partyAccountId) return setError(`Select a ${partyTerminology(isSalesReturn ? 'customer' : 'supplier').singular}.`)
    if (!reason.trim()) return setError('Enter the reason for the return.')
    if (!selectedItems.length) return setError('Enter a quantity for at least one item.')
    for (const line of selectedItems) {
      if (!line.item_id || line.qty <= 0 || line.rate <= 0) return setError('Select an item and enter a positive quantity and rate for every return line.')
      if (original) {
        const remaining = round2(line.original_qty - line.returned_qty)
        if (line.qty > remaining + 0.0001) return setError(`${line.item_name} has only ${remaining} ${line.unit} remaining to return.`)
      }
    }
    if (settlementMode !== 'party' && !settlementAccountId) return setError('Select a settlement account.')
    const returnItems: ReturnItemInput[] = selectedItems.map(({ original_qty: _originalQty, returned_qty: _returnedQty, ...item }) => item)
    const params: ReturnSaveParams = { type, original_voucher_id: original?.id, party_account_id: original?.party_account_id || partyAccountId, vat_rate: original ? original.vat_rate : manualVatRate, items: returnItems, settlement_mode: settlementMode, settlement_account_id: settlementMode === 'party' ? (original?.party_account_id || partyAccountId) : settlementAccountId, restock_items: true, stock_condition: stockCondition, return_reason: reason.trim(), date_bs: dateBs }
    if (!submissionLock.tryAcquire()) return
    setSaving(true)
    try {
      if (voucher) await updateReturnVoucher(voucher.id, params)
      else await saveReturnVoucher(params)
      if (voucher) {
        onClose()
      } else {
        setPartyAccountId('')
        setOriginalId('')
        setDateBs(todayBs())
        setLines([emptyManualLine()])
        setSettlementMode('party')
        setSettlementAccountId('')
        setStockCondition('saleable')
        setManualVatRate(vatEnabled ? 13 : 0)
        setReason('')
        setError('')
        window.requestAnimationFrame(() => partyTriggerRef.current?.focus())
      }
    } catch (e: unknown) { setError((e as Error).message) } finally { submissionLock.release(); setSaving(false) }
  }

  const party = partyAccountId ? getPartyByAccountId(partyAccountId) : null
  const activeSettlementAccountId = settlementMode === 'party' ? partyAccountId : settlementAccountId
  const activeSettlementAccount = accounts.find(account => account.id === activeSettlementAccountId)
  const documentName = vatEnabled ? (isSalesReturn ? 'Credit Note' : 'Debit Note') : type

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="voucher-dialog max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{voucher ? 'Alter' : 'New'} {documentName}</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Return Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} /></div>
            <VoucherNumberField type={type} dateBs={dateBs} voucher={voucher} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>{partyTerminology(isSalesReturn ? 'customer' : 'supplier').singular}</Label><SearchableSelect triggerRef={partyTriggerRef} autoFocus={!voucher} value={partyAccountId} onValueChange={selectParty} disabled={!!voucher && !!original} placeholder={`Select ${partyTerminology(isSalesReturn ? 'customer' : 'supplier').singular}`} searchPlaceholder={`Search ${partyTerminology(isSalesReturn ? 'customer' : 'supplier').plural}...`} options={parties.filter(entry => entry.type === (isSalesReturn ? 'customer' : 'supplier') && (!entry.is_archived || entry.account_id === partyAccountId)).map(entry => ({ value: entry.account_id, label: entry.name, searchText: `${entry.phone || ''} ${entry.pan_vat || ''} ${entry.address || ''}`, disabled: !!entry.is_archived }))} /><LedgerBalanceHint account={accounts.find(account => account.id === partyAccountId)} party={party} /></div>
            <div className="space-y-1.5"><Label>{originalType === 'Sales' ? 'Sales Invoice' : 'Purchase Bill'} (optional)</Label><SearchableSelect value={originalId || '__manual__'} onValueChange={selectOriginal} disabled={!!voucher} placeholder="Manual return without bill" searchPlaceholder={`Search current fiscal year ${originalType.toLowerCase()} bills...`} options={[{ value: '__manual__', label: 'No bill — enter return manually' }, ...originals.map(entry => { const entryParty = entry.party_account_id ? getPartyByAccountId(entry.party_account_id)?.name : 'Cash'; return { value: entry.id, label: `${entry.invoice_no || entry.seq} | ${fmtDate(entry.date_bs)} | ${entryParty} | ${fmtMoney(entry.total)}`, searchText: `${entry.type} ${entry.date_bs} ${entryParty} ${entry.total}` } })]} /><p className="text-xs text-muted-foreground">Only bills from the current fiscal year are shown.</p></div>
          </div>

          {original && <div className="rounded-md border bg-muted/20 p-3 text-sm"><span className="font-medium">Original document:</span> {original.invoice_no || original.seq} | {party?.name || 'Cash'} | VAT {original.vat_rate || 0}% | Total {fmtMoney(original.total)}</div>}

          {original && <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Item</th><th className="report-th text-right">Original</th><th className="report-th text-right">Returned</th><th className="report-th text-right">Remaining</th><th className="report-th text-right">Return Qty</th><th className="report-th text-right">Rate</th><th className="report-th text-right">Amount</th></tr></thead><tbody>{lines.map((line, index) => { const remaining = round2(line.original_qty - line.returned_qty); return <tr key={line.source_invoice_item_id} className="border-t"><td className="report-td font-medium">{line.item_name}<span className="ml-1 text-xs text-muted-foreground">({line.unit})</span></td><td className="report-td text-right num">{line.original_qty}</td><td className="report-td text-right num">{line.returned_qty}</td><td className="report-td text-right num font-semibold">{remaining}</td><td className="report-td"><Input type="number" min="0" max={remaining} step="any" value={line.qty || ''} onChange={event => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, qty: Number(event.target.value) } : item))} className="ml-auto w-28 text-right" /></td><td className="report-td text-right num">{fmtMoney(line.rate)}</td><td className="report-td text-right num font-semibold">{fmtMoney(line.qty * line.rate)}</td></tr>})}</tbody></table></div>}

          {!original && <div className="space-y-2 overflow-x-auto rounded-md border p-2"><div className="grid min-w-[700px] grid-cols-[minmax(15rem,1fr)_7rem_8rem_9rem_10rem_2rem] gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><span>Item</span><span>Qty</span><span>Unit</span><span>Rate</span><span className="text-right">Amount</span><span /></div>{lines.map((line, index) => { const item = items.find(entry => entry.id === line.item_id); const mode: UnitMode = item?.alternate_unit && line.entry_unit === item.alternate_unit ? 'alternate' : 'main'; return <div key={index} className="grid min-w-[700px] grid-cols-[minmax(15rem,1fr)_7rem_8rem_9rem_10rem_2rem] items-center gap-2"><SearchableSelect value={line.item_id} onValueChange={value => updateManualItem(index, value)} placeholder="Select item..." searchPlaceholder="Search item, SKU or barcode..." options={items.filter(entry => !entry.is_archived).map(entry => ({ value: entry.id, label: entry.name, searchText: `${entry.sku || ''} ${entry.barcode || ''} ${entry.unit} ${entry.alternate_unit || ''}` }))} /><Input type="number" min="0" step="any" value={line.qty || ''} onChange={event => setLines(current => current.map((entry, row) => row === index ? { ...entry, qty: Number(event.target.value) } : entry))} placeholder="Qty" />{item?.alternate_unit ? <SearchableSelect value={mode} onValueChange={value => updateManualUnit(index, value as UnitMode)} options={[{ value: 'main', label: item.unit }, { value: 'alternate', label: item.alternate_unit }]} /> : <div className="flex h-8 items-center px-2 text-sm">{item?.unit || '—'}</div>}<Input type="number" min="0" step="any" value={line.rate || ''} onChange={event => setLines(current => current.map((entry, row) => row === index ? { ...entry, rate: Number(event.target.value) } : entry))} placeholder="Rate" /><div className="text-right num font-semibold">{fmtMoney(line.qty * line.rate)}</div><Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, row) => row !== index))}><Trash2 className="h-4 w-4" /></Button></div>})}<Button type="button" variant="outline" size="sm" onClick={() => setLines(current => [...current, emptyManualLine()])}><Plus className="mr-1 h-4 w-4" />Add item</Button></div>}

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
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving...' : `Save ${documentName}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
