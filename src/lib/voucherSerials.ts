import type { Voucher, VoucherSerialNumber } from '@/types'

export function groupVoucherSerials(rows: VoucherSerialNumber[]) {
  const grouped = new Map<string, string[]>()
  for (const row of rows) {
    const serial = row.serial_number.trim()
    if (!serial) continue
    const current = grouped.get(row.item_id) || []
    if (!current.some(value => value.localeCompare(serial, undefined, { sensitivity: 'accent' }) === 0)) current.push(serial)
    grouped.set(row.item_id, current)
  }
  for (const serials of grouped.values()) serials.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  return grouped
}

export function attachVoucherSerials(voucher: Voucher, rows: VoucherSerialNumber[]): Voucher {
  if (!rows.length) return voucher
  const grouped = groupVoucherSerials(rows)
  return {
    ...voucher,
    invoice_items: voucher.invoice_items?.map(line => ({
      ...line,
      serial_numbers: grouped.get(line.item_id) || line.serial_numbers,
    })),
    stock_lines: voucher.stock_lines?.map(line => ({
      ...line,
      serial_numbers: grouped.get(line.item_id) || line.serial_numbers,
    })),
  }
}
