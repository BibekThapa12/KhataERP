import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { printPersistedVoucher } from '@/lib/voucherPrinterRegistry'
import { notifyError } from '@/lib/notifications'
import type { Voucher } from '@/types'

export type VoucherPrintRequest = { existingIds: Set<string> }

export function beginVoucherPrint(): VoucherPrintRequest {
  return {
    existingIds: new Set(useAppStore.getState().vouchers.map(voucher => voucher.id)),
  }
}

export function completeVoucherPrint(request: VoucherPrintRequest | undefined, type: Voucher['type'], editing?: Voucher | null) {
  if (!request) return
  const vouchers = useAppStore.getState().vouchers
  const saved = editing && editing.status !== 'Draft'
    ? vouchers.find(voucher => voucher.id === editing.id)
    : vouchers.find(voucher => voucher.type === type && voucher.status !== 'Draft' && !request.existingIds.has(voucher.id))
  if (!saved) {
    notifyError('Voucher saved, but the printable copy could not be prepared. Print it from the voucher list.')
    return
  }
  printPersistedVoucher(saved)
}

export function cancelVoucherPrint(_request?: VoucherPrintRequest) {}

export function useVoucherShortcuts(options: {
  open: boolean
  disabled: boolean
  draftDisabled?: boolean
  onSave: () => void
  onSaveAndPrint: () => void
  onSaveDraft?: () => void
}) {
  const { open, disabled, draftDisabled = disabled, onSave, onSaveAndPrint, onSaveDraft } = options
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return
      const key = event.key.toLowerCase()
      if (key !== 's' && key !== 'p' && key !== 'd') return
      if (key === 'd' && !onSaveDraft) return
      event.preventDefault()
      event.stopPropagation()
      if (key === 'd') {
        if (!draftDisabled) onSaveDraft?.()
        return
      }
      if (disabled) return
      if (key === 's') onSave()
      else onSaveAndPrint()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, disabled, draftDisabled, onSave, onSaveAndPrint, onSaveDraft])
}
