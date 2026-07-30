import type { Company, Voucher, VoucherType } from '@/types'
import { makeBsKey } from '@/lib/nepaliDate'
import { assertDateInSelectedFiscalYear } from '@/lib/reports'
import { voucherNumberingPeriod } from '@/lib/voucherNumbers'

export type VoucherDateValidationResult = {
  valid: boolean
  message?: string
  previous?: Voucher
  next?: Voucher
}

export const PREVIOUS_VOUCHER_DATE_ERROR = 'Cannot save voucher. Voucher date must be the same as or later than the previous voucher date.'
export const NEXT_VOUCHER_DATE_ERROR = 'Cannot save voucher. Voucher date must be the same as or earlier than the next voucher date.'
export const PREVIOUS_VOUCHER_DATE_FIELD_HINT = 'Date must be on or after the previous voucher date.'
export const NEXT_VOUCHER_DATE_FIELD_HINT = 'Date must be on or before the next voucher date.'

const CHRONO_TYPES = new Set<VoucherType>(['Sales', 'Purchase', 'Sales Return', 'Purchase Return', 'Receipt', 'Payment', 'Journal'])

function numberValue(voucher: Voucher) {
  const match = String(voucher.invoice_no || '').match(/(\d+)$/)
  return match ? Number(match[1]) : voucher.seq || 0
}

export function isManualVoucherNumbering(company: Company, type: VoucherType) {
  return type === 'Journal' && company.journal_numbering_mode === 'manual'
}

function voucherLabel(voucher: Voucher) {
  return voucher.invoice_no || String(voucher.seq)
}

function completedNumberedVouchers(company: Company, vouchers: Voucher[], type: VoucherType, dateBs: string) {
  const period = voucherNumberingPeriod(company, dateBs)
  return vouchers
    .filter(voucher =>
      voucher.type === type &&
      voucher.status !== 'Draft' &&
      (voucher.numbering_period || voucherNumberingPeriod(company, voucher.date_bs)) === period &&
      !!voucher.invoice_no
    )
    .sort((left, right) => numberValue(left) - numberValue(right) || left.seq - right.seq)
}

export function validateManualVoucherNumber(company: Company, vouchers: Voucher[], type: VoucherType, dateBs: string, invoiceNo: string | undefined, currentVoucherId?: string): VoucherDateValidationResult {
  if (!isManualVoucherNumbering(company, type)) return { valid: true }
  const number = invoiceNo?.trim()
  if (!number) return { valid: false, message: 'Enter the Journal voucher number.' }
  const period = voucherNumberingPeriod(company, dateBs)
  const duplicate = vouchers.find(voucher =>
    voucher.id !== currentVoucherId &&
    voucher.type === type &&
    voucher.status !== 'Draft' &&
    (voucher.numbering_period || voucherNumberingPeriod(company, voucher.date_bs)) === period &&
    String(voucher.invoice_no || '').trim().toLowerCase() === number.toLowerCase()
  )
  if (duplicate) return { valid: false, message: `Journal voucher number ${number} already exists in this fiscal year.` }
  return { valid: true }
}

export function validateVoucherDateForNumbering(params: {
  company: Company
  vouchers: Voucher[]
  type: VoucherType
  dateBs: string
  currentVoucherId?: string
  invoiceNo?: string
  status?: Voucher['status']
}): VoucherDateValidationResult {
  const { company, vouchers, type, dateBs, currentVoucherId, invoiceNo, status = 'Completed' } = params
  try {
    assertDateInSelectedFiscalYear(company, dateBs)
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : 'Voucher date must be inside the selected financial year.' }
  }

  if (status === 'Draft') return { valid: true }
  if (!CHRONO_TYPES.has(type)) return { valid: true }

  const manual = validateManualVoucherNumber(company, vouchers, type, dateBs, invoiceNo, currentVoucherId)
  if (!manual.valid) return manual
  if (isManualVoucherNumbering(company, type)) return { valid: true }

  const dateKey = makeBsKey(dateBs)
  const candidates = completedNumberedVouchers(company, vouchers, type, dateBs)

  if (!currentVoucherId) {
    const previous = candidates.at(-1)
    if (previous && dateKey < (previous.date_bs_key || makeBsKey(previous.date_bs))) {
      return {
        valid: false,
        previous,
        message: `The voucher date cannot be earlier than the previous voucher (${voucherLabel(previous)}). Please select the same or a later date.`,
      }
    }
    return { valid: true }
  }

  const current = candidates.find(voucher => voucher.id === currentVoucherId)
  const currentNumber = current ? numberValue(current) : Number(String(invoiceNo || '').match(/(\d+)$/)?.[1] || 0)
  const previous = [...candidates].reverse().find(voucher => voucher.id !== currentVoucherId && numberValue(voucher) < currentNumber)
  const next = candidates.find(voucher => voucher.id !== currentVoucherId && numberValue(voucher) > currentNumber)

  if (previous && dateKey < (previous.date_bs_key || makeBsKey(previous.date_bs))) {
    return { valid: false, previous, message: `The voucher date cannot be earlier than Voucher ${voucherLabel(previous)}.` }
  }
  if (next && dateKey > (next.date_bs_key || makeBsKey(next.date_bs))) {
    return { valid: false, next, message: `The voucher date cannot be later than Voucher ${voucherLabel(next)}.` }
  }
  return { valid: true }
}

export function friendlyVoucherDateError(error: unknown, validation?: VoucherDateValidationResult): string | null {
  if (validation && !validation.valid) {
    if (validation.previous) return PREVIOUS_VOUCHER_DATE_ERROR
    if (validation.next) return NEXT_VOUCHER_DATE_ERROR
    return validation.message || null
  }
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : ''
  if (/cannot be earlier than (the previous voucher|Voucher)/i.test(message)) return PREVIOUS_VOUCHER_DATE_ERROR
  if (/cannot be later than Voucher/i.test(message)) return NEXT_VOUCHER_DATE_ERROR
  if (/Date must be inside selected financial year|Date cannot be before the company books start date/i.test(message)) return message
  return null
}

export function voucherDateFieldHint(validation?: VoucherDateValidationResult): string | false {
  if (!validation || validation.valid) return false
  if (validation.previous) return PREVIOUS_VOUCHER_DATE_FIELD_HINT
  if (validation.next) return NEXT_VOUCHER_DATE_FIELD_HINT
  return true
}
