import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore, type ReturnSaveParams } from '@/store/useAppStore'
import { buildReturnVoucherData, round2, type ReturnItemInput } from '@/lib/engine'
import { todayBs } from '@/lib/nepaliDate'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { partyTerminology } from '@/lib/partyTerminology'
import { resolveSystemAccountId } from '@/lib/engine'
import { bankAccounts, legacySettlementAccountId } from '@/lib/banks'
import { toBaseQty } from '@/lib/units'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Voucher } from '@/types'

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
  const { company, vouchers, items, stock, accounts, accountCategories, getPartyByAccountId, saveReturnVoucher, updateReturnVoucher } = useAppStore()
  const originalType = type === 'Sales Return' ? 'Sales' : 'Purchase'
  const isSalesReturn = type === 'Sales Return'
  const vatEnabled = company?.vat_enabled ?? true
  const [originalId, setOriginalId] = useState('')
  const [dateBs, setDateBs] = useState(todayBs())
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [settlementMode, setSettlementMode] = useState<'party' | 'cash' | 'bank'>('party')
  const cashAccountId = company ? resolveSystemAccountId(accounts, company.id, 'cash') : ''
  const banks = bankAccounts(accounts, accountCategories, !!voucher)
  const defaultBankId = banks[0]?.id || ''
  const [settlementAccountId, setSettlementAccountId] = useState('')
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const originals = useMemo(() => vouchers
    .filter(entry => entry.type === originalType && !entry.cancelled && (entry.invoice_items?.length || 0) > 0)
    .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq), [vouchers, originalType])
  const original = originals.find(entry => entry.id === originalId)

  const makeLines = useCallback((source: Voucher, editing?: Voucher | null) => (source.invoice_items || []).map(line => {
    const existing = editing?.invoice_items?.find(item => item.source_invoice_item_id === line.id)
    const returned = line.id ? vouchers
      .filter(entry => entry.id !== voucher?.id && entry.type === type && !entry.cancelled && entry.original_voucher_id === source.id)
      .flatMap(entry => entry.invoice_items || [])
      .filter(item => item.source_invoice_item_id === line.id)
      .reduce((sum, item) => sum + item.qty, 0) : 0
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
      cost_rate: existing?.cost_rate ?? line.cost_rate ?? stock.find(entry => entry.id === line.item_id)?.avg_cost ?? 0,
      original_qty: line.qty,
      returned_qty: returned,
    }
  }), [items, stock, type, voucher?.id, vouchers])

  useEffect(() => {
    if (!open) {
      setOriginalId(''); setDateBs(todayBs()); setLines([]); setSettlementMode('party'); setSettlementAccountId(''); setRestock(true); setReason(''); setError('')
      return
    }
    if (voucher) {
      const source = vouchers.find(entry => entry.id === voucher.original_voucher_id)
      setOriginalId(voucher.original_voucher_id || '')
      setDateBs(voucher.date_bs)
      setSettlementMode(voucher.settlement_mode || (source?.party_account_id ? 'party' : 'cash'))
      setSettlementAccountId(legacySettlementAccountId(voucher) || (voucher.is_cash ? cashAccountId : defaultBankId))
      setRestock(voucher.restock_items !== false)
      setReason(voucher.return_reason || voucher.narration || '')
      if (source) setLines(makeLines(source, voucher))
    }
  }, [open, voucher, vouchers, makeLines, cashAccountId, defaultBankId])

  const selectOriginal = (id: string) => {
    const source = originals.find(entry => entry.id === id)
    setOriginalId(id)
    if (!source) return setLines([])
    setSettlementMode(source.party_account_id ? 'party' : 'cash')
    setSettlementAccountId(cashAccountId)
    setLines(makeLines(source))
  }

  const selectedItems = lines.filter(line => line.qty > 0)
  const preview = original && selectedItems.length ? buildReturnVoucherData({
    type, original, items: selectedItems, settlement_mode: settlementMode, settlement_account_id: settlementMode === 'party' ? original.party_account_id : settlementAccountId,
    restock_items: restock, system_accounts: { cash: 'cash', bank: 'bank', sales_return: 'sales_return', purchase_return: 'purchase_return', vat_payable: 'vat_payable', vat_receivable: 'vat_receivable' },
  }) : null

  const save = async () => {
    setError('')
    if (!original) return setError(`Select an original ${originalType.toLowerCase()} voucher.`)
    if (!reason.trim()) return setError('Enter the reason for the return.')
    if (!selectedItems.length) return setError('Enter a quantity for at least one item.')
    for (const line of selectedItems) {
      const remaining = round2(line.original_qty - line.returned_qty)
      if (line.qty > remaining + 0.0001) return setError(`${line.item_name} has only ${remaining} ${line.unit} remaining to return.`)
    }
    if (settlementMode !== 'party' && !settlementAccountId) return setError('Select a settlement account.')
    const params: ReturnSaveParams = { type, original_voucher_id: original.id, items: selectedItems, settlement_mode: settlementMode, settlement_account_id: settlementMode === 'party' ? original.party_account_id : settlementAccountId, restock_items: restock, return_reason: reason.trim(), date_bs: dateBs }
    setSaving(true)
    try {
      if (voucher) await updateReturnVoucher(voucher.id, params)
      else await saveReturnVoucher(params)
      onClose()
    } catch (e: unknown) { setError((e as Error).message) } finally { setSaving(false) }
  }

  const party = original?.party_account_id ? getPartyByAccountId(original.party_account_id) : null
  const documentName = vatEnabled ? (isSalesReturn ? 'Credit Note' : 'Debit Note') : type

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{voucher ? 'Alter' : 'New'} {documentName}</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Return Date</Label><NepaliDateInput value={dateBs} onChange={setDateBs} /></div>
            <div className="space-y-1.5"><Label>Original {originalType === 'Sales' ? 'Sales Invoice' : 'Purchase Bill'}</Label><SearchableSelect value={originalId} onValueChange={selectOriginal} disabled={!!voucher} placeholder={`Select original ${originalType.toLowerCase()}`} options={originals.map(entry => { const party = entry.party_account_id ? getPartyByAccountId(entry.party_account_id)?.name : 'Cash'; return { value: entry.id, label: `${entry.invoice_no || entry.seq} | ${fmtDate(entry.date_bs)} | ${party} | ${fmtMoney(entry.total)}`, searchText: `${entry.type} ${entry.date_bs} ${party} ${entry.total}` } })} /></div>
          </div>

          {original && <div className="rounded-md border bg-muted/20 p-3 text-sm"><span className="font-medium">Original document:</span> {original.invoice_no || original.seq} | {party?.name || 'Cash'} | VAT {original.vat_rate || 0}% | Total {fmtMoney(original.total)}</div>}

          {original && <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-muted/50"><th className="report-th text-left">Item</th><th className="report-th text-right">Original</th><th className="report-th text-right">Returned</th><th className="report-th text-right">Remaining</th><th className="report-th text-right">Return Qty</th><th className="report-th text-right">Rate</th><th className="report-th text-right">Amount</th></tr></thead><tbody>{lines.map((line, index) => { const remaining = round2(line.original_qty - line.returned_qty); return <tr key={line.source_invoice_item_id} className="border-t"><td className="report-td font-medium">{line.item_name}<span className="ml-1 text-xs text-muted-foreground">({line.unit})</span></td><td className="report-td text-right num">{line.original_qty}</td><td className="report-td text-right num">{line.returned_qty}</td><td className="report-td text-right num font-semibold">{remaining}</td><td className="report-td"><Input type="number" min="0" max={remaining} step="any" value={line.qty || ''} onChange={event => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, qty: Number(event.target.value) } : item))} className="ml-auto w-28 text-right" /></td><td className="report-td text-right num">{fmtMoney(line.rate)}</td><td className="report-td text-right num font-semibold">{fmtMoney(line.qty * line.rate)}</td></tr>})}</tbody></table></div>}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Settlement</Label><SearchableSelect value={settlementMode} onValueChange={value => { const mode = value as 'party' | 'cash' | 'bank'; setSettlementMode(mode); if (mode === 'cash') setSettlementAccountId(cashAccountId); if (mode === 'bank') setSettlementAccountId(defaultBankId) }} options={[...(original?.party_account_id ? [{ value: 'party', label: `Adjust ${partyTerminology(isSalesReturn ? 'customer' : 'supplier').singular} balance` }] : []), { value: 'cash', label: `Cash ${isSalesReturn ? 'refund' : 'received'}` }, { value: 'bank', label: `Bank account ${isSalesReturn ? 'refund' : 'received'}` }]} />{settlementMode === 'bank' && <SearchableSelect value={settlementAccountId} onValueChange={setSettlementAccountId} placeholder="Select bank account" options={banks.map(account => ({ value: account.id, label: account.name, searchText: `${account.name} Bank`, disabled: !!account.is_archived }))} />}</div>
            {isSalesReturn && <div className="space-y-1.5"><Label>Returned Stock</Label><SearchableSelect value={restock ? 'restock' : 'damaged'} onValueChange={value => setRestock(value === 'restock')} options={[{ value: 'restock', label: 'Return to sellable stock' }, { value: 'damaged', label: 'Damaged - do not restock' }]} /></div>}
          </div>

          <div className="space-y-1.5"><Label>Return Reason</Label><Textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} placeholder="Damaged goods, wrong item, sundry debtor return..." /></div>

          {preview && <div className="ml-auto w-full max-w-sm space-y-1.5 rounded-md bg-muted/40 p-4 text-sm"><div className="flex justify-between"><span>Gross Return</span><span className="num">{fmtMoney(preview.subtotal)}</span></div><div className="flex justify-between"><span>Allocated Discount</span><span className="num">- {fmtMoney(preview.discount)}</span></div>{vatEnabled && <div className="flex justify-between"><span>VAT Reversal ({preview.vat_rate}%)</span><span className="num">{fmtMoney(preview.vat_amount)}</span></div>}<div className="flex justify-between border-t pt-2 font-serif text-base font-bold"><span>Return Total</span><span className="num">{fmtMoney(preview.total)}</span></div></div>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving || !original}>{saving ? 'Saving...' : `Save ${documentName}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
