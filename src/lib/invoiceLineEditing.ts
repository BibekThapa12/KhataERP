export interface QuantityEditableInvoiceLine {
  qty: number
  amount_input?: string
}

export interface PricingLockableInvoiceLine {
  pricing_locked?: boolean
}

/**
 * Quantity is the authoritative input after it changes. Any previously stored
 * or manually entered amount must stop acting as an amount lock so the form
 * derives the new line amount from the unchanged rate.
 */
export function applyInvoiceQuantityInput<T extends QuantityEditableInvoiceLine>(line: T, value: string | number): T {
  return { ...line, qty: Number(value), amount_input: undefined }
}

/**
 * Slab qualification can depend on quantities from several invoice lines.
 * Releasing every lock ensures item and category rules are recalculated from
 * the complete invoice instead of mixing new quantities with stale snapshots.
 */
export function releaseInvoicePricingLocks<T extends PricingLockableInvoiceLine>(lines: T[]): T[] {
  return lines.map(line => line.pricing_locked ? { ...line, pricing_locked: false } : line)
}
