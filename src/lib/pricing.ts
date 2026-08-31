import type { Item, ItemCategory, PricingRule, PricingRuleSlab, PricingSnapshot } from '@/types'
import { makeBsKey } from '@/lib/nepaliDate'
import { fromBaseRate, toBaseQty, toBaseRate, unitFactor } from '@/lib/units'

export interface SalesPricingLine {
  key: string
  item_id: string
  qty: number
  rate: number
  unit_mode?: 'main' | 'alternate'
  entry_unit?: string
  conversion_factor?: number
  price_overridden?: boolean
}

export interface PricedSalesLine extends SalesPricingLine {
  calculated_rate?: number
  pricing_rule_id?: string
  pricing_slab_id?: string
  pricing_snapshot?: PricingSnapshot
  pricing_warning?: string
}

const round6 = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
const normalizedUnit = (value?: string | null) => (value || '').trim().toLocaleLowerCase()
const withoutCalculatedPricing = (line: SalesPricingLine): PricedSalesLine => {
  const source = line as SalesPricingLine & Partial<PricedSalesLine>
  const { calculated_rate: _calculated, pricing_rule_id: _rule, pricing_slab_id: _slab, pricing_snapshot: _snapshot, pricing_warning: _warning, ...plain } = source
  return plain
}

function categoryPath(categoryId: string | undefined, categories: ItemCategory[]) {
  const byId = new Map(categories.map(category => [category.id, category]))
  const path: string[] = []
  const seen = new Set<string>()
  let current = categoryId
  while (current && !seen.has(current)) {
    seen.add(current)
    path.push(current)
    current = byId.get(current)?.parent_category_id || undefined
  }
  return path
}

function isEffective(rule: PricingRule, dateKey: number) {
  return rule.is_active && rule.effective_from_bs_key <= dateKey && (rule.effective_until_bs_key == null || rule.effective_until_bs_key >= dateKey)
}

function compatibleFactor(item: Item, unit: string) {
  if (normalizedUnit(unit) === normalizedUnit(item.unit)) return 1
  if (item.alternate_unit && normalizedUnit(unit) === normalizedUnit(item.alternate_unit)) {
    const factor = Number(item.alternate_conversion)
    return Number.isFinite(factor) && factor > 0 ? factor : null
  }
  return null
}

function quantityInRuleUnit(line: SalesPricingLine, item: Item, rule: PricingRule) {
  const ruleFactor = compatibleFactor(item, rule.quantity_unit)
  if (!ruleFactor) return null
  const entryFactor = line.conversion_factor || unitFactor(item, line.unit_mode || 'main')
  const baseQty = toBaseQty(Number(line.qty) || 0, entryFactor)
  return round6(baseQty * ruleFactor)
}

function entryRate(ruleRate: number, item: Item, rule: PricingRule, line: SalesPricingLine) {
  const ruleFactor = compatibleFactor(item, rule.quantity_unit)
  if (!ruleFactor) return null
  const baseRate = ruleFactor === 1 ? ruleRate : toBaseRate(ruleRate, ruleFactor)
  return round6(fromBaseRate(baseRate, line.conversion_factor || unitFactor(item, line.unit_mode || 'main')))
}

function applicableSlab(rule: PricingRule, quantity: number): PricingRuleSlab | undefined {
  return [...rule.slabs]
    .filter(slab => Number(slab.min_quantity) <= quantity)
    .sort((a, b) => Number(b.min_quantity) - Number(a.min_quantity) || a.id.localeCompare(b.id))[0]
}

function itemRule(item: Item, rules: PricingRule[], dateKey: number) {
  return rules
    .filter(rule => rule.scope === 'ITEM' && rule.item_id === item.id && isEffective(rule, dateKey))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0]
}

function categoryRule(item: Item, rules: PricingRule[], categories: ItemCategory[], dateKey: number) {
  const path = categoryPath(item.category_id, categories)
  return rules
    .filter(rule => rule.scope === 'CATEGORY' && !!rule.category_id && path.includes(rule.category_id) && isEffective(rule, dateKey))
    .sort((a, b) => b.priority - a.priority || path.indexOf(a.category_id!) - path.indexOf(b.category_id!) || a.id.localeCompare(b.id))[0]
}

function applyRule(line: SalesPricingLine, item: Item, rule: PricingRule, qualifyingQuantity: number): PricedSalesLine {
  const slab = applicableSlab(rule, qualifyingQuantity)
  if (!slab) return withoutCalculatedPricing(line)
  const calculated = entryRate(Number(slab.rate), item, rule, line)
  if (calculated == null) return { ...withoutCalculatedPricing(line), pricing_warning: `${item.name} is incompatible with ${rule.quantity_unit} slab pricing.` }
  const overridden = !!line.price_overridden
  const snapshot: PricingSnapshot = {
    version: 1,
    rule_id: rule.id,
    slab_id: slab.id,
    rule_name: rule.name,
    scope: rule.scope,
    quantity_unit: rule.quantity_unit,
    qualifying_quantity: round6(qualifyingQuantity),
    min_quantity: Number(slab.min_quantity),
    rule_rate: Number(slab.rate),
    calculated_entry_rate: calculated,
    price_overridden: overridden,
  }
  return {
    ...line,
    rate: overridden ? line.rate : calculated,
    calculated_rate: calculated,
    pricing_rule_id: rule.id,
    pricing_slab_id: slab.id,
    pricing_snapshot: snapshot,
  }
}

/** Pure, linear Sales repricing. It performs no network or state writes. */
export function repriceSalesLines(input: {
  lines: SalesPricingLine[]
  items: Item[]
  categories: ItemCategory[]
  rules: PricingRule[]
  dateBs: string
}): PricedSalesLine[] {
  let dateKey: number
  try { dateKey = makeBsKey(input.dateBs) } catch { return input.lines.map(line => ({ ...line })) }
  const itemById = new Map(input.items.map(item => [item.id, item]))
  const decisions = input.lines.map(line => {
    const item = itemById.get(line.item_id)
    if (!item || item.is_service) return { line, item }
    const specific = itemRule(item, input.rules, dateKey)
    return { line, item, rule: specific || categoryRule(item, input.rules, input.categories, dateKey), specific: !!specific }
  })

  const quantities = new Map<string, number>()
  for (const decision of decisions) {
    if (!decision.item || !decision.rule) continue
    const quantity = quantityInRuleUnit(decision.line, decision.item, decision.rule)
    if (quantity == null) continue
    const group = decision.specific ? `item:${decision.item.id}:${decision.rule.id}` : `category:${decision.rule.id}`
    quantities.set(group, round6((quantities.get(group) || 0) + quantity))
  }

  return decisions.map(decision => {
    if (!decision.item || !decision.rule) return withoutCalculatedPricing(decision.line)
    const quantity = quantityInRuleUnit(decision.line, decision.item, decision.rule)
    if (quantity == null) return { ...withoutCalculatedPricing(decision.line), pricing_warning: `${decision.item.name} is incompatible with ${decision.rule.quantity_unit} slab pricing.` }
    const group = decision.specific ? `item:${decision.item.id}:${decision.rule.id}` : `category:${decision.rule.id}`
    return applyRule(decision.line, decision.item, decision.rule, quantities.get(group) || 0)
  })
}
