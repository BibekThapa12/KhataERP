import type { CompanyModule, Item, Voucher } from '@/types'
import { buildSalesVoucherData, round6 } from '@/lib/engine'
import { formatStockQuantity } from '@/lib/units'
import { makeBsKey } from '@/lib/nepaliDate'

export const POS_MODULE_KEY = 'pos_counter'

// shortcut: duplicates chequeEntitlement's write rule; extract a shared moduleEntitlement(key) if a third module appears
export function posModuleAccess(entitlement?: CompanyModule | null, today = new Date().toISOString().slice(0, 10)): { enabled: boolean; reason: string } {
  if (!entitlement?.is_enabled || entitlement.module?.key !== POS_MODULE_KEY || entitlement.module?.is_active === false) return { enabled: false, reason: 'POS Counter is not enabled for this company.' }
  if (entitlement.starts_at && entitlement.starts_at > today) return { enabled: false, reason: 'The module start date has not arrived.' }
  if (entitlement.expires_at && entitlement.expires_at < today) return { enabled: false, reason: 'The module has expired.' }
  if (entitlement.payment_status === 'cancelled') return { enabled: false, reason: 'Module payment is cancelled.' }
  const paid = entitlement.status === 'trial' || entitlement.billing_type === 'included' || ['paid', 'waived'].includes(entitlement.payment_status)
  if (!['active', 'trial'].includes(entitlement.status) || !paid) return { enabled: false, reason: 'The module is disabled.' }
  return { enabled: true, reason: '' }
}

/** One cart row. `shelf_rate` is the VAT-inclusive price per main unit. */
export interface PosLine { item_id: string; name: string; qty: number; shelf_rate: number }
export type PosAddResult = { ok: true; lines: PosLine[] } | { ok: false; error: string }

const sameCode = (value: string | undefined, code: string) => !!value && value.trim().toLocaleLowerCase() === code

export function findPosItemByCode(items: Item[], code: string): Item | undefined {
  const wanted = code.trim().toLocaleLowerCase()
  if (!wanted) return undefined
  const active = items.filter(item => !item.is_archived)
  return active.find(item => sameCode(item.barcode, wanted)) || active.find(item => sameCode(item.sku, wanted))
}

function checkLine(item: Item, qty: number, availableQty: (itemId: string) => number): string | null {
  if (item.is_archived) return `${item.name} is inactive`
  if (item.is_serialized) return 'Sell serialized items from the Sales Invoice'
  if (item.is_service) return null
  const available = availableQty(item.id)
  // Same wording as the Sales Invoice stock block (InvoiceForm).
  if (available < qty) return `Not enough stock for "${item.name}": have ${formatStockQuantity(available, item)}, selling ${qty} ${item.unit}.`
  return null
}

export function addPosItem(lines: PosLine[], item: Item, availableQty: (itemId: string) => number, qty = 1): PosAddResult {
  const existing = lines.find(line => line.item_id === item.id)
  const nextQty = round6((existing?.qty || 0) + qty)
  const error = checkLine(item, nextQty, availableQty)
  if (error) return { ok: false, error }
  if (existing) return { ok: true, lines: lines.map(line => line.item_id === item.id ? { ...line, qty: nextQty } : line) }
  return { ok: true, lines: [...lines, { item_id: item.id, name: item.name, qty: nextQty, shelf_rate: Number(item.sell_rate) || 0 }] }
}

export function setPosLineQty(lines: PosLine[], itemId: string, qty: number, item: Item, availableQty: (itemId: string) => number): PosAddResult {
  if (!(qty > 0)) return { ok: true, lines: lines.filter(line => line.item_id !== itemId) }
  const error = checkLine(item, qty, availableQty)
  if (error) return { ok: false, error }
  return { ok: true, lines: lines.map(line => line.item_id === itemId ? { ...line, qty: round6(qty) } : line) }
}

const exclusive = (amount: number, vatRate: number) => vatRate > 0 ? round6(amount / (1 + vatRate / 100)) : amount

export function toInvoiceItems(lines: PosLine[], vatRate: number) {
  return lines.map(line => ({ item_id: line.item_id, qty: line.qty, rate: exclusive(line.shelf_rate, vatRate) }))
}

export function exclusiveDiscount(discount: number, vatRate: number) {
  return exclusive(Math.max(0, discount || 0), vatRate)
}

const paisa = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100

/** Cash tendered check against the total the cashier sees (rounded to paisa); an empty box means exact. */
export function checkTendered(text: string, total: number): { tendered?: number; change?: number; error?: string } {
  const due = paisa(total)
  if (!text.trim()) return { change: 0 }
  const tendered = Number(text)
  if (!Number.isFinite(tendered) || tendered < due) return { error: 'Tendered is less than the total' }
  // shortcut: catches a barcode scanned into the tendered box by size alone; replace with scanner-burst detection if real tenders reach Rs 1 lakh over the bill
  if (tendered - due >= 100_000) return { error: 'That amount looks like a barcode. Check the tendered amount.' }
  return { tendered, change: paisa(tendered - due) }
}

/** Quantity typed into a cart row, or null while it is empty, zero or half-typed (e.g. "0." on the way to "0.5"). */
export function qtyFromInput(text: string): number | null {
  if (!/^\d*\.?\d+$/.test(text.trim())) return null
  const qty = Number(text)
  return qty > 0 ? qty : null
}

/** POS bills are always dated today; never back-dated into another fiscal year selected in the ERP. */
export function posBillDate(todayBs: string, fiscalYearStartBs: string): { dateBs?: string; error?: string } {
  const nextStart = `${Number(fiscalYearStartBs.slice(0, 4)) + 1}-${fiscalYearStartBs.slice(5)}`
  const key = makeBsKey(todayBs)
  if (key >= makeBsKey(fiscalYearStartBs) && key < makeBsKey(nextStart)) return { dateBs: todayBs }
  return { error: 'Today is outside the fiscal year selected in KhataERP. Switch to the current fiscal year first.' }
}

// POS bills are marked by their note; a walk-in customer's name rides along ("POS · Ram Sharma") since cash sales have no party.
const POS_NOTE = 'POS'
const POS_NAME_SEPARATOR = ' · '
const isPosNarration = (narration?: string) => narration === POS_NOTE || !!narration?.startsWith(POS_NOTE + POS_NAME_SEPARATOR)

export function posNarration(customerName: string): string {
  const name = customerName.trim().replace(/\s+/g, ' ').slice(0, 80)
  return name ? POS_NOTE + POS_NAME_SEPARATOR + name : POS_NOTE
}

export function posCustomerName(narration?: string): string | undefined {
  return narration?.startsWith(POS_NOTE + POS_NAME_SEPARATOR) ? narration.slice(POS_NOTE.length + POS_NAME_SEPARATOR.length) || undefined : undefined
}

/** Completed POS bills (cancelled ones too) dated `dateBs`, newest first. */
export function recentPosBills(vouchers: Voucher[], dateBs: string, limit = 10): Voucher[] {
  return vouchers
    .filter(voucher => voucher.type === 'Sales' && voucher.status !== 'Draft' && isPosNarration(voucher.narration) && voucher.date_bs === dateBs)
    .sort((a, b) => (b.seq || 0) - (a.seq || 0))
    .slice(0, limit)
}

/** Receipt lines for a saved bill: exclusive rates are turned back into the shelf prices the customer saw. */
export function receiptLinesFromVoucher(voucher: Voucher, itemName: (itemId: string) => string) {
  const factor = 1 + (Number(voucher.vat_rate) || 0) / 100
  return (voucher.invoice_items || []).map(entry => ({ name: entry.item_name || itemName(entry.item_id), qty: entry.qty, shelf_rate: paisa(entry.rate * factor) }))
}

/** Totals computed by the same builder that posts the voucher, so the cart and the saved bill can't disagree. */
export function posTotals(lines: PosLine[], discount: number, vatRate: number) {
  const shelfTotal = round6(lines.reduce((sum, line) => sum + round6(line.qty * line.shelf_rate), 0))
  const data = buildSalesVoucherData({ party_account_id: null, is_cash: true, items: toInvoiceItems(lines, vatRate), discount: exclusiveDiscount(discount, vatRate), vat_rate: vatRate })
  return { shelfTotal, subtotal: data.subtotal, discount: data.discount, taxable: round6(data.subtotal - data.discount), vat: data.vat_amount, total: data.total }
}
