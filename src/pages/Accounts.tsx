import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { AlertCircle, BookOpen, Building2, ChevronDown, ChevronRight, Folder, FolderPlus, Landmark, Plus, Search, UserRound, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { normalSide, recomputeAllBalances, recomputeStock, round2 } from '@/lib/engine'
import { buildCategoryTree, categoryPath, type CategoryTreeNode } from '@/lib/categoryHierarchy'
import { makeBsKey, todayBs } from '@/lib/nepaliDate'
import { normalizeSearch } from '@/lib/search'
import { cn, fmtMoney } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/misc'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { ExpandCollapseControls } from '@/components/ExpandCollapseControls'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { PartyForm } from '@/components/forms/PartyForm'
import { CategoryDialog, LedgerDialog } from '@/pages/Masters'
import type { Account, AccountCategory, AccountType, Party } from '@/types'

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense']
type StatusFilter = 'all' | 'active' | 'inactive'
type AccountTreeNode = CategoryTreeNode<AccountCategory, Account>

const menuContentClass = 'z-[80] min-w-48 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md'
const menuItemClass = 'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-accent'
const typeFolderClass: Record<AccountType, string> = {
  Asset: 'text-blue-600',
  Liability: 'text-rose-500',
  Equity: 'text-violet-600',
  Income: 'text-emerald-600',
  Expense: 'text-amber-600',
}

function NewMenu({ onLedger, onCategory, onParty }: { onLedger: () => void; onCategory: () => void; onParty: (type: 'customer' | 'supplier') => void }) {
  return <DropdownMenuPrimitive.Root>
    <DropdownMenuPrimitive.Trigger asChild><Button className="w-full sm:w-auto"><Plus className="mr-1.5 h-4 w-4" />New Account</Button></DropdownMenuPrimitive.Trigger>
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

function nodeAccounts(node: AccountTreeNode): Account[] {
  return [...node.directRecords, ...node.children.flatMap(nodeAccounts)]
}

function pruneTree(nodes: AccountTreeNode[]): AccountTreeNode[] {
  return nodes.flatMap(node => {
    const children = pruneTree(node.children)
    return node.directRecords.length || children.length ? [{ ...node, children }] : []
  })
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
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set())
  const expansionInitialized = useRef(false)

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

  const categoryTree = useMemo(() => pruneTree(buildCategoryTree(
    accountCategories.filter(category => accountType === 'all' || category.account_type === accountType),
    filteredAccounts,
  )), [accountCategories, filteredAccounts, accountType])

  useEffect(() => {
    if (expansionInitialized.current || !accountCategories.length) return
    expansionInitialized.current = true
    setExpandedCategories(new Set(accountCategories.map(category => category.id)))
  }, [accountCategories])

  const assignedCategoryIds = useMemo(() => new Set(accountCategories.map(category => category.id)), [accountCategories])
  const uncategorizedByType = useMemo(() => ACCOUNT_TYPES.map(type => ({
    type,
    accounts: filteredAccounts.filter(account => account.type === type && (!account.category_id || !assignedCategoryIds.has(account.category_id))),
  })).filter(group => group.accounts.length), [filteredAccounts, assignedCategoryIds])

  const toggleCategory = (id: string) => setExpandedCategories(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const openLedger = (account: Account) => navigate(`/reports/ledger?account=${encodeURIComponent(account.id)}`)

  const accountRow = (account: Account, code: string, depth: number) => {
    const archived = accountArchived(account, partyByAccount)
    return <tr key={account.id} tabIndex={0} role="link" aria-label={`Open ledger for ${account.name}`} onClick={() => openLedger(account)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLedger(account) } }} className={cn('h-11 cursor-pointer border-t transition-colors hover:bg-muted/25 focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring', archived && 'text-muted-foreground')}>
      <td className="relative px-3 py-2.5 font-medium"><div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${1.1 + depth * 1.45}rem` }}><span aria-hidden className="absolute h-full border-l border-dashed border-border" style={{ left: `${1.45 + (depth - 1) * 1.45}rem`, top: 0 }} /><Landmark className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate hover:underline">{account.name}</span>{account.is_system && <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">System</Badge>}{archived && <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">Inactive</Badge>}</div></td>
      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{code}</td>
      <td className="px-3 py-2.5 text-muted-foreground">Ledger</td>
      <td className="px-3 py-2.5 text-right font-sans font-medium tabular-nums">{balanceValueLabel(account.balance || 0, account.type)}</td>
    </tr>
  }

  const categoryRows = (node: AccountTreeNode, code: string): React.ReactNode => {
    const depth = node.depth - 1
    const open = !!query || expandedCategories.has(node.category.id)
    const accountsInNode = nodeAccounts(node)
    const groupBalance = round2(accountsInNode.reduce((sum, account) => sum + (account.balance || 0), 0))
    const isPartyCategory = /sundry debtors|sundry creditors/i.test(node.category.name)
    const CategoryIcon = isPartyCategory ? Users : Folder
    return <Fragment key={node.category.id}>
      <tr tabIndex={0} aria-expanded={open} onClick={() => toggleCategory(node.category.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCategory(node.category.id) } }} className={cn('h-11 cursor-pointer border-t transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring', depth === 0 && 'bg-muted/15')}>
        <td className="relative px-3 py-2.5 font-semibold"><div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 1.45}rem` }}>{depth > 0 && <span aria-hidden className="absolute h-full border-l border-dashed border-border" style={{ left: `${1.45 + (depth - 1) * 1.45}rem`, top: 0 }} />}{open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}<CategoryIcon className={cn('h-4 w-4 shrink-0', isPartyCategory ? 'text-foreground/70' : typeFolderClass[node.category.account_type])} /><span className="truncate">{node.category.name}</span><Badge variant="secondary" className="shrink-0 border-0 bg-blue-50 px-2 py-0 text-[10px] font-medium text-blue-700">{node.totalCount} {node.totalCount === 1 ? 'account' : 'accounts'}</Badge>{node.category.is_archived && <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">Inactive</Badge>}</div></td>
        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{code}</td>
        <td className="px-3 py-2.5 text-muted-foreground">Group</td>
        <td className="px-3 py-2.5"><div className="flex items-center justify-end gap-4"><span className="font-sans font-semibold tabular-nums">{balanceValueLabel(groupBalance, node.category.account_type)}</span>{open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}</div></td>
      </tr>
      {open && node.children.map((child, index) => categoryRows(child, `${code}.${index + 1}`))}
      {open && [...node.directRecords].sort((left, right) => left.name.localeCompare(right.name)).map((account, index) => accountRow(account, `${code}.${node.children.length + index + 1}`, depth + 1))}
    </Fragment>
  }

  const rootRows = ACCOUNT_TYPES.flatMap((type, typeIndex) => {
    const roots = categoryTree.filter(node => node.category.account_type === type)
    return roots.map((node, rootIndex) => categoryRows(node, rootIndex === 0 ? String(typeIndex + 1) : `${typeIndex + 1}.${rootIndex + 1}`))
  })
  const unassignedRows = uncategorizedByType.flatMap(group => {
    const typeCode = ACCOUNT_TYPES.indexOf(group.type) + 1
    const id = `uncategorized:${group.type}`
    const open = !!query || expandedCategories.has(id)
    const balance = round2(group.accounts.reduce((sum, account) => sum + (account.balance || 0), 0))
    return [<Fragment key={id}><tr tabIndex={0} aria-expanded={open} onClick={() => toggleCategory(id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCategory(id) } }} className="h-11 cursor-pointer border-t bg-muted/15 hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"><td className="px-3 py-2.5 font-semibold"><div className="flex items-center gap-2">{open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}<Folder className={cn('h-4 w-4', typeFolderClass[group.type])} />Uncategorized {group.type}<Badge variant="secondary" className="border-0 bg-blue-50 px-2 py-0 text-[10px] text-blue-700">{group.accounts.length} accounts</Badge></div></td><td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{typeCode}.9</td><td className="px-3 py-2.5 text-muted-foreground">Group</td><td className="px-3 py-2.5 text-right font-sans font-semibold tabular-nums">{balanceValueLabel(balance, group.type)}</td></tr>{open && group.accounts.map((account, index) => accountRow(account, `${typeCode}.9.${index + 1}`, 1))}</Fragment>]
  })
  const netBalance = round2(filteredAccounts.reduce((sum, account) => sum + (normalSide(account.type) === 'debit' ? account.balance || 0 : -(account.balance || 0)), 0))
  const expandableIds = [...accountCategories.map(category => category.id), ...uncategorizedByType.map(group => `uncategorized:${group.type}`)]
  const allExpanded = expandableIds.length > 0 && expandableIds.every(id => expandedCategories.has(id))

  return <div>
    <PageHeader title="Chart of Accounts" description="View and manage all your accounts in a structured hierarchy." action={<NewMenu onLedger={() => setLedgerOpen(true)} onCategory={() => setCategoryOpen(true)} onParty={setPartyFormType} />} />
    <PageContent>
      <Card className="overflow-hidden p-3 sm:p-4">
        <div className="report-controls mb-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search accounts, groups, parties..." className="pl-9" /></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex">
              <SearchableSelect value={status} onValueChange={value => setStatus(value as StatusFilter)} className="xl:w-36" options={[{ value: 'all', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
              <SearchableSelect value={accountType} onValueChange={value => setAccountType(value as 'all' | AccountType)} className="xl:w-36" options={[{ value: 'all', label: 'All types' }, ...ACCOUNT_TYPES.map(value => ({ value, label: value }))]} />
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 shadow-sm xl:w-52"><span className="shrink-0 text-xs text-muted-foreground">As of</span><NepaliDateInput value={asOf} onChange={setAsOf} className="min-w-0 flex-1 [&_input]:border-0 [&_input]:px-0 [&_input]:shadow-none [&_input]:focus-visible:ring-0" /></div>
              <label className="flex h-9 items-center gap-2 whitespace-nowrap px-2 text-xs"><input type="checkbox" checked={hideZero} onChange={event => setHideZero(event.target.checked)} className="h-4 w-4 accent-primary" />Hide zero balances</label>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{filteredAccounts.length} of {balanceAccounts.length} ledgers</span><div className="flex flex-wrap items-center gap-2">{asOf !== todayBs() && <Button size="sm" variant="ghost" className="h-7" onClick={() => setAsOf(todayBs())}>Show current balances</Button>}<ExpandCollapseControls expanded={allExpanded} onToggle={() => { if (allExpanded) { setSearch(''); setExpandedCategories(new Set()) } else setExpandedCategories(new Set(expandableIds)) }} /></div></div>
        </div>

        {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {loading ? <div className="overflow-hidden rounded-md border"><div className="h-10 animate-pulse bg-muted/60" />{[0, 1, 2, 3, 4, 5].map(index => <div key={index} className="h-11 animate-pulse border-t bg-card px-4 py-3"><div className="h-3 w-1/3 rounded bg-muted" /></div>)}</div>
          : rootRows.length || unassignedRows.length ? <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[760px] border-collapse text-sm"><colgroup><col className="w-[50%]" /><col className="w-[18%]" /><col className="w-[14%]" /><col className="w-[18%]" /></colgroup><thead><tr className="bg-[#f4f0e5]"><th className="report-th text-left text-[#675c49]">Account</th><th className="report-th text-left text-[#675c49]">Code</th><th className="report-th text-left text-[#675c49]">Type</th><th className="report-th text-right text-[#675c49]">Balance</th></tr></thead><tbody>{rootRows}{unassignedRows}</tbody><tfoot><tr className="border-t-2 bg-muted/20 font-semibold"><td className="px-3 py-3">Total</td><td className="px-3 py-3 font-mono text-xs">{filteredAccounts.length} accounts</td><td className="px-3 py-3" /><td className="px-3 py-3 text-right font-sans tabular-nums">{balanceValueLabel(netBalance, 'Asset')}</td></tr></tfoot></table></div>
          : <div className="rounded-md border py-16 text-center"><p className="text-sm font-medium">No matching accounts</p><p className="mt-1 text-xs text-muted-foreground">Try changing the search, filters, date, or zero-balance option.</p></div>}
      </Card>
    </PageContent>
    <LedgerDialog open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    <CategoryDialog kind="account" open={categoryOpen} onClose={() => setCategoryOpen(false)} />
    <PartyForm open={!!partyFormType} defaultType={partyFormType || undefined} onClose={() => setPartyFormType(null)} />
  </div>
}
