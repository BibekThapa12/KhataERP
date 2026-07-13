import { Fragment, useMemo, useState } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { AlertCircle, BookOpen, Building2, ChevronDown, ChevronRight, FolderPlus, Plus, Search, UserRound, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { normalSide, recomputeAllBalances, recomputeStock, round2 } from '@/lib/engine'
import { categoryPath } from '@/lib/categoryHierarchy'
import { makeBsKey, todayBs } from '@/lib/nepaliDate'
import { normalizeSearch } from '@/lib/search'
import { cn, fmtMoney } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/misc'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { PartyForm } from '@/components/forms/PartyForm'
import { CategoryDialog, LedgerDialog } from '@/pages/Masters'
import type { Account, AccountType, Party } from '@/types'

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense']
type StatusFilter = 'all' | 'active' | 'inactive'

const menuContentClass = 'z-[80] min-w-48 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md'
const menuItemClass = 'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-accent'

function NewMenu({ onLedger, onCategory, onParty }: { onLedger: () => void; onCategory: () => void; onParty: (type: 'customer' | 'supplier') => void }) {
  return <DropdownMenuPrimitive.Root>
    <DropdownMenuPrimitive.Trigger asChild><Button><Plus className="mr-1.5 h-4 w-4" />New</Button></DropdownMenuPrimitive.Trigger>
    <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content align="end" sideOffset={4} className={menuContentClass}>
      <DropdownMenuPrimitive.Item onSelect={onLedger} className={menuItemClass}><BookOpen className="h-4 w-4" />New Ledger</DropdownMenuPrimitive.Item>
      <DropdownMenuPrimitive.Item onSelect={onCategory} className={menuItemClass}><FolderPlus className="h-4 w-4" />New Account Category</DropdownMenuPrimitive.Item>
      <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" />
      <DropdownMenuPrimitive.Item onSelect={() => onParty('customer')} className={menuItemClass}><UserRound className="h-4 w-4" />New Customer</DropdownMenuPrimitive.Item>
      <DropdownMenuPrimitive.Item onSelect={() => onParty('supplier')} className={menuItemClass}><Building2 className="h-4 w-4" />New Supplier</DropdownMenuPrimitive.Item>
    </DropdownMenuPrimitive.Content></DropdownMenuPrimitive.Portal>
  </DropdownMenuPrimitive.Root>
}

function accountArchived(account: Account, partyByAccount: Map<string, Party>) {
  return !!account.is_archived || !!partyByAccount.get(account.id)?.is_archived
}

function balanceValueLabel(balance: number, type: AccountType) {
  if (Math.abs(balance) < 0.005) return fmtMoney(0)
  const natural = normalSide(type)
  const suffix = balance >= 0 ? (natural === 'debit' ? 'Dr' : 'Cr') : (natural === 'debit' ? 'Cr' : 'Dr')
  return `${fmtMoney(Math.abs(balance))} ${suffix}`
}

function balanceLabel(account: Account) {
  return balanceValueLabel(account.balance || 0, account.type)
}

export function AccountsPage() {
  const navigate = useNavigate()
  const { accounts, rawAccounts, accountCategories, parties, items, vouchers, loading, error } = useAppStore()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [accountType, setAccountType] = useState<'all' | AccountType>('all')
  const [hideZero, setHideZero] = useState(false)
  const [asOf, setAsOf] = useState(todayBs())
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [partyFormType, setPartyFormType] = useState<'customer' | 'supplier' | null>(null)
  const [expandedPartyGroups, setExpandedPartyGroups] = useState<Set<'customer' | 'supplier'>>(new Set())
  const partyByAccount = useMemo(() => new Map(parties.map(party => [party.account_id, party])), [parties])
  const asOfKey = makeBsKey(asOf)
  const relevantVouchers = useMemo(() => asOfKey
    ? vouchers.filter(voucher => (voucher.date_bs_key || makeBsKey(voucher.date_bs)) <= asOfKey)
    : vouchers, [vouchers, asOfKey])
  const balanceAccounts = useMemo(() => {
    const ledgerAccounts = asOfKey ? recomputeAllBalances(rawAccounts, relevantVouchers) : accounts
    const inventoryValue = round2(recomputeStock(items, relevantVouchers).reduce((sum, entry) => sum + entry.value, 0))
    return ledgerAccounts.map(account => account.id === 'inventory' || account.id.endsWith(':inventory')
      ? { ...account, balance: inventoryValue }
      : account)
  }, [accounts, rawAccounts, items, relevantVouchers, asOfKey])
  const query = normalizeSearch(search)
  const filteredAccounts = useMemo(() => balanceAccounts.filter(account => {
    const archived = accountArchived(account, partyByAccount)
    const statusMatches = status === 'all' || (status === 'inactive' ? archived : !archived)
    const typeMatches = accountType === 'all' || account.type === accountType
    const balanceMatches = !hideZero || Math.abs(account.balance || 0) >= 0.005
    const party = partyByAccount.get(account.id)
    const path = categoryPath(accountCategories, account.category_id) || account.group
    const searchMatches = !query || normalizeSearch(`${account.name} ${path} ${account.group} ${account.type} ${party?.name || ''} ${party?.phone || ''} ${account.is_system ? 'system' : ''} ${account.is_party ? 'party' : 'ledger'}`).includes(query)
    return statusMatches && typeMatches && balanceMatches && searchMatches
  }).sort((left, right) => left.name.localeCompare(right.name)), [balanceAccounts, partyByAccount, status, accountType, hideZero, query, accountCategories])
  const grouped = useMemo(() => ACCOUNT_TYPES.map(type => ({ type, accounts: filteredAccounts.filter(account => account.type === type) })).filter(group => group.accounts.length), [filteredAccounts])

  const openLedger = (account: Account) => navigate(`/reports/ledger?account=${encodeURIComponent(account.id)}`)
  const togglePartyGroup = (partyType: 'customer' | 'supplier') => setExpandedPartyGroups(current => {
    const next = new Set(current)
    if (next.has(partyType)) next.delete(partyType)
    else next.add(partyType)
    return next
  })

  const accountRow = (account: Account, nested = false) => {
    const party = partyByAccount.get(account.id)
    const archived = accountArchived(account, partyByAccount)
    const path = categoryPath(accountCategories, account.category_id) || account.group || 'Uncategorized'
    return <tr key={account.id} tabIndex={0} role="link" aria-label={`Open ledger for ${account.name}`} onClick={() => openLedger(account)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLedger(account) } }} className={cn('cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring', nested && 'bg-muted/10', archived && 'text-muted-foreground')}>
      <td className={cn('px-4 py-3 font-medium', nested && 'pl-12')}><span className="hover:underline">{account.name}</span>{account.is_system && <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px]">System</Badge>}{archived && <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">Inactive</Badge>}</td>
      <td className="px-4 py-3 text-muted-foreground">{nested && party ? (party.type === 'customer' ? 'Customer ledger' : 'Supplier ledger') : path}</td>
      <td className="px-4 py-3 text-right font-mono font-medium">{balanceLabel(account)}</td>
    </tr>
  }

  return <div>
    <PageHeader title="Chart of Accounts" action={<NewMenu onLedger={() => setLedgerOpen(true)} onCategory={() => setCategoryOpen(true)} onParty={setPartyFormType} />} />
    <PageContent>
      <Card className="overflow-hidden p-4 sm:p-6 lg:p-7">
        <div className="mb-7 border-b pb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search accounts, groups, parties..." className="pl-9" /></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[9rem_10rem_auto_auto] xl:flex">
              <SearchableSelect value={status} onValueChange={value => setStatus(value as StatusFilter)} className="xl:w-32" options={[{ value: 'all', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
              <SearchableSelect value={accountType} onValueChange={value => setAccountType(value as 'all' | AccountType)} className="xl:w-36" options={[{ value: 'all', label: 'All types' }, ...ACCOUNT_TYPES.map(value => ({ value, label: value }))]} />
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 shadow-sm"><span className="shrink-0 text-xs text-muted-foreground">As of</span><NepaliDateInput value={asOf} onChange={setAsOf} className="min-w-0 flex-1 [&_input]:border-0 [&_input]:px-0 [&_input]:shadow-none [&_input]:focus-visible:ring-0" /></div>
              <label className="flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 text-xs shadow-sm"><input type="checkbox" checked={hideZero} onChange={event => setHideZero(event.target.checked)} className="h-4 w-4 accent-primary" />Hide zero balances</label>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{filteredAccounts.length} of {balanceAccounts.length} ledgers</span>{asOf !== todayBs() && <Button size="sm" variant="ghost" className="h-7" onClick={() => setAsOf(todayBs())}>Show current balances</Button>}</div>
        </div>

        {error && <div role="alert" className="mb-5 flex items-start gap-2 rounded-md bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {loading ? <div className="space-y-3">{[0, 1, 2, 3, 4].map(index => <div key={index} className="h-11 animate-pulse rounded bg-muted" />)}</div>
          : grouped.length ? <div className="space-y-7">
            {grouped.map(group => {
              const regularAccounts = group.accounts.filter(account => !partyByAccount.has(account.id))
              const partyGroups = (['customer', 'supplier'] as const).map(partyType => ({
                partyType,
                label: partyType === 'customer' ? 'Sundry Debtors' : 'Sundry Creditors',
                accounts: group.accounts.filter(account => partyByAccount.get(account.id)?.type === partyType),
              })).filter(entry => entry.accounts.length)
              const entries = [
                ...regularAccounts.map(account => ({ kind: 'account' as const, label: account.name, account })),
                ...partyGroups.map(partyGroup => ({ kind: 'party' as const, label: partyGroup.label, partyGroup })),
              ].sort((left, right) => left.label.localeCompare(right.label))
              return <section key={group.type}>
                <h2 className="mb-3 font-serif text-base font-medium text-[#1B2A4A]">{group.type}</h2>
                <div className="overflow-x-auto rounded-t-xl">
                  <table className="w-full min-w-[620px] border-collapse text-sm">
                    <thead><tr className="border-b border-[#cbbd9f] bg-[#f4f0e5]"><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-[#675c49]">Account</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase text-[#675c49]">Group</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase text-[#675c49]">Balance</th></tr></thead>
                    <tbody>{entries.map(entry => {
                      if (entry.kind === 'account') return accountRow(entry.account)
                      const { partyGroup } = entry
                      const open = !!query || expandedPartyGroups.has(partyGroup.partyType)
                      const groupBalance = round2(partyGroup.accounts.reduce((sum, account) => sum + (account.balance || 0), 0))
                      return <Fragment key={partyGroup.partyType}>
                        <tr tabIndex={0} aria-expanded={open} onClick={() => togglePartyGroup(partyGroup.partyType)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePartyGroup(partyGroup.partyType) } }} className="cursor-pointer border-b bg-muted/15 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
                          <td className="px-4 py-3 font-semibold"><span className="inline-flex items-center gap-2">{open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}<Users className="h-4 w-4 text-[#806f5b]" />{partyGroup.label}</span></td>
                          <td className="px-4 py-3 text-muted-foreground">{partyGroup.accounts.length} {partyGroup.partyType === 'customer' ? 'customer' : 'supplier'} ledger{partyGroup.accounts.length === 1 ? '' : 's'}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold">{balanceValueLabel(groupBalance, group.type)}</td>
                        </tr>
                        {open && partyGroup.accounts.map(account => accountRow(account, true))}
                      </Fragment>
                    })}</tbody>
                  </table>
                </div>
              </section>
            })}
          </div> : <div className="py-16 text-center"><p className="text-sm font-medium">No matching accounts</p><p className="mt-1 text-xs text-muted-foreground">Try changing the search, filters, date, or zero-balance option.</p></div>}
      </Card>
    </PageContent>
    <LedgerDialog open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    <CategoryDialog kind="account" open={categoryOpen} onClose={() => setCategoryOpen(false)} />
    <PartyForm open={!!partyFormType} defaultType={partyFormType || undefined} onClose={() => setPartyFormType(null)} />
  </div>
}
