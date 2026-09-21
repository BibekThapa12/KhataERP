import { describe, expect, it } from 'vitest'
import { invoiceRateFromAmount } from './engine'
import { applyInvoiceQuantityInput, releaseInvoicePricingLocks } from './invoiceLineEditing'

describe('invoice quantity editing', () => {
  it('keeps the current rate and releases a persisted amount when quantity changes', () => {
    const line = applyInvoiceQuantityInput({ qty: 2, rate: 50, amount_input: '100' }, '3')

    expect(line).toEqual({ qty: 3, rate: 50, amount_input: undefined })
    expect(line.qty * line.rate).toBe(150)
  })

  it('recalculates from the rate derived by a manual amount edit', () => {
    const rate = invoiceRateFromAmount(100, 2) ?? 0
    const line = applyInvoiceQuantityInput({ qty: 2, rate, amount_input: '100' }, 4)

    expect(line.rate).toBe(50)
    expect(line.amount_input).toBeUndefined()
    expect(line.qty * line.rate).toBe(200)
  })

  it('preserves pricing metadata while changing only quantity and amount authority', () => {
    const line = applyInvoiceQuantityInput({
      qty: 2,
      rate: 75,
      amount_input: '150',
      pricing_rule_id: 'rule-1',
      pricing_locked: true,
    }, 5)

    expect(line).toMatchObject({ qty: 5, rate: 75, pricing_rule_id: 'rule-1', pricing_locked: true })
    expect(line.amount_input).toBeUndefined()
  })

  it('releases every draft pricing lock so category quantities reprice together', () => {
    const lines = releaseInvoicePricingLocks([
      { item_id: 'a', pricing_locked: true, price_overridden: false },
      { item_id: 'b', pricing_locked: true, price_overridden: true },
      { item_id: 'c', pricing_locked: false, price_overridden: false },
    ])

    expect(lines.map(line => line.pricing_locked)).toEqual([false, false, false])
    expect(lines[1].price_overridden).toBe(true)
  })
})
