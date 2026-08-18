import type { Voucher } from '@/types'

type VoucherPrinter = (voucher: Voucher, targetWindow?: Window) => void
type VoucherRenderer = (voucher: Voucher) => string
let activePrinter: VoucherPrinter | null = null
let activeRenderer: VoucherRenderer | null = null

export function registerVoucherPrinter(printer: VoucherPrinter, renderer?: VoucherRenderer) {
  activePrinter = printer
  activeRenderer = renderer || null
}

export function printPersistedVoucher(voucher: Voucher, targetWindow?: Window) {
  activePrinter?.(voucher, targetWindow)
}

export function printPersistedVouchers(vouchers: Voucher[], targetWindow?: Window): boolean {
  if (!vouchers.length || !activeRenderer) return false
  const win = targetWindow || window.open('', '_blank', 'width=800,height=900')
  if (!win) return false

  const documents = vouchers.map(voucher => new DOMParser().parseFromString(activeRenderer!(voucher), 'text/html'))
  const first = documents[0]
  const styles = Array.from(first.head.querySelectorAll('style')).map(style => style.outerHTML).join('')
  const pages = documents.map((document, index) => {
    const sheet = document.querySelector('main.sheet')
    return `<section class="bulk-voucher-page${index === documents.length - 1 ? ' last' : ''}">${sheet?.outerHTML || document.body.innerHTML}</section>`
  }).join('')
  const title = vouchers.length === 1 ? `${vouchers[0].type} voucher` : `${vouchers.length} selected vouchers`
  win.document.write(`<!doctype html><html><head><title>${title}</title>${styles}<style>.bulk-voucher-page{break-after:page;page-break-after:always}.bulk-voucher-page.last{break-after:auto;page-break-after:auto}</style></head><body>${pages}</body></html>`)
  win.document.close()

  let printStarted = false
  const printWhenReady = () => {
    if (printStarted || win.closed) return
    printStarted = true
    win.focus()
    win.print()
  }
  if (win.document.readyState === 'complete') window.setTimeout(printWhenReady, 50)
  else win.addEventListener('load', printWhenReady, { once: true })
  window.setTimeout(printWhenReady, 800)
  return true
}
