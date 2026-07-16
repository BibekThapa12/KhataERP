import { useAppStore } from '@/store/useAppStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { previewNextVoucherNumber, savedVoucherNumber } from '@/lib/voucherNumbers'
import type { Voucher, VoucherType } from '@/types'
import { cn } from '@/lib/utils'

export function VoucherNumberField({ type, dateBs, voucher, className }: { type: VoucherType; dateBs: string; voucher?: Voucher | null; className?: string }) {
  const company = useAppStore(state => state.company)
  const vouchers = useAppStore(state => state.vouchers)
  const number = voucher
    ? savedVoucherNumber(voucher)
    : company ? previewNextVoucherNumber(company, vouchers, type, dateBs) : 'Assigned on save'

  return <div className={cn('space-y-1.5', className)}>
    <Label>Voucher Number</Label>
      <Input value={number} readOnly tabIndex={-1} className="num !bg-[#f6f6f6] font-medium" />
    {!voucher && <p className="text-[10px] text-muted-foreground">Preview; confirmed when saved.</p>}
  </div>
}
