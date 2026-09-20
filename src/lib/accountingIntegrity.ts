import type { Account, AccountCategory, Company, Item, Party, Voucher } from '@/types'
import { isCompletedVoucher, recomputeAllBalances, recomputeStock, round2, voucherStatus, computeTrialBalance, computeBalanceSheet, computeVatReport } from './engine'
import { computeDetailedProfitLoss } from './reports'
import { makeBsKey, bsToAd } from './nepaliDate'
import { toBaseQty } from './units'

export interface IntegrityAnomaly {
  company_id: string
  voucher_id: string | null
  reference: string | null
  check: string
  severity: 'error' | 'warning' | 'unavailable'
  evidence: unknown
}
export interface IntegrityManifest {
  company_id: string
  checked_at: string
  counts: Record<string, number>
  voucher_ids: string[]
  latest_voucher_update: string | null
}
export interface IntegrityData {
  company: Company
  rawAccounts: Account[]
  accountCategories?: AccountCategory[]
  parties: Party[]
  items: Item[]
  vouchers: Voucher[]
}

/** Report anomalies, not repairs. All financial checks use full company history. */
export function checkAccountingIntegrity(data: IntegrityData, clientIds: string[], manifest?: IntegrityManifest | null) {
  const { company, rawAccounts, parties, items, vouchers } = data
  const anomalies: IntegrityAnomaly[] = []
  const add = (check: string, evidence: unknown, voucher?: Voucher, severity: IntegrityAnomaly['severity'] = 'error') => {
    anomalies.push({ company_id: company.id, voucher_id: voucher?.id || null, reference: voucher?.invoice_no || voucher?.draft_no || null, check, severity, evidence })
  }
  const counts: Record<string, number> = {
    vouchers: vouchers.length, accounts: rawAccounts.length, parties: parties.length, items: items.length,
    settlements: vouchers.reduce((n, v) => n + (v.settlements?.length || 0), 0),
    ledger_lines: vouchers.reduce((n, v) => n + (v.lines?.length || 0), 0),
    invoice_items: vouchers.reduce((n, v) => n + (v.invoice_items?.length || 0), 0),
    stock_lines: vouchers.reduce((n, v) => n + (v.stock_lines?.length || 0), 0),
  }
  const apiIds = new Set(vouchers.map(v => v.id)), loadedIds = new Set(clientIds)
  for (const id of apiIds) if (!loadedIds.has(id)) add('api_not_in_client', { id }, vouchers.find(v => v.id === id))
  for (const id of loadedIds) if (!apiIds.has(id)) add('client_not_in_api', { id }, undefined, 'warning')
  if (!manifest) add('database_manifest_unavailable', 'Database comparison not performed; API results are RLS-visible only.', undefined, 'unavailable')
  else if (manifest.company_id !== company.id) add('manifest_company_mismatch', manifest.company_id)
  else {
    for (const [table, apiCount] of Object.entries(counts)) {
      if (manifest.counts[table] !== apiCount) add('database_api_count_difference', { table, database: manifest.counts[table] ?? null, api: apiCount, note: 'Investigate RLS or concurrent writes; do not assume deletion.' })
    }
    const databaseIds = new Set(manifest.voucher_ids)
    for (const id of databaseIds) if (!apiIds.has(id)) add('database_not_in_api', { id, note: 'Check authenticated RLS and snapshot timing.' })
    for (const id of apiIds) if (!databaseIds.has(id)) add('api_not_in_database_manifest', { id }, undefined, 'warning')
  }
  const accountById = new Map(rawAccounts.map(row => [row.id, row]))
  const itemById = new Map(items.map(row => [row.id, row]))
  const voucherById = new Map(vouchers.map(row => [row.id, row]))
  for (const rows of [rawAccounts, parties, items, vouchers]) for (const row of rows) {
    if (row.company_id !== company.id) add('tenant_ownership', { id: row.id, actual_company: row.company_id })
  }
  for (const v of vouchers) {
    if (v.status && !['Draft', 'Completed'].includes(v.status)) add('unknown_status', v.status, v)
    try {
      const converted = bsToAd(v.date_bs)
      if (makeBsKey(v.date_bs) !== v.date_bs_key || converted !== v.date_ad) add('date_mismatch', { bs: v.date_bs, key: v.date_bs_key, ad: v.date_ad }, v)
    } catch { add('invalid_date', { bs: v.date_bs, ad: v.date_ad }, v) }
    if (voucherStatus(v) === 'Draft') {
      if (!v.draft_payload || typeof v.draft_payload !== 'object') add('draft_payload_missing', null, v, 'warning')
      continue
    }
    // Cancelled history is retained; financial/stock requirements apply to active postings.
    if (!isCompletedVoucher(v)) continue
    if (!v.lines || !v.stock_lines || !v.invoice_items || !v.settlements) add('children_unavailable', 'Missing arrays are not treated as a verified empty result.', v, 'unavailable')
    const ledger = v.lines || [], invoice = v.invoice_items || [], stock = v.stock_lines || []
    if (v.type !== 'Stock Adjustment' && v.total !== 0 && !ledger.length) add('ledger_lines_missing', { total: v.total }, v)
    const debit = ledger.reduce((n, l) => n + Number(l.debit), 0), credit = ledger.reduce((n, l) => n + Number(l.credit), 0)
    if (!Number.isFinite(debit + credit) || Math.abs(debit - credit) > 0.000001) add('unbalanced_ledger', { debit, credit }, v)
    for (const line of ledger) {
      if (line.voucher_id !== v.id || !accountById.has(line.account_id)) add('ledger_reference', line, v)
      if (line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0)) add('invalid_ledger_amount', line, v)
    }
    if (['Sales', 'Purchase', 'Sales Return', 'Purchase Return'].includes(v.type)) {
      if (!invoice.length) add('invoice_items_missing', null, v)
      const lineAmount = round2(invoice.reduce((n, l) => n + Number(l.amount ?? l.qty * l.rate), 0))
      if (v.subtotal !== undefined && Math.abs(lineAmount - v.subtotal) > 0.01) add('invoice_subtotal', { lines: lineAmount, subtotal: v.subtotal }, v)
      const expectedTotal = round2(Number(v.subtotal || 0) - Number(v.discount || 0) + Number(v.vat_amount || 0))
      if (v.subtotal !== undefined && Math.abs(expectedTotal - v.total) > 0.01) add('invoice_total', { expected: expectedTotal, actual: v.total }, v)
    }
    const expectedStock = new Map<string, number>()
    for (const line of invoice) {
      const item = itemById.get(line.item_id)
      if (line.voucher_id !== v.id || !item) { add('invoice_item_reference', line, v); continue }
      if (!item.is_service && !(v.type === 'Sales Return' && v.restock_items === false)) {
        expectedStock.set(item.id, (expectedStock.get(item.id) || 0) + Number(line.base_qty ?? toBaseQty(line.qty, line.conversion_factor || 1)))
      }
    }
    for (const line of stock) {
      if (line.voucher_id !== v.id || !itemById.has(line.item_id)) add('stock_reference', line, v)
      if (itemById.get(line.item_id)?.is_service) add('service_stock_movement', line, v)
    }
    const direction = v.type === 'Sales' || v.type === 'Purchase Return' ? 'out' : 'in'
    for (const [itemId, expected] of expectedStock) {
      const actual = stock.filter(l => l.item_id === itemId).reduce((n, l) => n + (l.direction === direction ? Number(l.qty) : -Number(l.qty)), 0)
      if (Math.abs(expected - actual) > 0.000001) add('stock_quantity', { item_id: itemId, expected, actual, direction }, v)
    }
    for (const settlement of v.settlements || []) {
      const invoice = voucherById.get(settlement.invoice_voucher_id)
      if (settlement.company_id !== company.id || settlement.settlement_voucher_id !== v.id || !invoice || !accountById.has(settlement.party_account_id) || !(settlement.amount > 0)) add('settlement_reference', settlement, v)
    }
  }
  const accounts = recomputeAllBalances(rawAccounts, vouchers)
  const stock = recomputeStock(items, vouchers, company.inventory_valuation_method || 'weighted_average')
  const openingStock = recomputeStock(items, [], company.inventory_valuation_method || 'weighted_average')
  const profitLoss = computeDetailedProfitLoss(company.id, accounts, data.accountCategories || [], openingStock, stock)
  const trialBalance = computeTrialBalance(accounts)
  const balanceSheet = computeBalanceSheet(accounts, profitLoss.netProfit, stock.reduce((n, s) => n + s.value, 0))
  if (!trialBalance.balanced) add('trial_balance_difference', { debit: trialBalance.total_debit, credit: trialBalance.total_credit, note: 'Includes saved opening balances; no repair is proposed automatically.' }, undefined, 'warning')
  if (!balanceSheet.balanced) add('balance_sheet_difference', { assets: balanceSheet.total_assets, liabilities: balanceSheet.total_liabilities, equity: balanceSheet.total_equity }, undefined, 'warning')
  const dates = vouchers.filter(v => makeBsKey(v.date_bs) > 0).map(v => v.date_bs).sort()
  return {
    generated_at: new Date().toISOString(), company_id: company.id, scope: 'Full company history; active Completed financial scope; no repairs',
    database: manifest || null, api_counts: counts, client_voucher_count: clientIds.length, anomalies,
    reconciliation: {
      trial_balance: trialBalance,
      profit_loss: profitLoss,
      balance_sheet: balanceSheet,
      vat: dates.length ? computeVatReport(vouchers, dates[0], dates[dates.length - 1]) : null,
      voucher_totals: Object.fromEntries(['Sales', 'Purchase', 'Sales Return', 'Purchase Return', 'Receipt', 'Payment', 'Journal'].map(type => {
        const rows = vouchers.filter(v => v.type === type && isCompletedVoucher(v))
        return [type, { count: rows.length, total: round2(rows.reduce((n, v) => n + Number(v.total), 0)), discount: round2(rows.reduce((n, v) => n + Number(v.discount || 0), 0)) }]
      })),
      accounts: accounts.map(a => ({ id: a.id, type: a.type, opening_balance: a.opening_balance, balance: a.balance })),
      stock: stock.map(s => ({ id: s.id, qty: s.qty, value: s.value, avg_cost: s.avg_cost })),
    },
    limitations: ['A count/ID difference may be concurrent activity or RLS, not data loss.', 'Visible screens apply intentional fiscal/date/search/status filters; this report compares full history.', 'Financial snapshots use the existing engine, not an independent audit of financial formulas.'],
  }
}
