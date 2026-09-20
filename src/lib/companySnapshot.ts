import type { Company } from '@/types'
import { fetchAccounts, fetchAccountCategories, fetchParties, fetchItems, fetchItemCategories, fetchVouchers, fetchPricingRules } from './supabase'
import { recomputeAllBalances, recomputeStock } from './engine'

/** Reads only. All consumers receive accounting inputs and derived results together. */
export async function fetchCompanySnapshot(company: Company) {
  const [rawAccounts, accountCategories, parties, items, itemCategories, vouchers, pricingRules] = await Promise.all([
    fetchAccounts(company.id), fetchAccountCategories(company.id), fetchParties(company.id),
    fetchItems(company.id), fetchItemCategories(company.id), fetchVouchers(company.id), fetchPricingRules(company.id),
  ])
  for (const rows of [rawAccounts, accountCategories, parties, items, itemCategories, vouchers, pricingRules]) {
    if (rows.some(row => row.company_id !== company.id)) throw new Error('Company data scope mismatch')
  }
  return {
    rawAccounts, accountCategories, parties, items, itemCategories, vouchers, pricingRules,
    accounts: recomputeAllBalances(rawAccounts, vouchers),
    stock: recomputeStock(items, vouchers, company.inventory_valuation_method || 'weighted_average'),
  }
}
