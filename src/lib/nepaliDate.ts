import NepaliDate, { dateConfigMap } from 'nepali-date-converter'

export interface NepaliDateParts {
  year: number
  month: number
  day: number
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export const BS_MONTH_NAMES = [
  'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Aswin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
] as const

export const BS_WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function getBsMonthLength(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0
  const config = dateConfigMap[String(year)]
  if (!config) return 0
  return config[BS_MONTH_NAMES[month - 1]] || 0
}

export function parseBsDate(bsDate: string): NepaliDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bsDate.trim())
  if (!match) return null
  const [, y, m, d] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const monthLength = getBsMonthLength(year, month)
  if (!year || !monthLength || day < 1 || day > monthLength) return null
  return { year, month, day }
}

export function formatBsParts({ year, month, day }: NepaliDateParts): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function normalizeBsDateInput(value: string): string | null {
  const input = value.trim()
  if (parseBsDate(input)) return input

  const compact = input.match(/^\d{6}$|^\d{8}$/)?.[0]
  if (!compact) return null
  const yearLength = compact.length === 6 ? 2 : 4
  const year = Number(compact.slice(0, yearLength)) + (yearLength === 2 ? 2000 : 0)
  const month = Number(compact.slice(yearLength, yearLength + 2))
  const day = Number(compact.slice(yearLength + 2, yearLength + 4))
  const formatted = formatBsParts({ year, month, day })
  return parseBsDate(formatted) ? formatted : null
}

export function makeBsKey(bsDate: string): number {
  const parts = parseBsDate(bsDate)
  if (!parts) return 0
  return parts.year * 10000 + parts.month * 100 + parts.day
}

export function compareBsDates(left: string, right: string): number {
  return makeBsKey(left) - makeBsKey(right)
}

export function getBsWeekday(bsDate: string): number {
  const parts = parseBsDate(bsDate)
  if (!parts) return 0
  return new NepaliDate(parts.year, parts.month - 1, parts.day).getDay()
}

export function shiftBsMonth(year: number, month: number, offset: number): Pick<NepaliDateParts, 'year' | 'month'> {
  const absoluteMonth = year * 12 + (month - 1) + offset
  return {
    year: Math.floor(absoluteMonth / 12),
    month: ((absoluteMonth % 12) + 12) % 12 + 1,
  }
}

export function adToBs(adDate: string): string {
  const [year, month, day] = adDate.split('-').map(Number)
  const bs = NepaliDate.fromAD(new Date(year, month - 1, day)).getBS()
  return formatBsParts({ year: bs.year, month: bs.month + 1, day: bs.date })
}

export function bsToAd(bsDate: string): string {
  const parts = parseBsDate(bsDate)
  if (!parts) throw new Error('Enter a valid Nepali date in YYYY-MM-DD format.')
  const ad = new NepaliDate(parts.year, parts.month - 1, parts.day).toJsDate()
  return `${ad.getFullYear()}-${pad2(ad.getMonth() + 1)}-${pad2(ad.getDate())}`
}

export function addDaysToBs(bsDate: string, days: number): string {
  const safeDays = Math.trunc(Number(days) || 0)
  const [year, month, day] = bsToAd(bsDate).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + safeDays)
  return adToBs(`${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`)
}

export const DEFAULT_FISCAL_YEAR_START_BS = '2083-04-01'
export const DEFAULT_FISCAL_YEAR_START_AD = bsToAd(DEFAULT_FISCAL_YEAR_START_BS)

export function todayBs(): string {
  const today = new Date()
  return adToBs(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`)
}

export function firstOfCurrentBsMonth(): string {
  const parts = parseBsDate(todayBs())
  if (!parts) return todayBs()
  return formatBsParts({ ...parts, day: 1 })
}

export function normalizeVoucherDates<T extends { date?: string; date_ad?: string | null; date_bs?: string | null; date_bs_key?: number | null }>(voucher: T) {
  const dateAd = voucher.date_ad || voucher.date || new Date().toISOString().slice(0, 10)
  const dateBs = voucher.date_bs || adToBs(dateAd)
  return {
    ...voucher,
    date: voucher.date || dateAd,
    date_ad: dateAd,
    date_bs: dateBs,
    date_bs_key: voucher.date_bs_key || makeBsKey(dateBs),
  }
}
