import type { Voucher } from '@/types'

type VoucherPrinter = (voucher: Voucher, targetWindow?: Window) => void
let activePrinter: VoucherPrinter | null = null

export function registerVoucherPrinter(printer: VoucherPrinter) {
  activePrinter = printer
}

export function printPersistedVoucher(voucher: Voucher, targetWindow?: Window) {
  activePrinter?.(voucher, targetWindow)
}
