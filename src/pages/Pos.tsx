import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Minus, Plus, Printer, ScanBarcode, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { addPosItem, exclusiveDiscount, findPosItemByCode, posTotals, setPosLineQty, toInvoiceItems, type PosLine } from '@/lib/pos'
import { renderPosReceiptHtml } from '@/lib/posReceipt'
import { repriceSalesLines } from '@/lib/pricing'
import { printHtmlDocument } from '@/lib/voucherPrinterRegistry'
import { selectedFiscalYearEndBs } from '@/lib/reports'
import { itemSelectorOption, partySelectorOption } from '@/lib/selectorOptions'
import { normalizeSearch } from '@/lib/search'
import { publicErrorMessage } from '@/lib/security'
import { SubmissionLock } from '@/lib/submissionLock'
import { useUnsavedChangesGuard } from '@/lib/unsavedChanges'
import { fmtMoney } from '@/lib/utils'
import type { Item } from '@/types'

type PaymentMode = 'cash' | 'qr' | 'credit'
const PAYMENT_LABEL: Record<PaymentMode, string> = { cash: 'Cash', qr: 'QR', credit: 'Credit' }

export function PosPage() {
  const { company, accounts, items, itemCategories, pricingRules, parties, getStockEntry, saveSalesVoucher } = useAppStore()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [lines, setLines] = useState<PosLine[]>([])
  const [discountInput, setDiscountInput] = useState('')
  const [error, setError] = useState('')
  const [paying, setPaying] = useState<PaymentMode | null>(null)
  const [tendered, setTendered] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastBill, setLastBill] = useState<{ html: string; invoiceNo: string; total: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const lockRef = useRef(new SubmissionLock())
  const vatRate = (company?.vat_enabled ?? true) ? 13 : 0
  const today = selectedFiscalYearEndBs(company)
  useUnsavedChangesGuard(true, lines.length > 0)

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
  const availableQty = (itemId: string) => getStockEntry(itemId).qty
  const focusSearch = () => window.setTimeout(() => searchRef.current?.focus(), 0)

  // Slab rates replace the shelf price and are treated as VAT-inclusive too.
  const pricedLines = useMemo(() => {
    const priced = repriceSalesLines({ lines: lines.map(line => ({ key: line.item_id, item_id: line.item_id, qty: line.qty, rate: Number(itemById.get(line.item_id)?.sell_rate) || 0, conversion_factor: 1 })), items, categories: itemCategories, rules: pricingRules, dateBs: today })
    return lines.map((line, index) => ({ ...line, shelf_rate: priced[index]?.rate ?? line.shelf_rate }))
  }, [lines, items, itemById, itemCategories, pricingRules, today])
  const discount = Math.max(0, Number(discountInput) || 0)
  const totals = posTotals(pricedLines, discount, vatRate)

  const results = useMemo(() => {
    const wanted = normalizeSearch(query)
    if (!wanted) return []
    return items.filter(item => !item.is_archived && normalizeSearch(itemSelectorOption(item).searchText || item.name).includes(wanted)).slice(0, 8)
  }, [items, query])
  const customers = useMemo(() => parties.filter(party => party.type === 'customer' && !party.is_archived), [parties])

  const addItem = (item: Item) => {
    const result = addPosItem(lines, item, availableQty)
    if (result.ok) { setLines(result.lines); setError('') } else setError(result.error)
    setQuery('')
    setHighlight(0)
    focusSearch()
  }

  const changeQty = (line: PosLine, qty: number) => {
    const item = itemById.get(line.item_id)
    if (!item) return
    const result = setPosLineQty(lines, line.item_id, qty, item, availableQty)
    if (result.ok) { setLines(result.lines); setError('') } else setError(result.error)
  }

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(index => Math.min(index + 1, Math.max(results.length - 1, 0))) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(index => Math.max(index - 1, 0)) }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!query.trim()) return
    const match = findPosItemByCode(items, query) || results[highlight]
    if (match) addItem(match)
    else setError(`No item found for "${query.trim()}"`)
  }

  const startPayment = (mode: PaymentMode) => {
    if (saving) return
    if (!lines.length) { setError('Add an item first'); focusSearch(); return }
    if (mode === 'qr' && !company?.pos_qr_account_id) { setError('Set the QR payment ledger in Settings first'); return }
    setError('')
    setTendered('')
    setPaying(mode)
  }

  const cancelPayment = () => { setPaying(null); focusSearch() }

  const complete = async () => {
    if (!company || !paying || !lines.length) return
    if (discount > totals.shelfTotal) { setError('The discount cannot be more than the items total'); return }
    const tenderedAmount = paying === 'cash' && tendered.trim() ? Number(tendered) : undefined
    if (tenderedAmount !== undefined && !(tenderedAmount >= totals.total)) { setError('Tendered is less than the total'); return }
    if (paying === 'credit' && !customerId) { setError('Select a customer for a credit bill'); return }
    if (!lockRef.current.tryAcquire()) return
    setSaving(true)
    setError('')
    try {
      const customer = paying === 'credit' ? customers.find(party => party.account_id === customerId) : undefined
      const voucher = await saveSalesVoucher({
        party_account_id: customer?.account_id ?? null,
        is_cash: paying !== 'credit',
        settlement_account_id: paying === 'qr' ? company.pos_qr_account_id : null,
        items: toInvoiceItems(pricedLines, vatRate),
        discount: exclusiveDiscount(discount, vatRate),
        vat_rate: vatRate,
        credit_days: customer?.default_credit_days ?? 0,
        narration: 'POS',
        date_bs: today,
      }, 'Completed')
      const qrLedger = accounts.find(account => account.id === company.pos_qr_account_id)
      const html = renderPosReceiptHtml({ company, voucher, lines: pricedLines, discount, paymentLabel: paying === 'qr' ? qrLedger?.name || 'QR' : PAYMENT_LABEL[paying], tendered: tenderedAmount, customerName: customer?.name })
      printHtmlDocument(html)
      setLastBill({ html, invoiceNo: voucher.invoice_no || "", total: voucher.total })
      setLines([])
      setDiscountInput('')
      setCustomerId('')
      setPaying(null)
      focusSearch()
    } catch (saveError) {
      setError(publicErrorMessage(saveError, 'saving POS bill'))
    } finally {
      lockRef.current.release()
      setSaving(false)
    }
  }

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {})
  keyHandler.current = event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const keys: Record<string, () => void> = {
      F9: () => startPayment('cash'), F8: () => startPayment('qr'), F7: () => startPayment('credit'),
      F4: () => { if (lastBill) printHtmlDocument(lastBill.html) },
      Escape: () => { if (paying) cancelPayment() },
    }
    const action = keys[event.key]
    if (!action) return
    event.preventDefault()
    if (!event.repeat) action()
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  useEffect(() => { searchRef.current?.focus() }, [])

  const change = paying === 'cash' && tendered.trim() ? Number(tendered) - totals.total : null

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b bg-slate-900 px-4 py-2.5 text-slate-200">
        <span className="font-semibold text-white">KhataERP POS</span>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs">{company?.name}</span>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs">{today}</span>
        <Link to="/" className="ml-auto inline-flex items-center gap-1 text-sm text-blue-200 hover:underline"><ArrowLeft className="h-4 w-4" />Back to ERP</Link>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className="border-b p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 rounded-lg border-2 border-primary px-3 py-2">
            <ScanBarcode className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); setHighlight(0) }} onKeyDown={onSearchKeyDown} disabled={!!paying} aria-label="Scan barcode or search item" placeholder="Scan barcode or type item name / SKU" className="w-full bg-transparent text-base outline-none" />
          </div>
          {results.length > 0 && (
            <ul className="mt-1.5 overflow-hidden rounded-lg border" role="listbox" aria-label="Matching items">
              {results.map((item, index) => (
                <li key={item.id} role="option" aria-selected={index === highlight}>
                  <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => addItem(item)} className={`flex w-full justify-between border-t px-3 py-2 text-left text-sm first:border-t-0 ${index === highlight ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`}>
                    <span>{item.name}<span className="ml-2 text-xs text-muted-foreground">{item.sku ? `SKU ${item.sku} · ` : ''}{item.is_service ? 'Service' : `${getStockEntry(item.id).qty} ${item.unit}`}</span></span>
                    <span className="font-semibold">Rs {fmtMoney(item.sell_rate)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="mt-2.5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <p className="mt-3 text-xs text-muted-foreground">↑↓ to choose, Enter to add. A scanned barcode adds the item straight away; scanning again adds one more.</p>
        </section>

        <section className="flex flex-col gap-2 bg-muted/20 p-4">
          <div className="flex items-center justify-between"><span className="font-semibold">Current bill · {lines.length} item{lines.length === 1 ? '' : 's'}</span><span className="text-xs text-muted-foreground">Walk-in customer</span></div>
          <div className="flex-1">
            {pricedLines.map(line => (
              <div key={line.item_id} className="grid grid-cols-[minmax(0,1fr)_120px_76px_24px] items-center gap-2 border-b py-2 text-sm">
                <div className="min-w-0"><div className="truncate">{line.name}</div><div className="text-xs text-muted-foreground">Rs {fmtMoney(line.shelf_rate)} × {line.qty}</div></div>
                <div className="flex items-center overflow-hidden rounded-md border bg-background">
                  <button type="button" tabIndex={-1} aria-label={`Decrease ${line.name}`} className="px-2 py-1 text-muted-foreground hover:bg-muted" onClick={() => changeQty(line, line.qty - 1)}><Minus className="h-3.5 w-3.5" /></button>
                  <input type="number" min="0" step="any" aria-label={`Quantity of ${line.name}`} value={line.qty} onChange={event => changeQty(line, Number(event.target.value))} onWheel={event => event.currentTarget.blur()} className="w-full min-w-0 border-x bg-transparent py-1 text-center outline-none" />
                  <button type="button" tabIndex={-1} aria-label={`Increase ${line.name}`} className="px-2 py-1 text-muted-foreground hover:bg-muted" onClick={() => changeQty(line, line.qty + 1)}><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <div className="text-right tabular-nums">{fmtMoney(line.qty * line.shelf_rate)}</div>
                <button type="button" tabIndex={-1} aria-label={`Remove ${line.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => changeQty(line, 0)}><X className="h-4 w-4" /></button>
              </div>
            ))}
            {!lines.length && <p className="py-8 text-center text-sm text-muted-foreground">Scan an item to start a bill.</p>}
          </div>

          <div className="flex justify-between text-sm text-muted-foreground"><span>Items total</span><span className="tabular-nums">{fmtMoney(totals.shelfTotal)}</span></div>
          <label className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>Discount (Rs)</span><Input type="number" min="0" step="any" value={discountInput} onChange={event => setDiscountInput(event.target.value)} onWheel={event => event.currentTarget.blur()} className="h-8 w-28 text-right" placeholder="0" /></label>
          {vatRate > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>incl. VAT {vatRate}%</span><span className="tabular-nums">{fmtMoney(totals.vat)}</span></div>}
          <div className="flex justify-between border-t-2 border-foreground pt-1.5 text-3xl font-bold tabular-nums"><span>Total</span><span>Rs {fmtMoney(totals.total)}</span></div>

          {paying ? (
            <form className="space-y-2 rounded-lg border bg-background p-3" onSubmit={event => { event.preventDefault(); void complete() }}>
              <div className="flex items-center justify-between"><span className="font-semibold">{PAYMENT_LABEL[paying]} payment</span><button type="button" aria-label="Cancel payment" onClick={cancelPayment} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>
              {paying === 'cash' && <>
                <Input autoFocus type="number" min="0" step="any" value={tendered} onChange={event => setTendered(event.target.value)} placeholder={`Tendered (empty = exact ${fmtMoney(totals.total)})`} className="h-11 text-lg" />
                {change !== null && change >= 0 && <div className="flex justify-between rounded-md bg-emerald-50 px-3 py-2 text-lg font-bold text-emerald-700"><span>Change</span><span>Rs {fmtMoney(change)}</span></div>}
              </>}
              {paying === 'qr' && <p className="text-sm">Payment received on {accounts.find(account => account.id === company?.pos_qr_account_id)?.name || 'QR'}?</p>}
              {paying === 'credit' && <SearchableSelect autoFocus value={customerId} onValueChange={setCustomerId} placeholder="Select customer" searchPlaceholder="Search customer…" options={customers.map(party => partySelectorOption(party, accounts.find(account => account.id === party.account_id)))} />}
              <Button type="submit" autoFocus={paying === 'qr'} disabled={saving} className="w-full">{saving ? 'Saving…' : 'Confirm and print (Enter)'}</Button>
            </form>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Button className="h-14 flex-col" onClick={() => startPayment('cash')}>Cash<span className="text-xs font-normal opacity-80">F9</span></Button>
              <Button variant="outline" className="h-14 flex-col" onClick={() => startPayment('qr')}>QR<span className="text-xs font-normal text-muted-foreground">F8</span></Button>
              <Button variant="outline" className="h-14 flex-col" onClick={() => startPayment('credit')}>Credit<span className="text-xs font-normal text-muted-foreground">F7</span></Button>
            </div>
          )}
          {lastBill && <button type="button" onClick={() => printHtmlDocument(lastBill.html)} className="inline-flex items-center gap-1.5 self-start rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"><Printer className="h-3.5 w-3.5" />Reprint {lastBill.invoiceNo} · Rs {fmtMoney(lastBill.total)} (F4)</button>}
        </section>
      </main>
    </div>
  )
}
