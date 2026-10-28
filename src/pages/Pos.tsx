import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Minus, Plus, Printer, ScanBarcode, ShoppingBasket, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { PosRecentBills, usePosPaymentLabel } from '@/components/pos/PosRecentBills'
import { addPosItem, checkTendered, exclusiveDiscount, findPosItemByCode, posBillDate, posTotals, qtyFromInput, receiptLinesFromVoucher, recentPosBills, setPosLineQty, toInvoiceItems, type PosLine } from '@/lib/pos'
import { renderPosReceiptHtml } from '@/lib/posReceipt'
import { repriceSalesLines } from '@/lib/pricing'
import { printHtmlDocument } from '@/lib/voucherPrinterRegistry'
import { selectedFiscalYearStartBs } from '@/lib/reports'
import { todayBs } from '@/lib/nepaliDate'
import { itemSelectorOption, partySelectorOption } from '@/lib/selectorOptions'
import { normalizeSearch } from '@/lib/search'
import { publicErrorMessage } from '@/lib/security'
import { SubmissionLock } from '@/lib/submissionLock'
import { useUnsavedChangesGuard } from '@/lib/unsavedChanges'
import { savedVoucherNumber } from '@/lib/voucherNumbers'
import { fmtMoney } from '@/lib/utils'
import { formatStockQuantity } from '@/lib/units'
import type { Item, Voucher } from '@/types'

type PaymentMode = 'cash' | 'qr' | 'credit'
const PAYMENT_LABEL: Record<PaymentMode, string> = { cash: 'Cash', qr: 'QR', credit: 'Credit' }
const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] font-semibold text-foreground">{children}</kbd>

export function PosPage() {
  const { company, accounts, items, itemCategories, pricingRules, parties, vouchers, getStockEntry, getItem, saveSalesVoucher } = useAppStore()
  const paymentLabel = usePosPaymentLabel()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [lines, setLines] = useState<PosLine[]>([])
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({})
  const [discountInput, setDiscountInput] = useState('')
  const [error, setError] = useState('')
  const [paying, setPaying] = useState<PaymentMode | null>(null)
  const [tendered, setTendered] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [saving, setSaving] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const lockRef = useRef(new SubmissionLock())
  const vatRate = (company?.vat_enabled ?? true) ? 13 : 0
  const billDate = posBillDate(todayBs(), selectedFiscalYearStartBs(company))
  const today = billDate.dateBs || todayBs()
  useUnsavedChangesGuard(true, lines.length > 0)

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
  const availableQty = (itemId: string) => getStockEntry(itemId).qty
  const focusSearch = () => window.setTimeout(() => searchRef.current?.focus(), 0)
  const recentBills = useMemo(() => recentPosBills(vouchers, today), [vouchers, today])
  const lastBill = recentBills.find(voucher => !voucher.cancelled)
  const qrLedgerName = accounts.find(account => account.id === company?.pos_qr_account_id)?.name

  // Slab rates replace the shelf price and are treated as VAT-inclusive too.
  const pricedLines = useMemo(() => {
    const priced = repriceSalesLines({ lines: lines.map(line => ({ key: line.item_id, item_id: line.item_id, qty: line.qty, rate: Number(itemById.get(line.item_id)?.sell_rate) || 0, conversion_factor: 1 })), items, categories: itemCategories, rules: pricingRules, dateBs: today })
    return lines.map((line, index) => ({ ...line, shelf_rate: priced[index]?.rate ?? line.shelf_rate }))
  }, [lines, items, itemById, itemCategories, pricingRules, today])
  const discount = Math.max(0, Number(discountInput) || 0)
  const totals = posTotals(pricedLines, discount, vatRate)
  const itemCount = pricedLines.reduce((sum, line) => sum + line.qty, 0)

  const results = useMemo(() => {
    const wanted = normalizeSearch(query)
    if (!wanted) return []
    return items.filter(item => !item.is_archived && normalizeSearch(itemSelectorOption(item).searchText || item.name).includes(wanted)).slice(0, 8)
  }, [items, query])
  const customers = useMemo(() => parties.filter(party => party.type === 'customer' && !party.is_archived), [parties])
  const [searchFocused, setSearchFocused] = useState(false)
  const showResults = searchFocused && results.length > 0

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
    if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery(''); setHighlight(0) }
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

  const reprint = (voucher: Voucher) => {
    if (!company) return
    const factor = 1 + (Number(voucher.vat_rate) || 0) / 100
    const customerName = !voucher.is_cash && voucher.party_account_id ? parties.find(party => party.account_id === voucher.party_account_id)?.name : undefined
    printHtmlDocument(renderPosReceiptHtml({ company, voucher, lines: receiptLinesFromVoucher(voucher, id => getItem(id)?.name || 'Item'), discount: Math.round((voucher.discount || 0) * factor * 100) / 100, paymentLabel: paymentLabel(voucher).replace(/^Credit · .*/, 'Credit'), customerName }))
  }

  const complete = async () => {
    if (!company || !paying || !lines.length) return
    if (billDate.error) { setError(billDate.error); return }
    if (discount > totals.shelfTotal) { setError('The discount cannot be more than the items total'); return }
    const cash = paying === 'cash' ? checkTendered(tendered, totals.total) : {}
    if (cash.error) { setError(cash.error); return }
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
      printHtmlDocument(renderPosReceiptHtml({ company, voucher, lines: pricedLines, discount, paymentLabel: paying === 'qr' ? qrLedgerName || 'QR' : PAYMENT_LABEL[paying], tendered: cash.tendered, customerName: customer?.name }))
      setLines([])
      setQtyDrafts({})
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
    // A bill view, edit form or cancel confirmation owns the keyboard while it is open.
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
    const keys: Record<string, () => void> = {
      F9: () => startPayment('cash'), F7: () => startPayment('credit'),
      // QR is confirmed with a second F8, never Enter: a scanner's trailing Enter must not mark a bill as paid.
      F8: () => { if (paying === 'qr') void complete(); else startPayment('qr') },
      F4: () => { if (lastBill) reprint(lastBill) },
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

  const change = paying === 'cash' && tendered.trim() ? checkTendered(tendered, totals.total).change ?? null : null

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-primary px-4 py-2.5 text-primary-foreground">
        <span className="font-serif text-base font-bold tracking-tight">KhataERP <span className="font-sans text-sm font-medium opacity-80">POS</span></span>
        <span className="h-4 w-px bg-primary-foreground/25" aria-hidden="true" />
        <span className="truncate text-sm opacity-90">{company?.name}</span>
        <span className="rounded bg-primary-foreground/10 px-2 py-0.5 text-xs tabular-nums">{today}</span>
        <Link to="/" className="ml-auto inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm opacity-90 hover:bg-primary-foreground/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-4 w-4" />Back to ERP</Link>
      </header>
      {billDate.error && <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{billDate.error}</p>}

      {/* DOM order is search, bill, recent bills so phones reach the bill before history; md+ places history under search. */}
      <main className="grid flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.35fr)_minmax(340px,1fr)] md:grid-rows-[auto_1fr]">
        <section className="p-4 md:col-start-1 md:row-start-1 md:border-r lg:p-5">
          <div className="relative">
            <div className="flex h-12 items-center gap-2.5 rounded-lg border-2 border-primary/70 bg-card px-3 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/40">
              <ScanBarcode className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <input ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); setHighlight(0) }} onKeyDown={onSearchKeyDown} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} disabled={!!paying} role="combobox" aria-expanded={showResults} aria-autocomplete="list" aria-label="Scan barcode or search item" aria-controls="pos-search-results" placeholder={paying ? 'Finish or cancel the payment to add items' : 'Scan barcode or type item name or SKU'} className="h-full w-full bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed" />
            </div>
            {showResults && (
              <ul id="pos-search-results" className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain rounded-lg border bg-card shadow-[0_12px_32px_-12px_hsl(var(--primary)/0.28),0_2px_6px_-2px_hsl(var(--primary)/0.12)]" role="listbox" aria-label="Matching items">
                {results.map((item, index) => (
                  <li key={item.id} role="option" aria-selected={index === highlight}>
                    <button type="button" onMouseDown={event => event.preventDefault()} onMouseEnter={() => setHighlight(index)} onClick={() => addItem(item)} className={`flex w-full items-center justify-between gap-3 border-t px-3 py-2 text-left text-sm first:border-t-0 ${index === highlight ? 'bg-accent' : ''}`}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.sku ? `SKU ${item.sku} · ` : ''}{item.is_service ? 'Service' : `${formatStockQuantity(getStockEntry(item.id).qty, item)} in stock`}</span>
                      </span>
                      {Number(item.sell_rate) > 0 ? <span className="shrink-0 font-semibold tabular-nums">{fmtMoney(item.sell_rate)}</span> : <span className="shrink-0 text-xs text-muted-foreground">No price set</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && <p role="alert" className="mt-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <p className="mt-2.5 hidden flex-wrap items-center gap-x-1.5 md:flex gap-y-1 text-xs text-muted-foreground"><Kbd>↑</Kbd><Kbd>↓</Kbd> choose · <Kbd>Enter</Kbd> add · scan again for one more</p>
        </section>

        <section aria-label="Current bill" className="flex flex-col border-y bg-card/60 p-4 md:col-start-2 md:row-span-2 md:row-start-1 md:border-y-0 lg:p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <h1 className="text-base font-semibold">Current bill</h1>
            <span className="text-xs text-muted-foreground">{lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'} · ${itemCount} qty` : 'Walk-in customer'}</span>
          </div>

          <div className="flex-1">
            {pricedLines.map(line => (
              <div key={line.item_id} className="grid grid-cols-[minmax(0,1fr)_112px_80px_28px] items-center gap-2 border-b py-2 text-sm">
                <div className="min-w-0"><div className="truncate font-medium">{line.name}</div><div className="text-xs tabular-nums text-muted-foreground">{fmtMoney(line.shelf_rate)} × {line.qty}</div></div>
                <div className="flex h-8 items-center overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring/50">
                  <button type="button" tabIndex={-1} aria-label={`Decrease ${line.name}`} className="flex h-full w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => changeQty(line, line.qty - 1)}><Minus className="h-3.5 w-3.5" /></button>
                  <input type="number" min="0" step="any" aria-label={`Quantity of ${line.name}`} value={qtyDrafts[line.item_id] ?? line.qty} onChange={event => { const text = event.target.value; setQtyDrafts(drafts => ({ ...drafts, [line.item_id]: text })); const qty = qtyFromInput(text); if (qty !== null) changeQty(line, qty) }} onBlur={() => setQtyDrafts(({ [line.item_id]: _done, ...rest }) => rest)} onWheel={event => event.currentTarget.blur()} className="h-full w-full min-w-0 border-x bg-transparent text-center tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                  <button type="button" tabIndex={-1} aria-label={`Increase ${line.name}`} className="flex h-full w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => changeQty(line, line.qty + 1)}><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <div className="text-right font-medium tabular-nums">{fmtMoney(line.qty * line.shelf_rate)}</div>
                <button type="button" tabIndex={-1} aria-label={`Remove ${line.name}`} className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => changeQty(line, 0)}><X className="h-4 w-4" /></button>
              </div>
            ))}
            {!lines.length && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
                <ShoppingBasket className="h-8 w-8 opacity-60" aria-hidden="true" />
                <p className="text-sm">Scan an item to start a bill.</p>
              </div>
            )}
          </div>

          <div className="mt-3 space-y-1.5 border-t pt-3">
            <div className="flex justify-between text-sm text-muted-foreground"><span>Items total</span><span className="tabular-nums">{fmtMoney(totals.shelfTotal)}</span></div>
            <label className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>Discount (Rs)</span><Input type="number" min="0" step="any" value={discountInput} onChange={event => setDiscountInput(event.target.value)} onWheel={event => event.currentTarget.blur()} className="h-8 w-28 text-right tabular-nums" placeholder="0" /></label>
            {vatRate > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Includes VAT {vatRate}%</span><span className="tabular-nums">{fmtMoney(totals.vat)}</span></div>}
            <div className="flex items-baseline justify-between border-t-2 border-primary pt-2"><span className="text-base font-semibold">Total</span><span className="font-serif text-4xl font-bold tabular-nums tracking-tight text-primary">{fmtMoney(totals.total)}</span></div>
          </div>

          <div className="mt-3">
            {paying ? (
              <form className="space-y-2.5 rounded-lg border-2 border-primary/60 bg-background p-3" onSubmit={event => { event.preventDefault(); void complete() }}>
                <div className="flex items-center justify-between"><span className="font-semibold">{PAYMENT_LABEL[paying]} payment</span><button type="button" aria-label="Cancel payment (Esc)" onClick={cancelPayment} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Kbd>Esc</Kbd><X className="h-4 w-4" /></button></div>
                {paying === 'cash' && <>
                  <label className="block text-xs text-muted-foreground" htmlFor="pos-tendered">Tendered (leave empty for exact amount)</label>
                  <Input id="pos-tendered" autoFocus type="number" min="0" step="any" inputMode="decimal" value={tendered} onChange={event => setTendered(event.target.value)} placeholder={fmtMoney(totals.total)} className="h-12 text-xl font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                  {change !== null && <div className="flex justify-between rounded-md bg-emerald-50 px-3 py-2 text-lg font-bold text-emerald-800"><span>Change</span><span className="tabular-nums">{fmtMoney(change)}</span></div>}
                </>}
                {paying === 'qr' && <p className="text-sm">Check that {fmtMoney(totals.total)} has arrived on <strong>{qrLedgerName || 'QR'}</strong>, then press <Kbd>F8</Kbd> again or confirm.</p>}
                {paying === 'credit' && <SearchableSelect autoFocus value={customerId} onValueChange={setCustomerId} placeholder="Select customer" searchPlaceholder="Search customer…" options={customers.map(party => partySelectorOption(party, accounts.find(account => account.id === party.account_id)))} />}
                <Button type="submit" disabled={saving} className="h-11 w-full text-base">{saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving bill…</> : <>Confirm and print <span className="ml-2 opacity-80"><Kbd>{paying === 'qr' ? 'F8' : 'Enter'}</Kbd></span></>}</Button>
              </form>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Button className="h-14 flex-col gap-1 text-base" onClick={() => startPayment('cash')}>Cash<span className="text-[10px] font-semibold opacity-75">F9</span></Button>
                <Button variant="outline" className="h-14 flex-col gap-1 text-base" onClick={() => startPayment('qr')}>QR<span className="text-[10px] font-semibold text-muted-foreground">F8</span></Button>
                <Button variant="outline" className="h-14 flex-col gap-1 text-base" onClick={() => startPayment('credit')}>Credit<span className="text-[10px] font-semibold text-muted-foreground">F7</span></Button>
              </div>
            )}
            {lastBill && !paying && <button type="button" onClick={() => reprint(lastBill)} className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><Printer className="h-3.5 w-3.5" />Reprint {savedVoucherNumber(lastBill)} · {fmtMoney(lastBill.total)} <Kbd>F4</Kbd></button>}
          </div>
        </section>

        <div className="px-4 pb-6 md:col-start-1 md:row-start-2 md:border-r lg:px-5">
          <PosRecentBills bills={recentBills} onReprint={reprint} onError={message => { setError(message); window.scrollTo({ top: 0 }) }} />
        </div>
      </main>
    </div>
  )
}
