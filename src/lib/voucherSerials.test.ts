import { describe, expect, it } from 'vitest'
import { attachVoucherSerials, groupVoucherSerials } from '@/lib/voucherSerials'
import type { Voucher, VoucherSerialNumber } from '@/types'

const rows: VoucherSerialNumber[] = [
  { item_id: 'phone', serial_number: 'IMEI-10', direction: 'out' },
  { item_id: 'phone', serial_number: 'IMEI-2', direction: 'out' },
  { item_id: 'phone', serial_number: 'IMEI-2', direction: 'out' },
]

describe('voucher serial presentation', () => {
  it('groups, deduplicates, and naturally sorts serial numbers', () => {
    expect(groupVoucherSerials(rows).get('phone')).toEqual(['IMEI-2', 'IMEI-10'])
  })

  it('attaches serials without mutating the source voucher', () => {
    const voucher = { id: 'voucher', invoice_items: [{ item_id: 'phone', qty: 2, rate: 1 }] } as Voucher
    const hydrated = attachVoucherSerials(voucher, rows)
    expect(hydrated).not.toBe(voucher)
    expect(hydrated.invoice_items?.[0].serial_numbers).toEqual(['IMEI-2', 'IMEI-10'])
    expect(voucher.invoice_items?.[0].serial_numbers).toBeUndefined()
  })
})
