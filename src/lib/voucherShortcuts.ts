import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { printPersistedVoucher } from '@/lib/voucherPrinterRegistry'
import { notifyError } from '@/lib/notifications'
import type { Voucher } from '@/types'

export type VoucherPrintRequest = { target: Window | null; existingIds: Set<string> }

export function beginVoucherPrint(): VoucherPrintRequest {
  return {
    target: window.open('', '_blank', 'width=800,height=900'),
    existingIds: new Set(useAppStore.getState().vouchers.map(voucher => voucher.id)),
  }
}

export function completeVoucherPrint(request: VoucherPrintRequest | undefined, type: Voucher['type'], editing?: Voucher | null) {
  if (!request) return
  const vouchers = useAppStore.getState().vouchers
  const saved = editing && editing.status !== 'Draft'
    ? vouchers.find(voucher => voucher.id === editing.id)
    : vouchers.find(voucher => voucher.type === type && voucher.status !== 'Draft' && !request.existingIds.has(voucher.id))
  if (!request.target) {
    notifyError('Voucher saved, but the print window was blocked. Print it from the voucher list.')
    return
  }
  if (!saved) {
    request.target.close()
    notifyError('Voucher saved, but the printable copy could not be prepared. Print it from the voucher list.')
    return
  }
  printPersistedVoucher(saved, request.target)
}

export function cancelVoucherPrint(request?: VoucherPrintRequest) {
  request?.target?.close()
}

export function useVoucherShortcuts(options: {
  open: boolean
  disabled: boolean
  onSave: () => void
  onSaveAndPrint: () => void
}) {
  const { open, disabled, onSave, onSaveAndPrint } = options
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return
      const key = event.key.toLowerCase()
      if (key !== 's' && key !== 'p') return
      event.preventDefault()
      event.stopPropagation()
      if (disabled) return
      if (key === 's') onSave()
      else onSaveAndPrint()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, disabled, onSave, onSaveAndPrint])
}
