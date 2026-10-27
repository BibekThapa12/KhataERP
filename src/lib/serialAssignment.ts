import { toBaseQty } from '@/lib/units'

export interface SerializedQuantityRequirement {
  baseQuantity: number
  requiredCount: number
  valid: boolean
  reason?: 'missing_quantity' | 'fractional_quantity'
}

export function serializedQuantityRequirement(quantity: number, conversionFactor: number): SerializedQuantityRequirement {
  const baseQuantity = toBaseQty(Number(quantity) || 0, Number(conversionFactor) || 1)
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) {
    return { baseQuantity, requiredCount: 0, valid: false, reason: 'missing_quantity' }
  }
  if (!Number.isInteger(baseQuantity)) {
    return { baseQuantity, requiredCount: 0, valid: false, reason: 'fractional_quantity' }
  }
  return { baseQuantity, requiredCount: baseQuantity, valid: true }
}

export function normalizedSerialKey(serial: string) {
  return serial.trim().toLocaleUpperCase()
}

export function duplicateSerialNumbers(serials: string[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const serial of serials) {
    const key = normalizedSerialKey(serial)
    if (!key) continue
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return duplicates
}

export function parseSerialNumberPaste(value: string) {
  return value
    .split(/[\r\n\t]+/)
    .map(serial => serial.trim())
    .filter(Boolean)
}
