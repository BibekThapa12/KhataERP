import type { Voucher } from '@/types'

type InvoiceAllocationLike = {
  invoice_voucher_id: string
  amount: string | number
}

type TransactionAllocationLike = {
  account_id: string
  invoice_allocations?: InvoiceAllocationLike[]
}

/**
 * Removes invoice links that PostgreSQL can no longer accept when a Receipt or
 * Payment is updated. The ledger amount is deliberately left unchanged, so a
 * removed link becomes an unapplied settlement rather than losing money.
 */
export function sanitizeSettlementAllocations<T extends TransactionAllocationLike>(
  allocations: T[],
  vouchers: Voucher[],
  companyId: string,
  settlementType: 'Receipt' | 'Payment',
) {
  const expectedInvoiceType = settlementType === 'Receipt' ? 'Sales' : 'Purchase'
  const eligibleInvoiceIds = new Set(vouchers.filter(voucher => (
    voucher.company_id === companyId
    && voucher.type === expectedInvoiceType
    && voucher.status === 'Completed'
    && !voucher.cancelled
  )).map(voucher => voucher.id))

  let removedCount = 0
  const sanitized = allocations.map(allocation => {
    const invoiceAllocations = (allocation.invoice_allocations || []).filter(row => {
      const valid = eligibleInvoiceIds.has(row.invoice_voucher_id)
      if (!valid) removedCount += 1
      return valid
    })
    return { ...allocation, invoice_allocations: invoiceAllocations }
  })

  return { allocations: sanitized, removedCount }
}
