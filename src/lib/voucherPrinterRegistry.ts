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

export function printHtmlDocument(html: string): boolean {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.style.opacity = '0'
  frame.style.pointerEvents = 'none'
  document.body.appendChild(frame)
  const win = frame.contentWindow
  if (!win) {
    frame.remove()
    return false
  }

  win.document.open()
  win.document.write(html)
  win.document.close()
  let printStarted = false
  const cleanup = () => frame.remove()
  const printWhenReady = () => {
    if (printStarted || !frame.isConnected) return
    printStarted = true
    const images = Array.from(win.document.images)
    const imageReady = images.map(image => image.complete
      ? Promise.resolve()
      : new Promise<void>(resolve => {
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        }))
    void Promise.all(imageReady).then(() => {
      win.focus()
      win.print()
    })
  }
  win.addEventListener('afterprint', cleanup, { once: true })
  if (win.document.readyState === 'complete') window.setTimeout(printWhenReady, 25)
  else win.addEventListener('load', printWhenReady, { once: true })
  window.setTimeout(printWhenReady, 1000)
  window.setTimeout(cleanup, 60_000)
  return true
}

export function printPersistedVouchers(vouchers: Voucher[]): boolean {
  if (!vouchers.length || !activeRenderer) return false

  const documents = vouchers.map(voucher => new DOMParser().parseFromString(activeRenderer!(voucher), 'text/html'))
  const first = documents[0]
  const styles = Array.from(first.head.querySelectorAll('style')).map(style => style.outerHTML).join('')
  const pages = documents.map((document, index) => {
    const sheet = document.querySelector('main.sheet')
    return `<section class="bulk-voucher-page${index === documents.length - 1 ? ' last' : ''}">${sheet?.outerHTML || document.body.innerHTML}</section>`
  }).join('')
  const title = vouchers.length === 1 ? `${vouchers[0].type} voucher` : `${vouchers.length} selected vouchers`
  return printHtmlDocument(`<!doctype html><html><head><title>${title}</title>${styles}<style>.bulk-voucher-page{break-after:page;page-break-after:always}.bulk-voucher-page.last{break-after:auto;page-break-after:auto}</style></head><body>${pages}</body></html>`)
}
