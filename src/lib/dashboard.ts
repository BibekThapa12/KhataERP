import type { Account, Item, Voucher } from '@/types'
import { adToBs, bsToAd, makeBsKey, parseBsDate } from '@/lib/nepaliDate'
import { round2 } from '@/lib/engine'

export type DashboardGrouping = 'daily' | 'weekly' | 'monthly'

export interface DashboardSeriesPoint {
  key: string
  label: string
  sales: number
  purchases: number
  inflow: number
  outflow: number
  net: number
}

type VoucherWithWorkflow = Voucher & {
  status?: string
  posted?: boolean
  deleted_at?: string | null
}

export function isPostedDashboardVoucher(voucher: Voucher) {
  const workflow = voucher as VoucherWithWorkflow
  const status = workflow.status?.toLowerCase()
  return !voucher.cancelled && !workflow.deleted_at && workflow.posted !== false && status !== 'draft' && status !== 'unposted' && status !== 'deleted'
}

export function dashboardVouchersInRange(vouchers: Voucher[], from: string, to: string) {
  const fromKey = makeBsKey(from)
  const toKey = makeBsKey(to)
  return vouchers.filter(voucher => {
    const key = voucher.date_bs_key || makeBsKey(voucher.date_bs)
    return isPostedDashboardVoucher(voucher) && key >= fromKey && key <= toKey
  })
}

export function dashboardVouchersThrough(vouchers: Voucher[], to: string, inclusive = true) {
  const toKey = makeBsKey(to)
  return vouchers.filter(voucher => {
    const key = voucher.date_bs_key || makeBsKey(voucher.date_bs)
    return isPostedDashboardVoucher(voucher) && (inclusive ? key <= toKey : key < toKey)
  })
}

function dateDiffDays(from: string, to: string) {
  try {
    const start = new Date(`${bsToAd(from)}T00:00:00Z`).getTime()
    const end = new Date(`${bsToAd(to)}T00:00:00Z`).getTime()
    return Math.max(0, Math.round((end - start) / 86400000))
  } catch {
    return 0
  }
}

export function dashboardGrouping(from: string, to: string): DashboardGrouping {
  const days = dateDiffDays(from, to)
  if (days <= 31) return 'daily'
  if (days <= 120) return 'weekly'
  return 'monthly'
}

function addAdDays(adDate: string, days: number) {
  const date = new Date(`${adDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function emptyPoint(key: string, label: string): DashboardSeriesPoint {
  return { key, label, sales: 0, purchases: 0, inflow: 0, outflow: 0, net: 0 }
}

export function createDashboardSeries(from: string, to: string) {
  const grouping = dashboardGrouping(from, to)
  const points: DashboardSeriesPoint[] = []
  let fromAd = ''
  try { fromAd = bsToAd(from) } catch { return { grouping, points, keyForDate: () => '' } }
  if (!parseBsDate(to) || makeBsKey(from) > makeBsKey(to)) return { grouping, points, keyForDate: () => '' }

  if (grouping === 'daily') {
    const days = dateDiffDays(from, to)
    for (let day = 0; day <= days; day += 1) {
      const bs = adToBs(addAdDays(fromAd, day))
      points.push(emptyPoint(bs, bs.slice(5)))
    }
  } else if (grouping === 'weekly') {
    const days = dateDiffDays(from, to)
    for (let day = 0, week = 1; day <= days; day += 7, week += 1) {
      const bs = adToBs(addAdDays(fromAd, day))
      points.push(emptyPoint(`week-${week}`, bs.slice(5)))
    }
  } else {
    const start = parseBsDate(from)
    const end = parseBsDate(to)
    if (start && end) {
      let year = start.year
      let month = start.month
      while (year < end.year || (year === end.year && month <= end.month)) {
        const key = monthKey(year, month)
        points.push(emptyPoint(key, key))
        month += 1
        if (month > 12) { month = 1; year += 1 }
      }
    }
  }

  const keyForDate = (dateBs: string) => {
    if (grouping === 'daily') return dateBs
    if (grouping === 'monthly') return dateBs.slice(0, 7)
    const week = Math.floor(dateDiffDays(from, dateBs) / 7) + 1
    return `week-${Math.max(1, week)}`
  }

  return { grouping, points, keyForDate }
}

function commercialAmount(voucher: Voucher) {
  return round2(voucher.subtotal != null ? voucher.subtotal - (voucher.discount || 0) : voucher.total || 0)
}

export function buildDashboardSeries(vouchers: Voucher[], cashMovements: { voucher: Voucher; amount: number }[], from: string, to: string) {
  const { grouping, points, keyForDate } = createDashboardSeries(from, to)
  const byKey = new Map(points.map(point => [point.key, point]))

  for (const voucher of dashboardVouchersInRange(vouchers, from, to)) {
    const point = byKey.get(keyForDate(voucher.date_bs))
    if (!point) continue
    const amount = commercialAmount(voucher)
    if (voucher.type === 'Sales') point.sales = round2(point.sales + amount)
    if (voucher.type === 'Sales Return') point.sales = round2(point.sales - amount)
    if (voucher.type === 'Purchase') point.purchases = round2(point.purchases + amount)
    if (voucher.type === 'Purchase Return') point.purchases = round2(point.purchases - amount)
  }

  for (const movement of cashMovements) {
    const point = byKey.get(keyForDate(movement.voucher.date_bs))
    if (!point) continue
    if (movement.amount > 0) point.inflow = round2(point.inflow + movement.amount)
    else point.outflow = round2(point.outflow + Math.abs(movement.amount))
  }
  points.forEach(point => { point.net = round2(point.inflow - point.outflow) })
  return { grouping, points }
}

export function topSellingItems(vouchers: Voucher[], items: Item[], from: string, to: string, limit = 5) {
  const quantities = new Map<string, number>()
  for (const voucher of dashboardVouchersInRange(vouchers, from, to)) {
    const sign = voucher.type === 'Sales' ? 1 : voucher.type === 'Sales Return' ? -1 : 0
    if (!sign) continue
    for (const line of voucher.invoice_items || []) {
      const baseQty = line.base_qty ?? line.qty * (line.conversion_factor || 1)
      quantities.set(line.item_id, round2((quantities.get(line.item_id) || 0) + sign * baseQty))
    }
  }
  const itemMap = new Map(items.map(item => [item.id, item]))
  return [...quantities.entries()]
    .map(([itemId, qty]) => ({ item: itemMap.get(itemId), itemId, qty }))
    .filter(row => row.item && row.qty > 0)
    .sort((left, right) => right.qty - left.qty || (left.item?.name || '').localeCompare(right.item?.name || ''))
    .slice(0, limit)
}

export function accountBalance(account: Account | undefined) {
  return round2(account?.balance || 0)
}
