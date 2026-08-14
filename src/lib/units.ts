import type { Item } from '@/types'

export type UnitMode = 'main' | 'alternate'

export function unitFactor(item: Item | undefined, mode: UnitMode) {
  return mode === 'alternate' && item?.alternate_unit && (item.alternate_conversion || 0) > 1
    ? Number(item.alternate_conversion)
    : 1
}

export function unitName(item: Item | undefined, mode: UnitMode) {
  return mode === 'alternate' && item?.alternate_unit ? item.alternate_unit : item?.unit || ''
}

export function toBaseQty(qty: number, factor: number) {
  return Math.round((qty / factor + Number.EPSILON) * 10000) / 10000
}

export function toBaseRate(rate: number, factor: number) {
  return Math.round((rate * factor + Number.EPSILON) * 1_000_000) / 1_000_000
}

export function fromBaseRate(rate: number, factor: number) {
  return Math.round((rate / factor + Number.EPSILON) * 1_000_000) / 1_000_000
}

const qtyText = (qty: number) => Number(qty.toFixed(4)).toLocaleString('en-NP', { maximumFractionDigits: 4 })
export const alternateQtyText = (qty: number) => Math.round(qty).toLocaleString('en-NP', { maximumFractionDigits: 0 })

export function formatStockQuantity(baseQty: number, item: Item) {
  const main = `${qtyText(baseQty)} ${item.unit}`
  const factor = Number(item.alternate_conversion || 0)
  if (!item.alternate_unit || factor <= 1 || baseQty < 0) return main
  return `${main} (${alternateQtyText(baseQty * factor)} ${item.alternate_unit})`
}
