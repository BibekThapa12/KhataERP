import { describe, expect, it } from 'vitest'
import { repriceSalesLines } from '@/lib/pricing'
import type { Item, ItemCategory, PricingRule } from '@/types'

const categories: ItemCategory[] = [
  { id: 'root', company_id: 'c', name: 'Drinks', is_archived: false },
  { id: 'child', company_id: 'c', name: 'Soft Drinks', parent_category_id: 'root', is_archived: false },
]
const items: Item[] = [
  { id: 'a', company_id: 'c', name: 'Cola', unit: 'CS', alternate_unit: 'PCS', alternate_conversion: 24, sell_rate: 240, opening_qty: 0, opening_rate: 0, category_id: 'child' },
  { id: 'b', company_id: 'c', name: 'Fanta', unit: 'CS', alternate_unit: 'PCS', alternate_conversion: 12, sell_rate: 120, opening_qty: 0, opening_rate: 0, category_id: 'root' },
  { id: 'service', company_id: 'c', name: 'Delivery', unit: 'Job', sell_rate: 50, opening_qty: 0, opening_rate: 0, category_id: 'root', is_service: true },
]
const rule = (partial: Partial<PricingRule>): PricingRule => ({
  id: 'category-rule', company_id: 'c', name: 'Drinks deal', scope: 'CATEGORY', category_id: 'root', quantity_unit: 'PCS',
  effective_from_bs: '2083-01-01', effective_from_bs_key: 20830101, effective_until_bs: null, effective_until_bs_key: null,
  priority: 0, is_active: true, slabs: [{ id: 's10', pricing_rule_id: 'category-rule', min_quantity: 10, rate: 8 }], ...partial,
})

describe('Sales slab pricing', () => {
  it('applies the highest item threshold to duplicate lines', () => {
    const itemRule = rule({ id: 'item-rule', scope: 'ITEM', item_id: 'a', category_id: null, slabs: [
      { id: 's1', pricing_rule_id: 'item-rule', min_quantity: 1, rate: 230 },
      { id: 's10', pricing_rule_id: 'item-rule', min_quantity: 10, rate: 200 },
    ], quantity_unit: 'CS' })
    const below = repriceSalesLines({ lines: [{ key: '1', item_id: 'a', qty: 9, rate: 240 }], items, categories, rules: [itemRule], dateBs: '2083-05-01' })
    expect(below[0].rate).toBe(230)
    const combined = repriceSalesLines({ lines: [{ key: '1', item_id: 'a', qty: 5, rate: 240 }, { key: '2', item_id: 'a', qty: 5, rate: 240 }], items, categories, rules: [itemRule], dateBs: '2083-05-01' })
    expect(combined.map(line => line.rate)).toEqual([200, 200])
    const dropped = repriceSalesLines({ lines: [{ key: '1', item_id: 'a', qty: 0.5, rate: 240, pricing_rule_id: 'stale', calculated_rate: 200 } as never], items, categories, rules: [itemRule], dateBs: '2083-05-01' })
    expect(dropped[0].pricing_rule_id).toBeUndefined()
    expect(dropped[0].rate).toBe(240)
  })

  it('combines compatible descendant items in the category rule unit', () => {
    const result = repriceSalesLines({ lines: [
      { key: '1', item_id: 'a', qty: 5, rate: 240 },
      { key: '2', item_id: 'b', qty: 5, rate: 120 },
    ], items, categories, rules: [rule({})], dateBs: '2083-05-01' })
    expect(result[0].pricing_snapshot?.qualifying_quantity).toBe(180)
    expect(result[0].rate).toBe(192)
    expect(result[1].rate).toBe(96)
  })

  it('converts alternate entry quantities and rates', () => {
    const itemRule = rule({ id: 'item-rule', scope: 'ITEM', item_id: 'a', category_id: null, quantity_unit: 'PCS', slabs: [{ id: 's120', pricing_rule_id: 'item-rule', min_quantity: 120, rate: 7.5 }] })
    const result = repriceSalesLines({ lines: [{ key: '1', item_id: 'a', qty: 120, rate: 10, unit_mode: 'alternate', entry_unit: 'PCS', conversion_factor: 24 }], items, categories, rules: [itemRule], dateBs: '2083-05-01' })
    expect(result[0].pricing_snapshot?.qualifying_quantity).toBe(120)
    expect(result[0].rate).toBe(7.5)
  })

  it('keeps manual overrides but retains calculated qualification metadata', () => {
    const result = repriceSalesLines({ lines: [{ key: '1', item_id: 'a', qty: 1, rate: 999, price_overridden: true }], items, categories, rules: [rule({})], dateBs: '2083-05-01' })
    expect(result[0].rate).toBe(999)
    expect(result[0].calculated_rate).toBe(192)
    expect(result[0].pricing_snapshot?.price_overridden).toBe(true)
  })

  it('excludes services and prefers item rules over category qualification', () => {
    const itemRule = rule({ id: 'item-rule', scope: 'ITEM', item_id: 'a', category_id: null, quantity_unit: 'CS', slabs: [{ id: 's100', pricing_rule_id: 'item-rule', min_quantity: 100, rate: 1 }] })
    const result = repriceSalesLines({ lines: [
      { key: '1', item_id: 'a', qty: 5, rate: 240 },
      { key: '2', item_id: 'b', qty: 1, rate: 120 },
      { key: '3', item_id: 'service', qty: 100, rate: 50 },
    ], items, categories, rules: [itemRule, rule({ slabs: [{ id: 's50', pricing_rule_id: 'category-rule', min_quantity: 50, rate: 8 }] })], dateBs: '2083-05-01' })
    expect(result[0].pricing_rule_id).toBeUndefined()
    expect(result[1].pricing_rule_id).toBeUndefined()
    expect(result[2].pricing_rule_id).toBeUndefined()
  })

  it('resolves priority before category closeness', () => {
    const closest = rule({ id: 'closest', name: 'Closest', category_id: 'child', slabs: [{ id: 'close-slab', pricing_rule_id: 'closest', min_quantity: 1, rate: 9 }] })
    const higher = rule({ id: 'higher', name: 'Higher', priority: 10, slabs: [{ id: 'high-slab', pricing_rule_id: 'higher', min_quantity: 1, rate: 7 }] })
    const result = repriceSalesLines({ lines: [{ key: '1', item_id: 'a', qty: 1, rate: 240 }], items, categories, rules: [closest, higher], dateBs: '2083-05-01' })
    expect(result[0].pricing_rule_id).toBe('higher')
    expect(result[0].rate).toBe(168)
  })

  it('stays linear for a 100-line invoice and keeps six-decimal thresholds', () => {
    const lines = Array.from({ length: 100 }, (_, index) => ({ key: String(index), item_id: index % 2 ? 'a' : 'b', qty: 0.1, rate: 1 }))
    const result = repriceSalesLines({ lines, items, categories, rules: [rule({ slabs: [{ id: 'exact', pricing_rule_id: 'category-rule', min_quantity: 180, rate: 8 }] })], dateBs: '2083-05-01' })
    expect(result).toHaveLength(100)
    expect(result.every(line => line.pricing_slab_id === 'exact')).toBe(true)
  })
})
