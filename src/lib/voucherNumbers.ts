import type { Company, Voucher, VoucherType } from '@/types'
import { adToBs, makeBsKey } from '@/lib/nepaliDate'

export function voucherPrefix(company: Company, type: VoucherType): string {
  if (type === 'Sales') return company.sales_prefix || 'INV-'
  if (type === 'Purchase') return company.purchase_prefix || 'PB-'
  if (type === 'Receipt') return company.receipt_prefix || 'RCPT-'
  if (type === 'Payment') return company.payment_prefix || 'PAY-'
  if (type === 'Sales Return') return company.sales_return_prefix || 'SR-'
  if (type === 'Purchase Return') return company.purchase_return_prefix || 'PR-'
  if (type === 'Journal') return 'JV-'
  return 'SA-'
}

export function savedVoucherNumber(voucher: Voucher): string {
  return voucher.invoice_no || String(voucher.seq)
}

export function voucherNumberingPeriod(company: Company, dateBs: string): string {
  if (!company.reset_numbering_fiscal_year || !company.fiscal_year_start) return 'all'
  const fiscalMonthDay = adToBs(company.fiscal_year_start).slice(5)
  const voucherYear = Number(dateBs.slice(0, 4))
  const fiscalYear = dateBs.slice(5) >= fiscalMonthDay ? voucherYear : voucherYear - 1
  return `FY-${fiscalYear}`
}

export function previewNextVoucherNumber(company: Company, vouchers: Voucher[], type: VoucherType, dateBs: string): string {
  let candidates = vouchers.filter(voucher => voucher.type === type)
  if (company.reset_numbering_fiscal_year && company.fiscal_year_start && dateBs) {
    const fiscalMonthDay = adToBs(company.fiscal_year_start).slice(5)
    const voucherYear = Number(dateBs.slice(0, 4))
    const fiscalYear = dateBs.slice(5) >= fiscalMonthDay ? voucherYear : voucherYear - 1
    const from = makeBsKey(`${fiscalYear}-${fiscalMonthDay}`)
    const to = makeBsKey(`${fiscalYear + 1}-${fiscalMonthDay}`)
    candidates = candidates.filter(voucher => voucher.date_bs_key >= from && voucher.date_bs_key < to)
  }
  const highest = candidates.reduce((value, voucher) => {
    const match = String(voucher.invoice_no || '').match(/(\d+)$/)
    return match ? Math.max(value, Number(match[1])) : value
  }, 0)
  return `${voucherPrefix(company, type)}${String(highest + 1).padStart(4, '0')}`
}
