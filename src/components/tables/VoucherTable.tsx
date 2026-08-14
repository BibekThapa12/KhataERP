import { useState } from 'react'
import { Edit2, Eye, Printer, XCircle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { logAppEvent } from '@/lib/supabase'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { InvoiceItem, Item, StockLine, Voucher, VoucherLine } from '@/types'
import { legacySettlementAccountId } from '@/lib/banks'
import { savedVoucherNumber } from '@/lib/voucherNumbers'

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))

const qtyText = (value: number) => Number(value.toFixed(2)).toLocaleString('en-NP', { maximumFractionDigits: 2 })

function invoicePrimaryQty(line: InvoiceItem, item?: Item) {
  const unit = line.entry_unit || line.unit || item?.unit || ''
  return `${qtyText(Number(line.qty) || 0)}${unit ? ` ${unit}` : ''}`
}

function invoiceAlternativeQty(line: InvoiceItem, item?: Item) {
  const factor = Number(item?.alternate_conversion || 0)
  if (!item?.alternate_unit || factor <= 1) return ''
  const entryUnit = (line.entry_unit || line.unit || item.unit || '').trim().toLowerCase()
  const alternateUnit = item.alternate_unit.trim().toLowerCase()
  if (entryUnit === alternateUnit || Number(line.conversion_factor || 1) > 1) {
    return `${qtyText((Number(line.qty) || 0) / factor)} ${item.unit}`
  }
  return `${qtyText((Number(line.qty) || 0) * factor)} ${item.alternate_unit}`
}

function voucherBadgeVariant(type: string, cancelled: boolean) {
  if (cancelled) return 'cancelled' as const
  const map: Record<string, 'sales' | 'purchase' | 'receipt' | 'payment' | 'journal'> = {
    Sales: 'sales', Purchase: 'purchase', 'Sales Return': 'sales', 'Purchase Return': 'purchase', Receipt: 'receipt', Payment: 'payment', Journal: 'journal',
  }
  return map[type] ?? 'default' as const
}

type DraftInvoicePayload = {
  lines?: Array<{ item_id: string; qty: number; rate: number; amount?: number; amount_input?: string; entry_unit?: string; conversion_factor?: number }>
  vatRate?: number
  discount?: number
  supplierInvoiceNo?: string
  creditDays?: number
}

type DraftReceiptPaymentPayload = {
  allocations?: Array<{ account_id: string; amount: string | number }>
  moneyAccountId?: string
}

type DraftJournalPayload = {
  jLines?: Array<{ account_id: string; debit: number; credit: number }>
}

type DraftStockPayload = {
  itemId?: string
  mode?: 'adjustment' | 'transfer'
  stockCondition?: string
  transferTo?: string
  qtyDelta?: string | number
  rate?: string | number
}

function draftPayload<T>(voucher: Voucher) {
  return voucher.status === 'Draft' ? voucher.draft_payload as T | null : null
}

function draftInvoiceItems(voucher: Voucher): InvoiceItem[] {
  if ((voucher.invoice_items || []).length) return voucher.invoice_items || []
  const draft = draftPayload<DraftInvoicePayload>(voucher)
  if (!draft?.lines?.length) return []
  return draft.lines.filter(line => line.item_id && Number(line.qty) > 0).map(line => ({
    item_id: line.item_id,
    qty: Number(line.qty) || 0,
    rate: Number(line.rate) || 0,
    amount: line.amount ?? (line.amount_input === undefined || line.amount_input === '' ? undefined : Number(line.amount_input)),
    entry_unit: line.entry_unit,
    conversion_factor: line.conversion_factor || 1,
  }))
}

function draftVoucherLines(voucher: Voucher): VoucherLine[] {
  if ((voucher.lines || []).length) return voucher.lines || []
  if (voucher.type === 'Receipt' || voucher.type === 'Payment') {
    const draft = draftPayload<DraftReceiptPaymentPayload>(voucher)
    if (!draft?.allocations?.length) return []
    return draft.allocations.filter(row => row.account_id && Number(row.amount) > 0).map(row => ({
      account_id: row.account_id,
      debit: voucher.type === 'Payment' ? Number(row.amount) || 0 : 0,
      credit: voucher.type === 'Receipt' ? Number(row.amount) || 0 : 0,
    }))
  }
  if (voucher.type === 'Journal') {
    const draft = draftPayload<DraftJournalPayload>(voucher)
    return (draft?.jLines || []).filter(row => row.account_id && (Number(row.debit) > 0 || Number(row.credit) > 0)).map(row => ({
      account_id: row.account_id,
      debit: Number(row.debit) || 0,
      credit: Number(row.credit) || 0,
    }))
  }
  return []
}

function draftStockLines(voucher: Voucher): StockLine[] {
  if ((voucher.stock_lines || []).length) return voucher.stock_lines || []
  const draft = draftPayload<DraftStockPayload>(voucher)
  if (!draft?.itemId) return []
  const qty = Math.abs(Number(draft.qtyDelta) || 0)
  const rate = Number(draft.rate) || 0
  if (draft.mode === 'transfer') {
    return [
      { item_id: draft.itemId, qty, rate, direction: 'out', stock_condition: 'saleable', is_transfer: true },
      { item_id: draft.itemId, qty, rate, direction: 'in', stock_condition: draft.transferTo === 'expired' ? 'expired' : 'damaged', is_transfer: true },
    ]
  }
  return [{ item_id: draft.itemId, qty, rate, direction: Number(draft.qtyDelta) < 0 ? 'out' : 'in', stock_condition: draft.stockCondition === 'expired' ? 'expired' : draft.stockCondition === 'damaged' ? 'damaged' : 'saleable' }]
}

export function VoucherDetail({ voucher }: { voucher: Voucher }) {
  const { company, vouchers, getAccount, getItem, getPartyByAccountId } = useAppStore()
  const vatEnabled = company?.vat_enabled ?? true
  const settlementId = legacySettlementAccountId(voucher) || draftPayload<DraftReceiptPaymentPayload>(voucher)?.moneyAccountId
  const invoiceItems = draftInvoiceItems(voucher)
  const ledgerLines = draftVoucherLines(voucher)
  const stockLines = draftStockLines(voucher)
  const invoiceDraft = draftPayload<DraftInvoicePayload>(voucher)
  const allocationNames = (voucher.type === 'Receipt' || voucher.type === 'Payment') ? ledgerLines.filter(line => line.account_id !== settlementId).map(line => getPartyByAccountId(line.account_id)?.name || getAccount(line.account_id)?.name || line.account_id) : []
  const allocationLabel = allocationNames.length ? `${allocationNames[0]}${allocationNames.length > 1 ? ` + ${allocationNames.length - 1} more` : ''}` : ''
  const partyName = allocationLabel || (voucher.party_account_id
    ? getPartyByAccountId(voucher.party_account_id)?.name ?? getAccount(voucher.party_account_id)?.name
    : getAccount(settlementId || '')?.name || (voucher.is_cash ? 'Cash' : '—'))
  const settlementName = getAccount(settlementId || '')?.name
  const subtotal = invoiceItems.length ? invoiceItems.reduce((sum, item) => sum + (item.amount ?? item.qty * item.rate), 0) : voucher.subtotal || 0
  const discount = invoiceDraft?.discount ?? voucher.discount ?? 0
  const vatRate = invoiceDraft?.vatRate ?? voucher.vat_rate ?? 0
  const vatAmount = invoiceItems.length ? Math.round(((subtotal - discount) * vatRate / 100 + Number.EPSILON) * 1_000_000) / 1_000_000 : voucher.vat_amount || 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Date</p><p className="font-medium mt-0.5">{fmtDate(voucher.date_bs)}</p></div>
        {voucher.type === 'Purchase' && (voucher.supplier_invoice_no || invoiceDraft?.supplierInvoiceNo) && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Supplier Invoice No.</p><p className="font-medium mt-0.5">{voucher.supplier_invoice_no || invoiceDraft?.supplierInvoiceNo}</p></div>}
        {(voucher.type === 'Sales' || voucher.type === 'Purchase') && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Credit Days</p><p className="font-medium mt-0.5">{invoiceDraft?.creditDays ?? voucher.credit_days ?? 0}</p></div>}
        {(voucher.type === 'Sales' || voucher.type === 'Purchase') && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Due Date</p><p className="font-medium mt-0.5">{fmtDate(voucher.due_date_bs || voucher.date_bs)}</p></div>}
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Party</p><p className="font-medium mt-0.5">{partyName}</p></div>
        {settlementName && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Settlement Account</p><p className="font-medium mt-0.5">{settlementName}</p></div>}
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Total</p><p className="font-serif font-bold mt-0.5 num">{fmtMoney(voucher.total)}</p></div>
      </div>

      {invoiceItems.length > 0 ? (
        <>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Item</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Qty</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Alt. Qty</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Rate</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoiceItems.map((it, i) => {
                const item = getItem(it.item_id)
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2">{it.item_name || item?.name || it.item_id}</td>
                    <td className="px-3 py-2 text-right num">{invoicePrimaryQty(it, item)}</td>
                    <td className="px-3 py-2 text-right num text-muted-foreground">{invoiceAlternativeQty(it, item)}</td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(it.rate)}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(it.amount ?? it.qty * it.rate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="text-sm space-y-1 pt-2 border-t border-border">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="num">{fmtMoney(subtotal)}</span></div>
            {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="num">- {fmtMoney(discount)}</span></div>}
            {vatEnabled && <div className="flex justify-between"><span className="text-muted-foreground">VAT ({vatRate}%)</span><span className="num">{fmtMoney(vatAmount)}</span></div>}
            <div className="flex justify-between border-t border-border pt-1 font-serif font-bold text-base"><span>Total</span><span className="num">{fmtMoney(voucher.total)}</span></div>
          </div>
        </>
      ) : stockLines.length > 0 ? (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Item</th>
              <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Movement</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Qty</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Rate</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {stockLines.map((line, i) => {
              const item = getItem(line.item_id)
              const movement = line.is_transfer ? `${line.direction === 'out' ? 'From' : 'To'} ${line.stock_condition || 'saleable'}` : `${line.direction === 'in' ? 'In' : 'Out'} ${line.stock_condition || 'saleable'}`
              return <tr key={i} className="border-t border-border"><td className="px-3 py-2">{item?.name || line.item_id}</td><td className="px-3 py-2">{movement}</td><td className="px-3 py-2 text-right num">{line.qty}</td><td className="px-3 py-2 text-right num">{fmtMoney(line.rate)}</td><td className="px-3 py-2 text-right num font-semibold">{line.is_transfer ? '-' : fmtMoney(line.qty * line.rate)}</td></tr>
            })}
          </tbody>
        </table>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Account</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Debit</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Credit</th>
            </tr>
          </thead>
          <tbody>
            {ledgerLines.map((l, i) => {
              const acc = getAccount(l.account_id)
              return (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2">{acc?.name ?? l.account_id}</td>
                  <td className="px-3 py-2 text-right num">{l.debit ? <span className="debit-amt">{fmtMoney(l.debit)}</span> : '—'}</td>
                  <td className="px-3 py-2 text-right num">{l.credit ? <span className="credit-amt">{fmtMoney(l.credit)}</span> : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {voucher.narration && (
        <p className="text-sm text-muted-foreground italic border-t border-border pt-2">
          Note: {voucher.narration}
        </p>
      )}
      {voucher.original_voucher_id && (
        <p className="text-sm text-muted-foreground border-t border-border pt-2">
          Original document: {vouchers.find(entry => entry.id === voucher.original_voucher_id)?.invoice_no || voucher.original_voucher_id}
        </p>
      )}
    </div>
  )
}

interface VoucherTableProps {
  vouchers: Voucher[]
  showActions?: boolean
  alwaysShowFilters?: boolean
  onEdit?: (voucher: Voucher) => void
}

export function VoucherTable({ vouchers, showActions = true, alwaysShowFilters = false, onEdit }: VoucherTableProps) {
  const cancelV = useAppStore(s => s.cancelV)
  const deleteDraftVoucher = useAppStore(s => s.deleteDraftVoucher)
  const company = useAppStore(s => s.company)
  const getAccount = useAppStore(s => s.getAccount)
  const getItem = useAppStore(s => s.getItem)
  const getPartyByAccountId = useAppStore(s => s.getPartyByAccountId)
  const allVouchers = useAppStore(s => s.vouchers)
  const [detail, setDetail] = useState<Voucher | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'Draft' | 'Completed'>('all')
  const [query, setQuery] = useState('')
  const journalTable = vouchers.length > 0 && vouchers.every(voucher => voucher.type === 'Journal')
  const showFilterBar = alwaysShowFilters || vouchers.length > 1
  const filteredVouchers = vouchers.filter(voucher => {
    const status = voucher.status === 'Draft' ? 'Draft' : 'Completed'
    if (statusFilter !== 'all' && status !== statusFilter) return false
    if (!query.trim()) return true
    const settlementId = legacySettlementAccountId(voucher) || draftPayload<DraftReceiptPaymentPayload>(voucher)?.moneyAccountId
    const party = voucher.party_account_id ? getPartyByAccountId(voucher.party_account_id)?.name : ''
    const accountNames = (voucher.lines || []).map(line => getPartyByAccountId(line.account_id)?.name || getAccount(line.account_id)?.name || '')
    const text = [savedVoucherNumber(voucher), voucher.invoice_no, voucher.draft_no, voucher.seq, voucher.type, voucher.date_bs, voucher.narration, party, settlementId ? getAccount(settlementId)?.name : '', voucher.total, status, ...accountNames].join(' ').toLowerCase()
    return text.includes(query.toLowerCase())
  })

  const printVoucher = (voucher: Voucher) => {
    const party = voucher.party_account_id
      ? getPartyByAccountId(voucher.party_account_id)
      : null
    const settlementId = legacySettlementAccountId(voucher)
    const settlementName = getAccount(settlementId || '')?.name
    const invoiceItems = draftInvoiceItems(voucher)
    const ledgerLines = draftVoucherLines(voucher)
    const stockLines = draftStockLines(voucher)
    const invoiceDraft = draftPayload<DraftInvoicePayload>(voucher)
    const allocationNames = (voucher.type === 'Receipt' || voucher.type === 'Payment') ? ledgerLines.filter(line => line.account_id !== settlementId).map(line => getPartyByAccountId(line.account_id)?.name || getAccount(line.account_id)?.name || line.account_id) : []
    const partyName = allocationNames.length ? allocationNames.join(', ') : party ? `${party.name}${settlementName ? ` / ${settlementName}` : ''}` : settlementName || (voucher.is_cash ? 'Cash' : '-')
    const invoiceRows = invoiceItems.map((it, index) => {
      const item = getItem(it.item_id)
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${esc(it.item_name || item?.name || it.item_id)}</td>
          <td class="right">${esc(invoicePrimaryQty(it, item))}</td>
          <td class="right muted">${esc(invoiceAlternativeQty(it, item))}</td>
          <td class="right">${esc(fmtMoney(it.rate))}</td>
          <td class="right">${esc(fmtMoney(it.amount ?? it.qty * it.rate))}</td>
        </tr>
      `
    }).join('')
    const ledgerRows = ledgerLines.map((line, index) => {
      const account = getAccount(line.account_id)
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${esc(account?.name || line.account_id)}</td>
          <td class="right">${line.debit ? esc(fmtMoney(line.debit)) : '-'}</td>
          <td class="right">${line.credit ? esc(fmtMoney(line.credit)) : '-'}</td>
        </tr>
      `
    }).join('')
    const stockRows = stockLines.map((line, index) => {
      const item = getItem(line.item_id)
      const movement = line.is_transfer ? `${line.direction === 'out' ? 'From' : 'To'} ${line.stock_condition || 'saleable'}` : `${line.direction === 'in' ? 'In' : 'Out'} ${line.stock_condition || 'saleable'}`
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${esc(item?.name || line.item_id)}</td>
          <td>${esc(movement)}</td>
          <td class="right">${esc(line.qty)}</td>
          <td class="right">${esc(fmtMoney(line.rate))}</td>
          <td class="right">${line.is_transfer ? '-' : esc(fmtMoney(line.qty * line.rate))}</td>
        </tr>
      `
    }).join('')
    const isInvoice = invoiceItems.length > 0
    const isStock = !isInvoice && stockLines.length > 0
    const vatEnabled = company?.vat_enabled ?? true
    const rows = isInvoice ? invoiceRows : isStock ? stockRows : ledgerRows
    const head = isInvoice
      ? '<tr><th class="col-no">#</th><th class="col-item">Item</th><th class="right col-qty">Qty</th><th class="right col-alt">Alt. Qty</th><th class="right col-rate">Rate</th><th class="right col-amount">Amount</th></tr>'
      : isStock
        ? '<tr><th>#</th><th>Item</th><th>Movement</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>'
        : '<tr><th>#</th><th>Account</th><th>Debit</th><th>Credit</th></tr>'
    const subtotal = invoiceItems.length ? invoiceItems.reduce((sum, item) => sum + (item.amount ?? item.qty * item.rate), 0) : voucher.subtotal || 0
    const discount = invoiceDraft?.discount ?? voucher.discount ?? 0
    const vatRate = invoiceDraft?.vatRate ?? voucher.vat_rate ?? 0
    const vatAmount = invoiceItems.length ? Math.round(((subtotal - discount) * vatRate / 100 + Number.EPSILON) * 1_000_000) / 1_000_000 : voucher.vat_amount || 0
    const totals = isInvoice ? `
      <div class="totals">
        <div><span>Subtotal</span><strong>${esc(fmtMoney(subtotal))}</strong></div>
        <div><span>Discount</span><strong>${esc(fmtMoney(discount))}</strong></div>
        ${vatEnabled ? `<div><span>VAT (${esc(vatRate)}%)</span><strong>${esc(fmtMoney(vatAmount))}</strong></div>` : ''}
        <div class="grand"><span>Total</span><strong>${esc(fmtMoney(voucher.total))}</strong></div>
      </div>
    ` : `
      <div class="totals">
        <div class="grand"><span>Total</span><strong>${esc(fmtMoney(voucher.total))}</strong></div>
      </div>
    `
    const printFormat = company?.print_format || 'A5'
    const originalVoucher = voucher.original_voucher_id ? allVouchers.find(entry => entry.id === voucher.original_voucher_id) : null
    const documentTitle = voucher.type === 'Sales Return' && vatEnabled
      ? 'Credit Note'
      : voucher.type === 'Purchase Return' && vatEnabled
        ? 'Debit Note'
        : voucher.type
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>${esc(documentTitle)} ${esc(savedVoucherNumber(voucher))}</title>
          <style>
            @page { size: ${esc(printFormat)}; margin: 10mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #111827; font-family: Arial, sans-serif; font-size: 11px; }
            .sheet { width: 100%; min-height: 190mm; padding: 0 1mm; }
            .invoice-head { display: grid; grid-template-columns: minmax(0,1fr) 50mm; gap: 8mm; align-items: start; border-top: 1.5px solid #111827; padding: 8mm 2mm 7mm; }
            h1 { margin: 0 0 5px; font-size: 24px; line-height: 1.05; letter-spacing: 0; }
            h2 { margin: 0 0 4px; font-size: 24px; line-height: 1; text-align: left; text-transform: uppercase; }
            p { margin: 3px 0; }
            .muted { color: #4b5563; }
            .company-lines { font-size: 12px; line-height: 1.35; }
            .meta { width: 44mm; margin-left: auto; text-align: left; }
            .meta-row { display: grid; grid-template-columns: 20mm 2mm 1fr; gap: 2mm; align-items: baseline; margin: 3px 0; }
            .meta-row strong { text-align: left; }
            .meta-row strong, .meta-row span { white-space: nowrap; }
            .party { margin: 0 0 4mm; display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
            .box { border: 1px solid #111827; padding: 4mm; min-height: 21mm; }
            .box-title { margin-bottom: 4mm; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; margin-top: 5px; }
            th, td { border: 1px solid #d1d5db; padding: 5px; vertical-align: top; }
            th { text-align: left; background: #f3f4f6; font-size: 10px; text-transform: uppercase; }
            .right { text-align: right; }
            .col-no { width: 7mm; }
            .col-item { width: auto; }
            .col-qty, .col-alt { width: 15mm; }
            .col-rate, .col-amount { width: 23mm; }
            .totals { margin-left: auto; margin-top: 8px; width: 55mm; }
            .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
            .totals .grand { border-top: 1px solid #111827; font-size: 13px; padding-top: 6px; }
            .note { margin-top: 12px; border-top: 1px solid #d1d5db; padding-top: 6px; }
            .signatures { margin-top: 22mm; display: flex; justify-content: space-between; gap: 24mm; }
            .signatures div { border-top: 1px solid #111827; flex: 1; text-align: center; padding-top: 4px; }
            @media print { .sheet { min-height: auto; } }
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="invoice-head">
              <div>
                ${company?.logo_url ? `<img src="${esc(company.logo_url)}" alt="Logo" referrerpolicy="no-referrer" style="max-height:40px;max-width:120px;margin-bottom:4px;" />` : ''}
                <h1>${esc(company?.name || 'KhataERP')}</h1>
                <div class="company-lines">
                  ${company?.address ? `<p>${esc(company.address)}</p>` : ''}
                  ${company?.phone ? `<p>Phone: ${esc(company.phone)}</p>` : ''}
                  ${company?.pan_vat ? `<p>PAN/VAT: ${esc(company.pan_vat)}</p>` : ''}
                </div>
              </div>
              <div class="meta">
                <h2>${esc(documentTitle)}</h2>
                <p class="meta-row"><strong>No.</strong><span>:</span><span>${esc(savedVoucherNumber(voucher))}</span></p>
                ${voucher.type === 'Purchase' && (voucher.supplier_invoice_no || invoiceDraft?.supplierInvoiceNo) ? `<p class="meta-row"><strong>Supplier No.</strong><span>:</span><span>${esc(voucher.supplier_invoice_no || invoiceDraft?.supplierInvoiceNo)}</span></p>` : ''}
                <p class="meta-row"><strong>Date</strong><span>:</span><span>${esc(fmtDate(voucher.date_bs))}</span></p>
                ${(voucher.type === 'Sales' || voucher.type === 'Purchase') ? `<p class="meta-row"><strong>Credit Days</strong><span>:</span><span>${esc(invoiceDraft?.creditDays ?? voucher.credit_days ?? 0)}</span></p><p class="meta-row"><strong>Due Date</strong><span>:</span><span>${esc(fmtDate(voucher.due_date_bs || voucher.date_bs))}</span></p>` : ''}
                ${originalVoucher ? `<p class="meta-row"><strong>Original</strong><span>:</span><span>${esc(originalVoucher.invoice_no || originalVoucher.seq)}</span></p><p class="meta-row"><strong>Orig. Date</strong><span>:</span><span>${esc(fmtDate(originalVoucher.date_bs))}</span></p>` : ''}
              </div>
            </section>
            <section class="party">
              <div class="box">
                <p class="box-title">Party Details</p>
                <p><strong>${esc(partyName)}</strong></p>
                <p>${esc(party?.address || '')}</p>
                <p>${party?.pan_vat ? `PAN/VAT: ${esc(party.pan_vat)}` : ''}</p>
              </div>
              <div class="box">
                <p class="box-title">Voucher Details</p>
                <p class="meta-row"><strong>Voucher Type</strong><span>:</span><span>${esc(voucher.type)}</span></p>
                <p class="meta-row"><strong>Status</strong><span>:</span><span>${voucher.cancelled ? 'Cancelled' : 'Active'}</span></p>
              </div>
            </section>
            <table>
              <thead>${head}</thead>
              <tbody>${rows}</tbody>
            </table>
            ${totals}
            ${voucher.return_reason ? `<p class="note"><strong>Return reason:</strong> ${esc(voucher.return_reason)}</p>` : voucher.narration ? `<p class="note"><strong>Note:</strong> ${esc(voucher.narration)}</p>` : ''}
            ${company?.invoice_terms ? `<p class="note"><strong>Terms:</strong> ${esc(company.invoice_terms)}</p>` : ''}
            ${company?.payment_qr_text ? `<p class="note"><strong>Payment:</strong> ${esc(company.payment_qr_text)}</p>` : ''}
            <section class="signatures">
              <div>Prepared By</div>
              <div>Received By</div>
            </section>
          </main>
        </body>
      </html>
    `
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    logAppEvent('print_voucher', company?.id, { type: voucher.type, print_format: company?.print_format || 'A5' })
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  if (!alwaysShowFilters && vouchers.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-3xl mb-3 opacity-30">◇</p>
        <p className="font-medium text-foreground">No transactions yet</p>
        <p className="text-sm mt-1">Transactions will appear here once added.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        {showFilterBar && <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search voucher, party, date, user, amount..." className="h-9 w-full sm:w-80" />
          {(['all', 'Draft', 'Completed'] as const).map(status => (
            <Button key={status} type="button" size="sm" variant={statusFilter === status ? 'default' : 'outline'} onClick={() => setStatusFilter(status)}>
              {status === 'all' ? 'All' : status}
            </Button>
          ))}
        </div>}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Date</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">{journalTable ? 'Invoice No.' : 'Type'}</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">{journalTable ? 'Party / Account' : 'Ref / Party'}</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5 hidden md:table-cell">Narration</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Status</th>
              <th className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Amount</th>
              {showActions && <th className="px-4 py-2.5 w-36"></th>}
            </tr>
          </thead>
          <tbody>
            {filteredVouchers.map(v => {
              const settlementId = legacySettlementAccountId(v)
              const allocationNames = (v.type === 'Receipt' || v.type === 'Payment') ? (v.lines || []).filter(line => line.account_id !== settlementId).map(line => getPartyByAccountId(line.account_id)?.name || getAccount(line.account_id)?.name || line.account_id) : []
              const partyName = allocationNames.length ? `${allocationNames[0]}${allocationNames.length > 1 ? ` + ${allocationNames.length - 1} more` : ''}` : v.party_account_id
                ? getPartyByAccountId(v.party_account_id)?.name ?? '—'
                : getAccount(legacySettlementAccountId(v) || '')?.name || (v.is_cash ? 'Cash' : '—')
              const settlementName = getAccount(legacySettlementAccountId(v) || '')?.name
              const journalAccounts = v.type === 'Journal' ? [...new Set((v.lines || []).map(line => getPartyByAccountId(line.account_id)?.name || getAccount(line.account_id)?.name || line.account_id))] : []
              const journalAccountLabel = journalAccounts.join(', ') || '—'
              return (
                <tr key={v.id} className={`border-t border-border hover:bg-muted/30 transition-colors ${v.cancelled ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{fmtDate(v.date_bs)}</td>
                  {journalTable ? <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">{savedVoucherNumber(v)}</td> : <td className="px-4 py-3"><Badge variant={voucherBadgeVariant(v.type, v.cancelled)}>{v.type}</Badge></td>}
                  <td className="px-4 py-3">
                    {journalTable ? <span className="font-medium" title={journalAccountLabel}>{journalAccountLabel}</span> : <><span className="text-xs text-muted-foreground block num">{savedVoucherNumber(v)}</span><span className="font-medium">{partyName}</span>{(v.type === 'Receipt' || v.type === 'Payment') && settlementName && <span className="block text-xs text-muted-foreground">via {settlementName}</span>}</>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-[200px] truncate">{v.narration}</td>
                  <td className="px-4 py-3"><Badge variant={v.status === 'Draft' ? 'secondary' : 'sales'} className={v.status === 'Draft' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}>{v.status === 'Draft' ? 'Draft' : 'Completed'}</Badge></td>
                  <td className="px-4 py-3 text-right num font-semibold">{fmtMoney(v.total)}</td>
                  {showActions && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetail(v)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => printVoucher(v)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        {!v.cancelled && (
                          <>
                            {onEdit && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(v)}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {v.status === 'Draft' ? (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This permanently removes <strong>{v.type} {savedVoucherNumber(v)}</strong>. It has not affected ledgers, stock, or reports.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      onClick={async () => { setCancelling(true); await deleteDraftVoucher(v.id); setCancelling(false) }}
                                      disabled={cancelling}
                                    >
                                      Delete Draft
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            ) : <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                                  <XCircle className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Cancel this voucher?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will reverse <strong>{v.type} {savedVoucherNumber(v)}</strong> dated {fmtDate(v.date_bs)} for {fmtMoney(v.total)}.
                                    All affected balances and stock will be reversed. The voucher stays in history marked cancelled.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={async () => { setCancelling(true); await cancelV(v.id); setCancelling(false) }}
                                    disabled={cancelling}
                                  >
                                    Cancel voucher
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>}
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {filteredVouchers.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{vouchers.length === 0 ? 'No transactions yet. Transactions will appear here once added.' : 'No vouchers match this filter.'}</div>}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail ? `${detail.type} · ${savedVoucherNumber(detail)}` : ''}
            </DialogTitle>
          </DialogHeader>
          {detail && <VoucherDetail voucher={detail} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
