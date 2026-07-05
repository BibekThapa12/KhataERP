import { useState } from 'react'
import { Plus, Eye } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { PartyForm } from '@/components/forms/PartyForm'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/misc'
import type { Party } from '@/types'

function PartyLedger({ party }: { party: Party }) {
  const { vouchers, getAccount } = useAppStore()
  const account = getAccount(party.account_id)
  const related = vouchers
    .filter(v => !v.cancelled && v.party_account_id === party.account_id)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.seq - b.seq)

  const isCustomer = party.type === 'customer'
  let running = account?.opening_balance ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Phone</p><p className="mt-0.5 font-medium">{party.phone || '—'}</p></div>
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">PAN / VAT</p><p className="mt-0.5 font-medium">{party.pan_vat || '—'}</p></div>
        <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Balance</p>
          <p className="mt-0.5 font-serif font-bold num">{fmtMoney(account?.balance ?? 0)}</p>
        </div>
      </div>
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
            {related.map(v => {
              const line = v.lines?.find(l => l.account_id === party.account_id)
              const dr = line?.debit ?? 0
              const cr = line?.credit ?? 0
              running = Math.round((running + (isCustomer ? dr - cr : cr - dr) + Number.EPSILON) * 100) / 100
              return (
                <tr key={v.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(v.date)}</td>
                  <td className="px-3 py-2.5">{v.type}</td>
                  <td className="px-3 py-2.5 text-muted-foreground num text-xs">{v.invoice_no}</td>
                  <td className="px-3 py-2.5 text-right num">{dr ? <span className="debit-amt">{fmtMoney(dr)}</span> : '—'}</td>
                  <td className="px-3 py-2.5 text-right num">{cr ? <span className="credit-amt">{fmtMoney(cr)}</span> : '—'}</td>
                  <td className="px-3 py-2.5 text-right num font-semibold">{fmtMoney(running)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PartyTable({ partyType }: { partyType: 'customer' | 'supplier' }) {
  const { parties, accounts } = useAppStore()
  const [selected, setSelected] = useState<Party | null>(null)
  const list = parties
    .filter(p => p.type === partyType)
    .map(p => ({ ...p, account: accounts.find(a => a.id === p.account_id) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (list.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-3xl mb-3 opacity-30">◔</p>
        <p className="font-medium text-foreground">No {partyType}s yet</p>
        <p className="text-sm mt-1">Add a {partyType} to start recording {partyType === 'customer' ? 'sales' : 'purchases'} on credit.</p>
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
            <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Balance</th>
            <th className="px-4 py-2.5 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {list.map(p => {
            const bal = p.account?.balance ?? 0
            const isPositive = bal > 0
            return (
              <tr key={p.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-semibold">{p.name}</td>
                <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{p.phone || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{p.pan_vat || '—'}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`num font-semibold ${isPositive ? (partyType === 'customer' ? 'credit-amt' : 'debit-amt') : 'text-muted-foreground'}`}>
                    {fmtMoney(Math.abs(bal))}
                  </span>
                  {isPositive && <span className="text-xs text-muted-foreground ml-1">{partyType === 'customer' ? 'owes you' : 'you owe'}</span>}
                </td>
                <td className="px-4 py-3">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(p)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
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
  const [showForm, setShowForm] = useState(false)
  return (
    <div>
      <PageHeader title="Parties" description="Customers and suppliers"
        action={<Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1.5" />New Party</Button>} />
      <PageContent>
        <Tabs defaultValue="customer">
          <TabsList className="mb-4">
            <TabsTrigger value="customer">Customers</TabsTrigger>
            <TabsTrigger value="supplier">Suppliers</TabsTrigger>
          </TabsList>
          <Card>
            <TabsContent value="customer" className="mt-0"><PartyTable partyType="customer" /></TabsContent>
            <TabsContent value="supplier" className="mt-0"><PartyTable partyType="supplier" /></TabsContent>
          </Card>
        </Tabs>
      </PageContent>
      <PartyForm open={showForm} onClose={() => setShowForm(false)} />
    </div>
  )
}
