import type { Item, Voucher } from '@/types'
import { round6 } from '@/lib/engine'
import { toBaseQty } from '@/lib/units'

export interface DraftLoadoutRow {
  itemId: string
  itemName: string
  baseUnit: string
  alternateUnit?: string
  alternateConversion?: number
  totalQuantity: number
  totalAmount: number
}

export interface DraftLoadoutWarning {
  voucherId: string
  voucherLabel: string
  message: string
}

export interface DraftLoadoutSummary {
  draftCount: number
  rows: DraftLoadoutRow[]
  distinctItemCount: number
  grandTotalQuantity: number
  grandTotalAmount: number
  warnings: DraftLoadoutWarning[]
}

const quantityNumber = (value: number) => value.toLocaleString('en-NP', { maximumFractionDigits: 6 })

export function formatDraftLoadoutQuantity(row: DraftLoadoutRow) {
  if (!row.alternateUnit || !row.alternateConversion || row.alternateConversion <= 1) {
    return `${quantityNumber(row.totalQuantity)}${row.baseUnit ? ` ${row.baseUnit}` : ''}`
  }
  let whole = Math.floor(row.totalQuantity + 1e-9)
  let remainder = round6((row.totalQuantity - whole) * row.alternateConversion)
  const nearestRemainder = Math.round(remainder)
  if (Math.abs(remainder - nearestRemainder) < 0.01) remainder = nearestRemainder
  if (remainder >= row.alternateConversion) {
    whole += Math.floor(remainder / row.alternateConversion)
    remainder = round6(remainder % row.alternateConversion)
  }
  const parts: string[] = []
  if (whole > 0) parts.push(`${quantityNumber(whole)}${row.baseUnit ? ` ${row.baseUnit}` : ''}`)
  if (remainder > 0) parts.push(`${quantityNumber(remainder)} ${row.alternateUnit}`)
  return parts.join(' ') || `0${row.baseUnit ? ` ${row.baseUnit}` : ''}`
}

type DraftSalesLine = {
  item_id?: unknown
  qty?: unknown
  rate?: unknown
  amount?: unknown
  amount_input?: unknown
  conversion_factor?: unknown
}

function voucherLabel(voucher: Voucher) {
  return voucher.draft_no || voucher.invoice_no || `Draft ${voucher.seq}`
}

function authoritativeLineAmount(line: DraftSalesLine, qty: number) {
  const storedAmount = Number(line.amount)
  if (line.amount !== undefined && line.amount !== null && Number.isFinite(storedAmount)) return storedAmount
  const inputAmount = Number(line.amount_input)
  if (line.amount_input !== undefined && line.amount_input !== '' && Number.isFinite(inputAmount)) return inputAmount
  const rate = Number(line.rate)
  return Number.isFinite(rate) ? qty * rate : Number.NaN
}

export function buildDraftLoadoutSummary(companyId: string | undefined, vouchers: Voucher[], items: Item[]): DraftLoadoutSummary {
  const companyItems = new Map(items.filter(item => item.company_id === companyId).map(item => [item.id, item]))
  const grouped = new Map<string, DraftLoadoutRow>()
  const warnings: DraftLoadoutWarning[] = []
  let draftCount = 0

  for (const voucher of vouchers) {
    if (!companyId || voucher.company_id !== companyId || voucher.type !== 'Sales' || voucher.status !== 'Draft' || voucher.cancelled) continue
    const payload = voucher.draft_payload
    const lines = Array.isArray(payload?.lines) ? payload.lines as DraftSalesLine[] : null
    if (!lines) {
      warnings.push({ voucherId: voucher.id, voucherLabel: voucherLabel(voucher), message: 'Draft has no valid saved item lines.' })
      continue
    }
    draftCount += 1
    let includedLines = 0
    for (const line of lines) {
      const itemId = typeof line.item_id === 'string' ? line.item_id : ''
      const item = companyItems.get(itemId)
      const qty = Number(line.qty)
      const factor = Number(line.conversion_factor) > 0 ? Number(line.conversion_factor) : 1
      const amount = authoritativeLineAmount(line, qty)
      if (!item || item.is_service || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(amount) || amount < 0) continue
      const baseQty = toBaseQty(qty, factor)
      const current = grouped.get(item.id) || {
        itemId: item.id,
        itemName: item.name,
        baseUnit: item.unit || '',
        alternateUnit: item.alternate_unit || undefined,
        alternateConversion: Number(item.alternate_conversion) > 1 ? Number(item.alternate_conversion) : undefined,
        totalQuantity: 0,
        totalAmount: 0,
      }
      current.totalQuantity = round6(current.totalQuantity + baseQty)
      current.totalAmount = round6(current.totalAmount + amount)
      grouped.set(item.id, current)
      includedLines += 1
    }
    if (!includedLines && lines.length) {
      warnings.push({ voucherId: voucher.id, voucherLabel: voucherLabel(voucher), message: 'No loadable inventory lines were found in this draft.' })
    }
  }

  const rows = [...grouped.values()].sort((a, b) => a.itemName.localeCompare(b.itemName, undefined, { sensitivity: 'base' }))
  return {
    draftCount,
    rows,
    distinctItemCount: rows.length,
    grandTotalQuantity: round6(rows.reduce((sum, row) => sum + row.totalQuantity, 0)),
    grandTotalAmount: round6(rows.reduce((sum, row) => sum + row.totalAmount, 0)),
    warnings,
  }
}
