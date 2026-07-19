import { useEffect, useState } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { useSearchParams } from 'react-router-dom'
import { Plus, Download, Eye, Printer, Search, Share2, ChevronDown, UserRound, Building2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { logAppEvent } from '@/lib/supabase'
import { downloadCsv } from '@/lib/csv'
import { getPartyBalanceSummary, type PartyBalanceRow, type PartyBalanceTotals } from '@/lib/partyBalances'
import { round2 } from '@/lib/engine'
import { todayBs } from '@/lib/nepaliDate'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { partyTerminology } from '@/lib/partyTerminology'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { LedgerDialog } from '@/pages/Masters'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Party } from '@/types'

const statementPrintStyles = `
  @page{size:auto;margin:9mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111827;font-family:Arial,sans-serif;font-size:9px}
  .statement{border:1px solid #4b5563}.heading{border-bottom:1px solid #4b5563;padding:8px 10px;text-align:center}.heading h1{margin:0;font-family:Georgia,serif;font-size:18px}.heading h2{margin:3px 0 0;font-size:13px}.heading p{margin:2px 0 0;font-size:8.5px}
  .meta{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;border-bottom:1px solid #4b5563;padding:7px 10px}.meta p{display:grid;grid-template-columns:88px 8px minmax(0,1fr);gap:3px;margin:2px 0}.meta strong{font-weight:600}.meta b{min-width:0;overflow-wrap:anywhere}
  table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:8px}thead{display:table-header-group}th,td{border-bottom:1px solid #9ca3af;border-right:1px solid #9ca3af;padding:4px;overflow-wrap:anywhere;vertical-align:middle}th:last-child,td:last-child{border-right:0}th{background:#f3f4f6;color:#111827;font-weight:700;text-align:center}tr{break-inside:avoid}.right{text-align:right;white-space:nowrap}.strong{font-weight:700}.center{text-align:center}.cancelled{color:#6b7280;text-decoration:line-through}.closing td{border-top:1.5px solid #4b5563;font-weight:700}.empty{padding:16px;text-align:center;color:#6b7280}
  .footer{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:24px;min-height:64px;border-top:1px solid #4b5563;padding:9px 12px 18px}.footer>div:last-of-type{text-align:right}.footer p{margin:3px 0}.generated{position:absolute;bottom:4px;left:0;right:0;margin:0!important;text-align:center;font-size:7.5px}
  .ledger-table th:nth-child(1),.ledger-table td:nth-child(1){width:11%}.ledger-table th:nth-child(2),.ledger-table td:nth-child(2){width:12%}.ledger-table th:nth-child(3),.ledger-table td:nth-child(3){width:13%}.ledger-table th:nth-child(4),.ledger-table td:nth-child(4){width:25%}.ledger-table th:nth-child(5),.ledger-table td:nth-child(5),.ledger-table th:nth-child(6),.ledger-table td:nth-child(6),.ledger-table th:nth-child(7),.ledger-table td:nth-child(7){width:13%}
  .group-table th:nth-child(1),.group-table td:nth-child(1){width:27%}.group-table th:nth-child(2),.group-table td:nth-child(2){width:16%}.group-table th:nth-child(3),.group-table td:nth-child(3){width:17%}.group-table th:nth-child(4),.group-table td:nth-child(4),.group-table th:nth-child(5),.group-table td:nth-child(5){width:13%}.group-table th:nth-child(6),.group-table td:nth-child(6){width:14%}
`

const escapePrintHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]!))

function partyBalanceLabel(balance: number, type: Party['type']) {
  if (Math.abs(balance) < 0.005) return fmtMoney(0)
  const suffix = balance >= 0 ? (type === 'customer' ? 'Dr' : 'Cr') : (type === 'customer' ? 'Cr' : 'Dr')
  return `${fmtMoney(Math.abs(balance))} ${suffix}`
}

function PartyLedger({ party }: { party: Party }) {
  const { company, vouchers, rawAccounts, getAccount } = useAppStore()
  const account = getAccount(party.account_id)
  const accountMap = new Map(rawAccounts.map(entry => [entry.id, entry.name]))
  const related = vouchers
    .filter(v => !v.cancelled && (v.party_account_id === party.account_id || (v.lines || []).some(line => line.account_id === party.account_id)))
    .sort((a, b) => a.date_bs_key - b.date_bs_key || a.seq - b.seq)

  const isCustomer = party.type === 'customer'
  const terminology = partyTerminology(party.type)
  let running = account?.opening_balance ?? 0
  const statementRows = related.map(v => {
    const partyLines = (v.lines || []).filter(line => line.account_id === party.account_id)
    const dr = partyLines.reduce((sum, line) => sum + (line.debit || 0), 0)
    const cr = partyLines.reduce((sum, line) => sum + (line.credit || 0), 0)
    const particulars = [...new Set((v.lines || []).filter(line => line.account_id !== party.account_id).map(line => accountMap.get(line.account_id) || line.account_id))].join(', ') || v.type
    running = Math.round((running + (isCustomer ? dr - cr : cr - dr) + Number.EPSILON) * 100) / 100
    return { v, dr, cr, particulars, balance: running }
  })

  const printStatement = () => {
    const opening = account?.opening_balance ?? 0
    const totalDebit = round2(statementRows.reduce((sum, row) => sum + row.dr, 0))
    const totalCredit = round2(statementRows.reduce((sum, row) => sum + row.cr, 0))
    const closing = statementRows.at(-1)?.balance ?? opening
    const fromDate = statementRows[0]?.v.date_bs || company?.fiscal_year_start || todayBs()
    const toDate = statementRows.at(-1)?.v.date_bs || todayBs()
    const rows = statementRows.map(({ v, dr, cr, particulars, balance }) => `<tr><td>${escapePrintHtml(fmtDate(v.date_bs))}</td><td>${escapePrintHtml(v.type)}</td><td>${escapePrintHtml(v.invoice_no || v.seq)}</td><td>${escapePrintHtml(particulars)}</td><td class="right">${dr ? escapePrintHtml(fmtMoney(dr)) : '-'}</td><td class="right">${cr ? escapePrintHtml(fmtMoney(cr)) : '-'}</td><td class="right strong">${escapePrintHtml(partyBalanceLabel(balance, party.type))}</td></tr>`).join('')
    const win = window.open('', '_blank', 'width=900,height=900')
    if (!win) return
    logAppEvent('print_party_statement', company?.id, { party_type: party.type })
    win.document.write(`<!doctype html><html><head><title>${escapePrintHtml(party.name)} Statement</title><style>${statementPrintStyles}</style></head><body><main class="statement"><header class="heading"><h1>Party Ledger Statement</h1><h2>${escapePrintHtml(company?.name || 'Company')}</h2>${company?.address ? `<p>${escapePrintHtml(company.address)}</p>` : ''}${company?.pan_vat ? `<p>PAN/VAT No: ${escapePrintHtml(company.pan_vat)}</p>` : ''}</header><section class="meta"><div><p><strong>Party Name</strong><span>:</span><b>${escapePrintHtml(party.name)}</b></p><p><strong>Party Type</strong><span>:</span><b>${escapePrintHtml(terminology.singular)}</b></p><p><strong>Address</strong><span>:</span><b>${escapePrintHtml(party.address || '-')}</b></p><p><strong>Phone</strong><span>:</span><b>${escapePrintHtml(party.phone || '-')}</b></p></div><div><p><strong>Group</strong><span>:</span><b>${escapePrintHtml(account?.group || '-')}</b></p><p><strong>Opening Balance</strong><span>:</span><b>${escapePrintHtml(partyBalanceLabel(opening, party.type))}</b></p><p><strong>From Date (BS)</strong><span>:</span><b>${escapePrintHtml(fmtDate(fromDate))}</b></p><p><strong>To Date (BS)</strong><span>:</span><b>${escapePrintHtml(fmtDate(toDate))}</b></p></div></section><table class="ledger-table"><thead><tr><th>Date (BS)</th><th>Vch Type</th><th>Vch No.</th><th>Particulars</th><th>Debit (Rs.)</th><th>Credit (Rs.)</th><th>Balance</th></tr></thead><tbody><tr><td></td><td></td><td></td><td class="strong">Opening Balance</td><td class="right">-</td><td class="right">-</td><td class="right strong">${escapePrintHtml(partyBalanceLabel(opening, party.type))}</td></tr>${rows || '<tr><td colspan="7" class="empty">No transactions in this statement.</td></tr>'}<tr class="strong"><td colspan="4" class="center">Total</td><td class="right">${escapePrintHtml(fmtMoney(totalDebit))}</td><td class="right">${escapePrintHtml(fmtMoney(totalCredit))}</td><td></td></tr><tr class="closing"><td colspan="6" class="center">Closing Balance</td><td class="right">${escapePrintHtml(partyBalanceLabel(closing, party.type))}</td></tr></tbody></table><footer class="footer"><div><p>Prepared By: ____________________</p><p>Date: ${escapePrintHtml(fmtDate(toDate))}</p></div><div><p>Checked By: ____________________</p><p>Authorized By: _________________</p></div><p class="generated">This is a computer-generated report.</p></footer></main></body></html>`)
    win.document.close()
    win.focus()
    win.print()
  }

  const shareStatement = async () => {
    const text = `${terminology.singular}: ${party.name}\nOpening: ${fmtMoney(account?.opening_balance ?? 0)}\nBalance: ${fmtMoney(account?.balance ?? 0)}`
    logAppEvent('share_party_statement', company?.id, { party_type: party.type })
    if (navigator.share) await navigator.share({ title: `${party.name} statement`, text })
    else await navigator.clipboard.writeText(text)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Phone</p><p className="mt-0.5 font-medium">{party.phone || '—'}</p></div>
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">PAN / VAT</p><p className="mt-0.5 font-medium">{party.pan_vat || '—'}</p></div>
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Balance</p>
          <p className="mt-0.5 font-serif font-bold num">{fmtMoney(account?.balance ?? 0)}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={printStatement}><Printer className="h-3.5 w-3.5 mr-1.5" />Print statement</Button>
        <Button variant="outline" size="sm" onClick={shareStatement}><Share2 className="h-3.5 w-3.5 mr-1.5" />Share</Button>
      </div>
      <p className="text-sm text-muted-foreground">Opening balance: <span className="num font-semibold">{fmtMoney(account?.opening_balance ?? 0)}</span></p>
      {related.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No transactions yet.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Date</th>
              <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Type</th>
              <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Ref</th>
              <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Debit</th>
              <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Credit</th>
              <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {statementRows.map(({ v, dr, cr, balance }) => {
              return (
                <tr key={v.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(v.date_bs)}</td>
                  <td className="px-3 py-2.5">{v.type}</td>
                  <td className="px-3 py-2.5 text-muted-foreground num text-xs">{v.invoice_no}</td>
                  <td className="px-3 py-2.5 text-right num">{dr ? <span className="debit-amt">{fmtMoney(dr)}</span> : '—'}</td>
                  <td className="px-3 py-2.5 text-right num">{cr ? <span className="credit-amt">{fmtMoney(cr)}</span> : '—'}</td>
                  <td className="px-3 py-2.5 text-right num font-semibold">{fmtMoney(balance)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PartyTable({ partyType, selectedPartyId, rows, totals, hasSearch }: {
  partyType: 'customer' | 'supplier'
  selectedPartyId?: string | null
  rows: PartyBalanceRow[]
  totals: PartyBalanceTotals
  hasSearch: boolean
}) {
  const { parties } = useAppStore()
  const [selected, setSelected] = useState<Party | null>(null)
  const terminology = partyTerminology(partyType)

  useEffect(() => {
    if (!selectedPartyId) return
    const party = parties.find(entry => entry.id === selectedPartyId && entry.type === partyType)
    if (party) setSelected(party)
  }, [selectedPartyId, partyType, parties])

  if (rows.length === 0 && !hasSearch) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-3xl mb-3 opacity-30">◔</p>
        <p className="font-medium text-foreground">No {terminology.plural} yet</p>
        <p className="text-sm mt-1">Add a {terminology.singular} to start recording {partyType === 'customer' ? 'sales' : 'purchases'} on credit.</p>
      </div>
    )
  }

  return (
    <>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Phone</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">PAN/VAT</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Credit Days</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Debit</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Credit</th>
            <th className="px-4 py-2.5 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map(({ party: p, debit, credit }) => {
            return (
              <tr key={p.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-semibold">{p.name}</td>
                <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{p.phone || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{p.pan_vat || '—'}</td>
                <td className="px-4 py-3 text-right num text-muted-foreground hidden lg:table-cell">{p.default_credit_days ?? 0}</td>
                <td className="px-4 py-3 text-right num font-semibold debit-amt">{debit ? fmtMoney(debit) : '—'}</td>
                <td className="px-4 py-3 text-right num font-semibold credit-amt">{credit ? fmtMoney(credit) : '—'}</td>
                <td className="px-4 py-3">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(p)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            )
          }) : <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No matching {terminology.plural.toLowerCase()}.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="border-t-2 bg-muted/30 font-semibold">
            <td colSpan={4} className="px-4 py-2.5">Total ({rows.length})</td>
            <td className="px-4 py-2.5 text-right num debit-amt">{fmtMoney(totals.debit)}</td>
            <td className="px-4 py-2.5 text-right num credit-amt">{fmtMoney(totals.credit)}</td>
            <td className="px-4 py-2.5" />
          </tr>
        </tfoot>
      </table>
      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && <PartyLedger party={selected} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function PartiesPage() {
  const [searchParams] = useSearchParams()
  const { company, parties, accounts } = useAppStore()
  const selectedPartyId = searchParams.get('party')
  const selectedParty = parties.find(party => party.id === selectedPartyId)
  const [tab, setTab] = useState<'customer' | 'supplier'>(selectedParty?.type || 'customer')
  const [newPartyType, setNewPartyType] = useState<'customer' | 'supplier' | null>(null)
  const [search, setSearch] = useState('')
  const balanceSummary = getPartyBalanceSummary(parties, accounts)
  const normalizedSearch = search.trim().toLowerCase().replace(/\s+/g, ' ')
  const sourceRows = tab === 'customer' ? balanceSummary.debtors : balanceSummary.creditors
  const activeRows = sourceRows.filter(row => {
    if (!normalizedSearch) return true
    const terminology = partyTerminology(row.party.type)
    const searchable = [row.party.name, row.party.phone, row.party.pan_vat, row.party.address, terminology.singular, terminology.plural, row.party.type]
      .filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ')
    return searchable.includes(normalizedSearch)
  })
  const activeTotals: PartyBalanceTotals = {
    debit: round2(activeRows.reduce((sum, row) => sum + row.debit, 0)),
    credit: round2(activeRows.reduce((sum, row) => sum + row.credit, 0)),
  }
  const activeTitle = tab === 'customer' ? 'Sundry Debtors (Customers)' : 'Sundry Creditors (Suppliers)'
  const reportSlug = tab === 'customer' ? 'sundry-debtors' : 'sundry-creditors'

  const exportBalances = () => {
    downloadCsv(`${reportSlug}-balances.csv`, ['Party', 'Phone', 'PAN / VAT', 'Debit', 'Credit'], activeRows.map(row => [row.party.name, row.party.phone, row.party.pan_vat, row.debit || '', row.credit || '']))
    logAppEvent('export_party_balance_summary', company?.id, { party_type: tab, party_count: activeRows.length })
  }

  const printBalances = () => {
    const win = window.open('', '_blank', 'width=1000,height=900')
    if (!win) return
    const asOf = todayBs()
    const groupBalance = tab === 'customer' ? round2(activeTotals.debit - activeTotals.credit) : round2(activeTotals.credit - activeTotals.debit)
    const rows = activeRows.map(row => {
      const balance = row.party.type === 'customer' ? round2(row.debit - row.credit) : round2(row.credit - row.debit)
      return `<tr><td class="strong">${escapePrintHtml(row.party.name)}</td><td>${escapePrintHtml(row.party.phone || '-')}</td><td>${escapePrintHtml(row.party.pan_vat || '-')}</td><td class="right">${row.debit ? escapePrintHtml(fmtMoney(row.debit)) : '-'}</td><td class="right">${row.credit ? escapePrintHtml(fmtMoney(row.credit)) : '-'}</td><td class="right strong">${escapePrintHtml(partyBalanceLabel(balance, row.party.type))}</td></tr>`
    }).join('')
    const balanceMeaning = tab === 'customer' ? 'Debit: receivable from customers. Credit: customer advance or amount payable.' : 'Debit: supplier advance or amount recoverable. Credit: payable to suppliers.'
    win.document.write(`<!doctype html><html><head><title>${escapePrintHtml(activeTitle)} Statement</title><style>${statementPrintStyles}</style></head><body><main class="statement"><header class="heading"><h1>${escapePrintHtml(activeTitle)} Statement</h1><h2>${escapePrintHtml(company?.name || 'Company')}</h2>${company?.address ? `<p>${escapePrintHtml(company.address)}</p>` : ''}${company?.pan_vat ? `<p>PAN/VAT No: ${escapePrintHtml(company.pan_vat)}</p>` : ''}</header><section class="meta"><div><p><strong>Group Name</strong><span>:</span><b>${escapePrintHtml(activeTitle)}</b></p><p><strong>Party Type</strong><span>:</span><b>${escapePrintHtml(tab === 'customer' ? 'Sundry Debtors' : 'Sundry Creditors')}</b></p><p><strong>Party Count</strong><span>:</span><b>${activeRows.length}</b></p></div><div><p><strong>As of Date (BS)</strong><span>:</span><b>${escapePrintHtml(fmtDate(asOf))}</b></p><p><strong>Total Debit</strong><span>:</span><b>${escapePrintHtml(fmtMoney(activeTotals.debit))}</b></p><p><strong>Total Credit</strong><span>:</span><b>${escapePrintHtml(fmtMoney(activeTotals.credit))}</b></p><p><strong>Group Balance</strong><span>:</span><b>${escapePrintHtml(partyBalanceLabel(groupBalance, tab))}</b></p></div></section><table class="group-table"><thead><tr><th>Party</th><th>Phone</th><th>PAN/VAT</th><th>Debit (Rs.)</th><th>Credit (Rs.)</th><th>Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No matching parties.</td></tr>'}<tr class="strong"><td colspan="3" class="center">Total</td><td class="right">${escapePrintHtml(fmtMoney(activeTotals.debit))}</td><td class="right">${escapePrintHtml(fmtMoney(activeTotals.credit))}</td><td class="right">${escapePrintHtml(partyBalanceLabel(groupBalance, tab))}</td></tr></tbody></table><section style="padding:7px 10px;border-top:1px solid #4b5563;font-size:8px">${escapePrintHtml(balanceMeaning)}</section><footer class="footer"><div><p>Prepared By: ____________________</p><p>Date: ${escapePrintHtml(fmtDate(asOf))}</p></div><div><p>Checked By: ____________________</p><p>Authorized By: _________________</p></div><p class="generated">This is a computer-generated report.</p></footer></main></body></html>`)
    win.document.close()
    win.focus()
    logAppEvent('print_party_balance_summary', company?.id, { party_type: tab, party_count: activeRows.length })
    win.print()
  }

  useEffect(() => {
    if (selectedParty) setTab(selectedParty.type)
  }, [selectedParty])

  return (
    <div>
      <PageHeader title="Parties" description="Sundry Debtors (Customers) and Sundry Creditors (Suppliers)"
        action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={exportBalances}><Download className="mr-1.5 h-4 w-4" />Export CSV</Button><Button variant="outline" onClick={printBalances}><Printer className="mr-1.5 h-4 w-4" />Print balances</Button><DropdownMenuPrimitive.Root><DropdownMenuPrimitive.Trigger asChild><Button><Plus className="mr-1.5 h-4 w-4" />New Party<ChevronDown className="ml-1.5 h-3.5 w-3.5" /></Button></DropdownMenuPrimitive.Trigger><DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content align="end" sideOffset={5} className="z-[100] min-w-48 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"><DropdownMenuPrimitive.Item onSelect={() => setNewPartyType('customer')} className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-accent"><UserRound className="h-4 w-4" />New Customer</DropdownMenuPrimitive.Item><DropdownMenuPrimitive.Item onSelect={() => setNewPartyType('supplier')} className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-accent"><Building2 className="h-4 w-4" />New Supplier</DropdownMenuPrimitive.Item></DropdownMenuPrimitive.Content></DropdownMenuPrimitive.Portal></DropdownMenuPrimitive.Root></div>} />
      <PageContent>
        <Tabs value={tab} onValueChange={value => setTab(value as 'customer' | 'supplier')}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="customer">Sundry Debtors (Customers)</TabsTrigger>
              <TabsTrigger value="supplier">Sundry Creditors (Suppliers)</TabsTrigger>
            </TabsList>
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, phone, PAN/VAT, address..." className="pl-8" aria-label="Search parties" />
            </div>
          </div>
          <Card>
            <TabsContent value="customer" className="mt-0"><PartyTable partyType="customer" selectedPartyId={selectedPartyId} rows={tab === 'customer' ? activeRows : []} totals={tab === 'customer' ? activeTotals : { debit: 0, credit: 0 }} hasSearch={!!normalizedSearch} /></TabsContent>
            <TabsContent value="supplier" className="mt-0"><PartyTable partyType="supplier" selectedPartyId={selectedPartyId} rows={tab === 'supplier' ? activeRows : []} totals={tab === 'supplier' ? activeTotals : { debit: 0, credit: 0 }} hasSearch={!!normalizedSearch} /></TabsContent>
          </Card>
        </Tabs>
      </PageContent>
      <LedgerDialog open={!!newPartyType} defaultPartyType={newPartyType || undefined} onClose={() => setNewPartyType(null)} />
    </div>
  )
}
