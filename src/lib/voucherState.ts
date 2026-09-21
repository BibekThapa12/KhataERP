import type { Account, Company, Item, StockEntry, Voucher } from '@/types'
import { recomputeAffectedBalances, recomputeAffectedStock } from './engine'

export interface VoucherAccountingState {
  rawAccounts: Account[]
  accounts: Account[]
  items: Item[]
  stock: StockEntry[]
  vouchers: Voucher[]
}

function affectedAccountIds(...vouchers: Array<Voucher | undefined>) {
  return new Set(vouchers.flatMap(voucher => (voucher?.lines || []).map(line => line.account_id)))
}

function affectedItemIds(...vouchers: Array<Voucher | undefined>) {
  return new Set(vouchers.flatMap(voucher => [
    ...(voucher?.stock_lines || []).map(line => line.item_id),
    ...(voucher?.invoice_items || []).map(line => line.item_id),
  ]))
}

/** Applies one authoritative server voucher to the current company snapshot.
 * Only ledgers/items touched by the old or new voucher are replayed. */
export function applyPersistedVoucher(
  state: VoucherAccountingState,
  company: Company,
  nextVoucher: Voucher | null,
  voucherId = nextVoucher?.id,
) {
  if (!voucherId) throw new Error('Voucher ID is required')
  if (nextVoucher && nextVoucher.company_id !== company.id) throw new Error('Voucher company does not match the active company')
  const previous = state.vouchers.find(voucher => voucher.id === voucherId)
  const vouchers = nextVoucher
    ? [...state.vouchers.filter(voucher => voucher.id !== voucherId), nextVoucher]
        .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq || b.id.localeCompare(a.id))
    : state.vouchers.filter(voucher => voucher.id !== voucherId)
  const accountsAffected = affectedAccountIds(previous, nextVoucher || undefined)
  const itemsAffected = affectedItemIds(previous, nextVoucher || undefined)
  return {
    vouchers,
    accounts: accountsAffected.size
      ? recomputeAffectedBalances(state.rawAccounts, state.accounts, vouchers, accountsAffected)
      : state.accounts,
    stock: itemsAffected.size
      ? recomputeAffectedStock(state.items, state.stock, vouchers, itemsAffected, company.inventory_valuation_method || 'weighted_average')
      : state.stock,
  }
}
