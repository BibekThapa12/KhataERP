import type { Company, Voucher } from '@/types'
import { fmtMoney } from '@/lib/utils'
import { round2 } from '@/lib/engine'

export interface PosReceiptInput {
  company: Company
  voucher: Voucher
  lines: { name: string; qty: number; shelf_rate: number }[]
  paymentLabel: string
  /** VAT-inclusive bill discount, as the cashier entered it. */
  discount?: number
  tendered?: number
  customerName?: string
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))
const row = (label: string, value: string, strong = false) => `<div class="l${strong ? ' b' : ''}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`

/** 80mm thermal receipt. Lines show shelf (VAT-inclusive) prices; totals come from the saved voucher. */
export function renderPosReceiptHtml({ company, voucher, lines, paymentLabel, discount, tendered, customerName }: PosReceiptInput): string {
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const items = lines.map(line => `<div>${esc(line.name)}</div>${row(`  ${line.qty} x ${fmtMoney(line.shelf_rate)}`, fmtMoney(round2(line.qty * line.shelf_rate)))}`).join('')
  const taxable = round2(voucher.subtotal - voucher.discount)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(voucher.invoice_no)}</title><style>
@page { size: 80mm auto; margin: 0 }
body { width: 72mm; margin: 0 auto; padding: 3mm 0; font: 12px/1.4 ui-monospace, Consolas, monospace; color: #000 }
.c { text-align: center } .b { font-weight: 700 } .l { display: flex; justify-content: space-between; gap: 4px; white-space: pre }
hr { border: 0; border-top: 1px dashed #000; margin: 4px 0 }
</style></head><body>
<div class="c b">${esc(company.name)}</div>
${company.address ? `<div class="c">${esc(company.address)}</div>` : ''}
${company.phone ? `<div class="c">${esc(company.phone)}</div>` : ''}
${company.pan_vat ? `<div class="c">PAN/VAT ${esc(company.pan_vat)}</div>` : ''}
<hr>${row(`Bill: ${voucher.invoice_no}`, time)}<div>Date: ${esc(voucher.date_bs)}</div>
${customerName ? `<div>Customer: ${esc(customerName)}</div>` : ''}
<hr>${items}<hr>
${discount ? row('Discount', `-${fmtMoney(discount)}`) : ''}
${voucher.vat_amount ? `${row('Taxable', fmtMoney(taxable))}${row(`VAT ${voucher.vat_rate}%`, fmtMoney(voucher.vat_amount))}` : ''}
${row('TOTAL', fmtMoney(voucher.total), true)}
<hr>${row(`Paid: ${paymentLabel}`, tendered !== undefined ? fmtMoney(tendered) : fmtMoney(voucher.total))}
${tendered !== undefined ? row('Change', fmtMoney(round2(tendered - voucher.total))) : ''}
${company.pos_receipt_footer ? `<hr><div class="c">${esc(company.pos_receipt_footer)}</div>` : ''}
</body></html>`
}
