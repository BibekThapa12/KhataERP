import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtMoney(n: number | undefined | null): string {
  const v = Math.round(((n ?? 0) + Number.EPSILON) * 100) / 100
  const neg = v < 0
  const abs = Math.abs(v)
  const [intPart, dec] = abs.toFixed(2).split('.')
  let result: string
  if (intPart.length <= 3) {
    result = intPart
  } else {
    const last3 = intPart.slice(-3)
    const rest = intPart.slice(0, -3)
    result = rest.replace(/(\d)(?=(\d{2})+(?!\d))/g, '$1,') + ',' + last3
  }
  return (neg ? '-' : '') + 'Rs\u00A0' + result + '.' + dec
}

export function fmtDate(d: string | undefined): string {
  if (!d) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function firstOfMonthISO(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export function uid(): string {
  return crypto.randomUUID()
}
