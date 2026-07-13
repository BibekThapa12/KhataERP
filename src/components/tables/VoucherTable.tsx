import { useState } from 'react'
import { Edit2, Eye, Printer, XCircle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { logAppEvent } from '@/lib/supabase'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Voucher } from '@/types'
import { legacySettlementAccountId } from '@/lib/banks'

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))

function voucherBadgeVariant(type: string, cancelled: boolean) {
  if (cancelled) return 'cancelled' as const
  const map: Record<string, 'sales' | 'purchase' | 'receipt' | 'payment' | 'journal'> = {
    Sales: 'sales', Purchase: 'purchase', 'Sales Return': 'sales', 'Purchase Return': 'purchase', Receipt: 'receipt', Payment: 'payment', Journal: 'journal',
  }
  return map[type] ?? 'default' as const
}

function VoucherDetail({ voucher }: { voucher: Voucher }) {
  const { company, vouchers, getAccount, getItem, getPartyByAccountId } = useAppStore()
  const vatEnabled = company?.vat_enabled ?? true
  const settlementId = legacySettlementAccountId(voucher)
  const allocationNames = (voucher.type === 'Receipt' || voucher.type === 'Payment') ? (voucher.lines || []).filter(line => line.account_id !== settlementId).map(line => getPartyByAccountId(line.account_id)?.name || getAccount(line.account_id)?.name || line.account_id) : []
  const allocationLabel = allocationNames.length ? `${allocationNames[0]}${allocationNames.length > 1 ? ` + ${allocationNames.length - 1} more` : ''}` : ''
  const partyName = allocationLabel || (voucher.party_account_id
    ? getPartyByAccountId(voucher.party_account_id)?.name ?? getAccount(voucher.party_account_id)?.name
    : getAccount(settlementId || '')?.name || (voucher.is_cash ? 'Cash' : '—'))
  const settlementName = getAccount(settlementId || '')?.name

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Date</p><p className="font-medium mt-0.5">{fmtDate(voucher.date_bs)}</p></div>
        {(voucher.type === 'Sales' || voucher.type === 'Purchase') && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Credit Days</p><p className="font-medium mt-0.5">{voucher.credit_days ?? 0}</p></div>}
        {(voucher.type === 'Sales' || voucher.type === 'Purchase') && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Due Date</p><p className="font-medium mt-0.5">{fmtDate(voucher.due_date_bs || voucher.date_bs)}</p></div>}
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Party</p><p className="font-medium mt-0.5">{partyName}</p></div>
        {settlementName && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Settlement Account</p><p className="font-medium mt-0.5">{settlementName}</p></div>}
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Total</p><p className="font-serif font-bold mt-0.5 num">{fmtMoney(voucher.total)}</p></div>
      </div>

      {voucher.invoice_items && voucher.invoice_items.length > 0 ? (
        <>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Item</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Qty</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Rate</th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {voucher.invoice_items.map((it, i) => {
                const item = getItem(it.item_id)
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2">{it.item_name || item?.name || it.item_id}</td>
                    <td className="px-3 py-2 text-right num">{it.qty}</td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(it.rate)}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(it.qty * it.rate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="text-sm space-y-1 pt-2 border-t border-border">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="num">{fmtMoney(voucher.subtotal)}</span></div>
            {(voucher.discount ?? 0) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="num">- {fmtMoney(voucher.discount)}</span></div>}
            {vatEnabled && <div className="flex justify-between"><span className="text-muted-foreground">VAT ({voucher.vat_rate}%)</span><span className="num">{fmtMoney(voucher.vat_amount)}</span></div>}
            <div className="flex justify-between font-serif font-bold text-base pt-1 border-t border-border"><span>Total</span><span className="num">{fmtMoney(voucher.total)}</span></div>
          </div>
        </>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Account</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Debit</th>
              <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 py-2 font-semibold">Credit</th>
            </tr>
          </thead>
          <tbody>
            {(voucher.lines ?? []).map((l, i) => {
              const acc = getAccount(l.account_id)
              return (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2">{acc?.name ?? l.account_id}</td>
                  <td className="px-3 py-2 text-right num">{l.debit ? <span className="debit-amt">{fmtMoney(l.debit)}</span> : '—'}</td>
                  <td className="px-3 py-2 text-right num">{l.credit ? <span className="credit-amt">{fmtMoney(l.credit)}</span> : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {voucher.narration && (
        <p className="text-sm text-muted-foreground italic border-t border-border pt-2">
          Note: {voucher.narration}
        </p>
      )}
      {voucher.original_voucher_id && (
        <p className="text-sm text-muted-foreground border-t border-border pt-2">
          Original document: {vouchers.find(entry => entry.id === voucher.original_voucher_id)?.invoice_no || voucher.original_voucher_id}
        </p>
      )}
    </div>
  )
}

interface VoucherTableProps {
  vouchers: Voucher[]
  showActions?: boolean
  onEdit?: (voucher: Voucher) => void
}

export function VoucherTable({ vouchers, showActions = true, onEdit }: VoucherTableProps) {
  const cancelV = useAppStore(s => s.cancelV)
  const company = useAppStore(s => s.company)
  const getAccount = useAppStore(s => s.getAccount)
  const getItem = useAppStore(s => s.getItem)
  const getPartyByAccountId = useAppStore(s => s.getPartyByAccountId)
  const allVouchers = useAppStore(s => s.vouchers)
  const [detail, setDetail] = useState<Voucher | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const printVoucher = (voucher: Voucher) => {
    const party = voucher.party_account_id
      ? getPartyByAccountId(voucher.party_account_id)
      : null
    const settlementId = legacySettlementAccountId(voucher)
    const settlementName = getAccount(settlementId || '')?.name
    const allocationNames = (voucher.type === 'Receipt' || voucher.type === 'Payment') ? (voucher.lines || []).filter(line => line.account_id !== settlementId).map(line => getPartyByAccountId(line.account_id)?.name || getAccount(line.account_id)?.name || line.account_id) : []
    const partyName = allocationNames.length ? allocationNames.join(', ') : party ? `${party.name}${settlementName ? ` / ${settlementName}` : ''}` : settlementName || (voucher.is_cash ? 'Cash' : '-')
    const invoiceRows = (voucher.invoice_items || []).map((it, index) => {
      const item = getItem(it.item_id)
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${esc(it.item_name || item?.name || it.item_id)}</td>
          <td class="right">${esc(it.qty)}</td>
          <td class="right">${esc(fmtMoney(it.rate))}</td>
          <td class="right">${esc(fmtMoney(it.qty * it.rate))}</td>
        </tr>
      `
    }).join('')
    const ledgerRows = (voucher.lines || []).map((line, index) => {
      const account = getAccount(line.account_id)
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${esc(account?.name || line.account_id)}</td>
          <td class="right">${line.debit ? esc(fmtMoney(line.debit)) : '-'}</td>
          <td class="right">${line.credit ? esc(fmtMoney(line.credit)) : '-'}</td>
        </tr>
      `
    }).join('')
    const isInvoice = (voucher.invoice_items || []).length > 0
    const vatEnabled = company?.vat_enabled ?? true
    const rows = isInvoice ? invoiceRows : ledgerRows
    const head = isInvoice
      ? '<tr><th>#</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>'
      : '<tr><th>#</th><th>Account</th><th>Debit</th><th>Credit</th></tr>'
    const totals = isInvoice ? `
      <div class="totals">
        <div><span>Subtotal</span><strong>${esc(fmtMoney(voucher.subtotal))}</strong></div>
        <div><span>Discount</span><strong>${esc(fmtMoney(voucher.discount || 0))}</strong></div>
        ${vatEnabled ? `<div><span>VAT (${esc(voucher.vat_rate || 0)}%)</span><strong>${esc(fmtMoney(voucher.vat_amount || 0))}</strong></div>` : ''}
        <div class="grand"><span>Total</span><strong>${esc(fmtMoney(voucher.total))}</strong></div>
      </div>
    ` : `
      <div class="totals">
        <div class="grand"><span>Total</span><strong>${esc(fmtMoney(voucher.total))}</strong></div>
      </div>
    `
    const printFormat = company?.print_format || 'A5'
    const originalVoucher = voucher.original_voucher_id ? allVouchers.find(entry => entry.id === voucher.original_voucher_id) : null
    const documentTitle = voucher.type === 'Sales Return' && vatEnabled
      ? 'Credit Note'
      : voucher.type === 'Purchase Return' && vatEnabled
        ? 'Debit Note'
        : voucher.type
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>${esc(documentTitle)} ${esc(voucher.invoice_no || voucher.seq)}</title>
          <style>
            @page { size: ${esc(printFormat)}; margin: 10mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #111827; font-family: Arial, sans-serif; font-size: 11px; }
            .sheet { width: 100%; min-height: 190mm; padding: 2mm; }
            .top { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #111827; padding-bottom: 8px; }
            h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
            h2 { margin: 2px 0 0; font-size: 13px; font-weight: 600; }
            p { margin: 2px 0; }
            .muted { color: #4b5563; }
            .meta { text-align: right; min-width: 35mm; }
            .party { margin: 10px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .box { border: 1px solid #d1d5db; padding: 6px; min-height: 20mm; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { border: 1px solid #d1d5db; padding: 5px; vertical-align: top; }
            th { text-align: left; background: #f3f4f6; font-size: 10px; text-transform: uppercase; }
            .right { text-align: right; }
            .totals { margin-left: auto; margin-top: 8px; width: 55mm; }
            .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
            .totals .grand { border-top: 1px solid #111827; font-size: 13px; padding-top: 6px; }
            .note { margin-top: 12px; border-top: 1px solid #d1d5db; padding-top: 6px; }
            .signatures { margin-top: 22mm; display: flex; justify-content: space-between; gap: 24mm; }
            .signatures div { border-top: 1px solid #111827; flex: 1; text-align: center; padding-top: 4px; }
            @media print { .sheet { min-height: auto; } }
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="top">
              <div>
                ${company?.logo_url ? `<img src="${esc(company.logo_url)}" alt="Logo" style="max-height:40px;max-width:120px;margin-bottom:4px;" />` : ''}
                <h1>${esc(company?.name || 'KhataERP')}</h1>
                <p class="muted">${esc(company?.address || '')}</p>
                <p class="muted">${company?.pan_vat ? `PAN/VAT: ${esc(company.pan_vat)}` : ''} ${company?.phone ? ` | Phone: ${esc(company.phone)}` : ''}</p>
              </div>
              <div class="meta">
                <h2>${esc(documentTitle)}</h2>
                <p><strong>No:</strong> ${esc(voucher.invoice_no || voucher.seq)}</p>
                <p><strong>Date:</strong> ${esc(fmtDate(voucher.date_bs))}</p>
                ${(voucher.type === 'Sales' || voucher.type === 'Purchase') ? `<p><strong>Credit Days:</strong> ${esc(voucher.credit_days ?? 0)}</p><p><strong>Due Date:</strong> ${esc(fmtDate(voucher.due_date_bs || voucher.date_bs))}</p>` : ''}
                ${originalVoucher ? `<p><strong>Original Invoice:</strong> ${esc(originalVoucher.invoice_no || originalVoucher.seq)}</p><p><strong>Original Date:</strong> ${esc(fmtDate(originalVoucher.date_bs))}</p>` : ''}
              </div>
            </section>
            <section class="party">
              <div class="box">
                <p class="muted">${voucher.type === 'Payment' ? 'Paid to' : voucher.type === 'Receipt' ? 'Received from' : voucher.type === 'Sales Return' ? 'Returned by' : voucher.type === 'Purchase Return' ? 'Returned to' : 'Party'}</p>
                <p><strong>${esc(partyName)}</strong></p>
                <p>${esc(party?.address || '')}</p>
                <p>${party?.pan_vat ? `PAN/VAT: ${esc(party.pan_vat)}` : ''}</p>
              </div>
              <div class="box">
                <p class="muted">Voucher Type</p>
                <p><strong>${esc(voucher.type)}</strong></p>
                <p>${voucher.cancelled ? 'Cancelled' : 'Active'}</p>
              </div>
            </section>
            <table>
              <thead>${head}</thead>
              <tbody>${rows}</tbody>
            </table>
            ${totals}
            ${voucher.return_reason ? `<p class="note"><strong>Return reason:</strong> ${esc(voucher.return_reason)}</p>` : voucher.narration ? `<p class="note"><strong>Note:</strong> ${esc(voucher.narration)}</p>` : ''}
            ${company?.invoice_terms ? `<p class="note"><strong>Terms:</strong> ${esc(company.invoice_terms)}</p>` : ''}
            ${company?.payment_qr_text ? `<p class="note"><strong>Payment:</strong> ${esc(company.payment_qr_text)}</p>` : ''}
            <section class="signatures">
              <div>Prepared By</div>
              <div>Received By</div>
            </section>
          </main>
        </body>
      </html>
    `
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    logAppEvent('print_voucher', company?.id, { voucher_id: voucher.id, type: voucher.type, print_format: company?.print_format || 'A5' })
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  if (vouchers.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-3xl mb-3 opacity-30">◇</p>
        <p className="font-medium text-foreground">No transactions yet</p>
        <p className="text-sm mt-1">Transactions will appear here once added.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Date</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Type</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Ref / Party</th>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5 hidden md:table-cell">Narration</th>
              <th className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Amount</th>
              {showActions && <th className="px-4 py-2.5 w-36"></th>}
            </tr>
          </thead>
          <tbody>
            {vouchers.map(v => {
              const settlementId = legacySettlementAccountId(v)
              const allocationNames = (v.type === 'Receipt' || v.type === 'Payment') ? (v.lines || []).filter(line => line.account_id !== settlementId).map(line => getPartyByAccountId(line.account_id)?.name || getAccount(line.account_id)?.name || line.account_id) : []
              const partyName = allocationNames.length ? `${allocationNames[0]}${allocationNames.length > 1 ? ` + ${allocationNames.length - 1} more` : ''}` : v.party_account_id
                ? getPartyByAccountId(v.party_account_id)?.name ?? '—'
                : getAccount(legacySettlementAccountId(v) || '')?.name || (v.is_cash ? 'Cash' : '—')
              const settlementName = getAccount(legacySettlementAccountId(v) || '')?.name
              return (
                <tr key={v.id} className={`border-t border-border hover:bg-muted/30 transition-colors ${v.cancelled ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{fmtDate(v.date_bs)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={voucherBadgeVariant(v.type, v.cancelled)}>{v.type}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {v.invoice_no && <span className="text-xs text-muted-foreground block num">{v.invoice_no}</span>}
                    <span className="font-medium">{partyName}</span>
                    {(v.type === 'Receipt' || v.type === 'Payment') && settlementName && <span className="block text-xs text-muted-foreground">via {settlementName}</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-[200px] truncate">{v.narration}</td>
                  <td className="px-4 py-3 text-right num font-semibold">{fmtMoney(v.total)}</td>
                  {showActions && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetail(v)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => printVoucher(v)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        {!v.cancelled && (
                          <>
                            {onEdit && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(v)}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                                  <XCircle className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Cancel this voucher?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will reverse <strong>{v.type} {v.invoice_no}</strong> dated {fmtDate(v.date_bs)} for {fmtMoney(v.total)}.
                                    All affected balances and stock will be reversed. The voucher stays in history marked cancelled.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={async () => { setCancelling(true); await cancelV(v.id); setCancelling(false) }}
                                    disabled={cancelling}
                                  >
                                    Cancel voucher
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail?.type} {detail?.invoice_no ? `· ${detail.invoice_no}` : ''}
            </DialogTitle>
          </DialogHeader>
          {detail && <VoucherDetail voucher={detail} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
