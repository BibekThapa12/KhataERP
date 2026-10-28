import { describe, expect, it } from 'vitest'
import type { Company, Voucher } from '@/types'
import { fmtMoney } from './utils'
import { renderPosReceiptHtml, type PosReceiptInput } from './posReceipt'

const input = (overrides: Partial<PosReceiptInput> = {}): PosReceiptInput => ({
  company: { id: 'A', name: 'Bibek Kirana', user_id: 'u', fiscal_year_start: '2083-04-01', pos_receipt_footer: 'Thank you, visit again' } as Company,
  voucher: { id: 'v', invoice_no: 'SI-0391', date_bs: '2083-07-10', subtotal: 371.68, discount: 0, vat_rate: 13, vat_amount: 48.32, total: 420 } as Voucher,
  lines: [{ name: 'Wai Wai', qty: 4, shelf_rate: 25 }],
  paymentLabel: 'Cash',
  ...overrides,
})

describe('renderPosReceiptHtml', () => {
  it('prints the bill number, company, total and footer', () => {
    const html = renderPosReceiptHtml(input())
    expect(html).toContain('SI-0391')
    expect(html).toContain('Bibek Kirana')
    expect(html).toContain(fmtMoney(420))
    expect(html).toContain('Thank you, visit again')
  })

  it('shows change only when tendered is given', () => {
    expect(renderPosReceiptHtml(input({ tendered: 500 }))).toContain(`Change</span><span>${fmtMoney(80)}`)
    expect(renderPosReceiptHtml(input())).not.toContain('Change')
  })

  it('escapes item names', () => {
    const html = renderPosReceiptHtml(input({ lines: [{ name: '<b>x</b>', qty: 1, shelf_rate: 1 }] }))
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })
})
