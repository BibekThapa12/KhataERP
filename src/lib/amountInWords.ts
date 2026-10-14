import type { VoucherType } from '@/types'

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
] as const

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'] as const

function underOneHundred(value: number): string {
  if (value < 20) return ONES[value]
  return [TENS[Math.floor(value / 10)], ONES[value % 10]].filter(Boolean).join(' ')
}

function underOneThousand(value: number): string {
  if (value < 100) return underOneHundred(value)
  const hundreds = `${ONES[Math.floor(value / 100)]} Hundred`
  const remainder = value % 100
  return remainder ? `${hundreds} ${underOneHundred(remainder)}` : hundreds
}

function integerInIndianWords(value: number): string {
  if (value === 0) return 'Zero'

  const parts: string[] = []
  let remainder = value
  const crore = Math.floor(remainder / 10_000_000)
  if (crore) {
    parts.push(`${integerInIndianWords(crore)} Crore`)
    remainder %= 10_000_000
  }

  const lakh = Math.floor(remainder / 100_000)
  if (lakh) {
    parts.push(`${underOneHundred(lakh)} Lakh`)
    remainder %= 100_000
  }

  const thousand = Math.floor(remainder / 1_000)
  if (thousand) {
    parts.push(`${underOneHundred(thousand)} Thousand`)
    remainder %= 1_000
  }

  if (remainder) parts.push(underOneThousand(remainder))
  return parts.join(' ')
}

export function nprAmountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError('Amount must be a finite non-negative number')
  }

  const totalPaisa = Math.round((amount + Number.EPSILON) * 100)
  if (!Number.isSafeInteger(totalPaisa)) {
    throw new RangeError('Amount is too large to convert safely')
  }

  const rupees = Math.floor(totalPaisa / 100)
  const paisa = totalPaisa % 100
  const paisaWords = paisa ? ` and ${underOneHundred(paisa)} Paisa` : ''
  return `${integerInIndianWords(rupees)} Rupees${paisaWords} Only.`
}

const INVOICE_PRINT_TYPES = new Set<VoucherType>(['Sales', 'Purchase', 'Sales Return', 'Purchase Return'])

export function invoiceAmountInWords(type: VoucherType, amount: number): string | null {
  return INVOICE_PRINT_TYPES.has(type) ? nprAmountInWords(amount) : null
}
