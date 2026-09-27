import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { AccountingSyncStatus } from '@/components/AccountingSyncStatus'
import { isDeveloperAdmin, signOut } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
  BookOpen, Users, Package, Scale, BarChart2, FileText,
  Percent, Boxes, Settings, LogOut, ChevronDown, Code2, CalendarDays, Library, Database, Undo2, Redo2, Menu, X, ListTree, WalletCards, Clock3, Files, Landmark, Plus, CheckCircle2, ArrowLeftRight, Calculator, SlidersHorizontal, HardDrive, ShieldCheck, Activity, Search, PanelLeftClose, PanelLeftOpen, UserCircle2, PlusCircle, Building2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { JournalForm, ReceiptPaymentForm } from '@/components/forms/OtherForms'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { chequeEntitlement } from '@/lib/cheques'
import { DEFAULT_FISCAL_YEAR_START_BS, bsToAd, parseBsDate } from '@/lib/nepaliDate'
import { publicErrorMessage } from '@/lib/security'
import { formatMasterName } from '@/lib/nameFormat'
import { IDENTITY_LIMITS, identityDatabaseError, normalizePanInput, normalizePhoneInput, validateAddress, validateName, validatePan, validatePhone } from '@/lib/identityValidation'
import { companyBillingStatus, companyCanWrite } from '@/lib/billing'
import { PopupCalculator } from '@/components/tools/PopupCalculator'
import { rankSidebarDestinations, sidebarPreferenceKeys } from '@/lib/sidebarNavigation'
import { useGlobalCreateShortcut } from '@/lib/globalCreateShortcut'

type NavIcon = React.ComponentType<{ className?: string }>
type NavLinkItem = { kind?: 'link'; to: string; label: string; Icon: NavIcon; end?: boolean; keywords?: readonly string[] }
type NavGroupItem = { kind: 'group'; id: string; label: string; Icon: NavIcon; matchPath?: string; children: NavLinkItem[] }
type NavItem = NavLinkItem | NavGroupItem
type SearchDestination = NavLinkItem & { parent: string }
type VoucherShortcutType = 'Payment' | 'Receipt' | 'Journal' | 'Sales' | 'Purchase'
type SidebarTransactionType = VoucherShortcutType | 'Income' | 'Expense' | 'Contra' | 'Sales Return' | 'Purchase Return' | 'Stock Adjustment'

const SimpleEntryForm = lazy(() => import('@/components/forms/SimpleEntryForm').then(module => ({ default: module.SimpleEntryForm })))
const ContraForm = lazy(() => import('@/components/forms/ContraForm').then(module => ({ default: module.ContraForm })))
const ReturnForm = lazy(() => import('@/components/forms/ReturnForm').then(module => ({ default: module.ReturnForm })))
const StockAdjustmentForm = lazy(() => import('@/components/forms/StockAdjustmentForm').then(module => ({ default: module.StockAdjustmentForm })))

const VOUCHER_SHORTCUTS = [
  { key: 'F5', label: 'Payment', type: 'Payment' },
  { key: 'F6', label: 'Receipt', type: 'Receipt' },
  { key: 'F7', label: 'Journal', type: 'Journal' },
  { key: 'F8', label: 'Sales', type: 'Sales' },
  { key: 'F9', label: 'Purchase', type: 'Purchase' },
] as const satisfies ReadonlyArray<{ key: string; label: string; type: VoucherShortcutType }>

const SIDEBAR_ADDITIONAL_TRANSACTIONS = [
  { label: 'Income', type: 'Income', Icon: TrendingUp },
  { label: 'Expense', type: 'Expense', Icon: TrendingDown },
  { label: 'Contra', type: 'Contra', Icon: ArrowLeftRight },
  { label: 'Sales Return', type: 'Sales Return', Icon: Undo2 },
  { label: 'Purchase Return', type: 'Purchase Return', Icon: Redo2 },
  { label: 'Stock Adjustment', type: 'Stock Adjustment', Icon: SlidersHorizontal },
] as const satisfies ReadonlyArray<{ label: string; type: SidebarTransactionType; Icon: NavIcon }>

const NAVIGATION_SHORTCUTS = [
  { key: 'D', label: 'Daybook', to: '/reports/daybook' },
  { key: 'P', label: 'Parties', to: '/parties' },
  { key: 'S', label: 'Stock Summary', to: '/stock-report' },
  { key: 'L', label: 'Ledger / Group', to: '/reports/ledger' },
] as const

const DEVELOPER_NAVIGATION = [
  { view: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { view: 'users', label: 'Users & Companies', Icon: Users },
  { view: 'licenses', label: 'Licenses', Icon: ShieldCheck },
  { view: 'backups', label: 'Backups', Icon: HardDrive },
  { view: 'diagnostics', label: 'Diagnostics', Icon: Activity },
] as const

const NAV_SECTIONS: {
  label: string
  items: NavItem[]
}[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', Icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Transactions',
    items: [
      { to: '/sales', label: 'Sales Invoices', Icon: TrendingUp },
      { to: '/purchase', label: 'Purchase Bills', Icon: TrendingDown },
      { to: '/receipts', label: 'Receipts', Icon: ArrowDownCircle },
      { to: '/payments', label: 'Payments', Icon: ArrowUpCircle },
      { to: '/transactions/income', label: 'Income', Icon: TrendingUp },
      { to: '/transactions/expenses', label: 'Expenses', Icon: TrendingDown },
      {
        kind: 'group', id: 'other-transactions', label: 'Other Vouchers', Icon: Files,
        children: [
          { to: '/transactions/contra', label: 'Contra', Icon: ArrowLeftRight },
          { to: '/journal', label: 'Journal Entries', Icon: BookOpen },
          { to: '/sales-returns', label: 'Sales Returns', Icon: Undo2 },
          { to: '/purchase-returns', label: 'Purchase Returns', Icon: Redo2 },
          { to: '/transactions/stock-adjustments', label: 'Stock Adjustments', Icon: SlidersHorizontal },
        ],
      },
    ],
  },
  {
    label: 'Accounts & Items',
    items: [
      { to: '/accounts', label: 'Chart of Accounts', Icon: ListTree },
      { to: '/masters', label: 'Ledgers & Categories', Icon: Database, keywords: ['masters', 'alter masters', 'accounts'] },
      { to: '/parties', label: 'Customers & Suppliers', Icon: Users, keywords: ['parties', 'customers', 'suppliers'] },
      { to: '/items', label: 'Items & Stock', Icon: Package },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/reports/daybook', label: 'Daybook', Icon: CalendarDays },
      { to: '/reports/ledger', label: 'Ledger / Group Reports', Icon: Library },
      { to: '/reports/registers', label: 'Transaction Registers', Icon: Files, keywords: ['register', 'registers', 'voucher register'] },
      { to: '/reports/cash-bank-book', label: 'Cash & Bank', Icon: Landmark },
      { to: '/stock-report', label: 'Stock Summary', Icon: Boxes },
      { to: '/reports/stock-ledger', label: 'Stock Ledger', Icon: FileText },
      {
        kind: 'group', id: 'financial', label: 'Financial Reports', Icon: BarChart2,
        children: [
          { to: '/balance-sheet', label: 'Balance Sheet', Icon: FileText },
          { to: '/profit-loss', label: 'Profit & Loss', Icon: BarChart2 },
          { to: '/reports/cash-flow', label: 'Cash Flow', Icon: WalletCards },
          { to: '/trial-balance', label: 'Trial Balance', Icon: Scale },
        ],
      },
      {
        kind: 'group', id: 'outstandings', label: 'Outstandings', Icon: Clock3, matchPath: '/reports/receivables-payables',
        children: [
          { to: '/reports/receivables-payables?kind=receivable&view=aging', label: 'Debtors Ageing', Icon: Clock3 },
          { to: '/reports/receivables-payables?kind=payable&view=aging', label: 'Creditors Ageing', Icon: Clock3 },
        ],
      },
      { to: '/vat-report', label: 'VAT Report', Icon: Percent },
    ],
  },
  {
    label: 'Cheque Management',
    items: [
      {
        kind: 'group', id: 'incoming-cheques', label: 'Incoming Cheques', Icon: ArrowDownCircle,
        children: [
          { to: '/cheques/received/new', label: 'Receive Cheque', Icon: Plus },
          { to: '/cheques/received/pending', label: 'Pending Cheques', Icon: Clock3 },
          { to: '/cheques/received/settled', label: 'Settled Cheques', Icon: CheckCircle2 },
        ],
      },
      {
        kind: 'group', id: 'outgoing-cheques', label: 'Outgoing Cheques', Icon: ArrowUpCircle,
        children: [
          { to: '/cheques/issued/new', label: 'Issue Cheque', Icon: Plus },
          { to: '/cheques/issued/pending', label: 'Pending Cheques', Icon: Clock3 },
          { to: '/cheques/issued/settled', label: 'Settled Cheques', Icon: CheckCircle2 },
        ],
      },
      { to: '/cheques/banks', label: 'Banks', Icon: Landmark },
      { to: '/cheques/parties', label: 'Cheque Parties', Icon: Users, keywords: ['issuing parties', 'cheque party master'] },
    ],
  },
]

function navLinkIsActive(item: NavLinkItem, pathname: string, search: string) {
  const [targetPath, targetQuery = ''] = item.to.split('?')
  const pathMatches = item.end || targetPath === '/'
    ? pathname === targetPath
    : pathname === targetPath || pathname.startsWith(`${targetPath}/`)
  if (!pathMatches) return false
  const expected = new URLSearchParams(targetQuery)
  if (!expected.size) return true
  const actual = new URLSearchParams(search)
  return [...expected].every(([key, value]) => actual.get(key) === value)
}

function itemIsActive(item: NavItem, pathname: string, search: string) {
  return item.kind === 'group'
    ? item.children.some(child => navLinkIsActive(child, pathname, search)) || item.matchPath === pathname
    : navLinkIsActive(item, pathname, search)
}

function activeReportGroupId(pathname: string, search: string) {
  const group = NAV_SECTIONS.flatMap(section => section.items)
    .find(item => item.kind === 'group' && itemIsActive(item, pathname, search))
  return group?.kind === 'group' ? group.id : null
}

function SidebarLink({ item, active, onNavigate, child = false, collapsed = false }: { item: NavLinkItem; active: boolean; onNavigate: () => void; child?: boolean; collapsed?: boolean }) {
  const Icon = item.Icon
  return <NavLink
    to={item.to}
    end={item.end}
    onClick={onNavigate}
    className={cn(
      'relative flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:min-h-10',
      child && 'relative py-1.5 pl-4 before:absolute before:-left-3 before:top-1/2 before:h-px before:w-3 before:bg-blue-200/20',
      collapsed && 'justify-center px-0',
      active ? 'bg-white font-semibold text-[#1B2A4A] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-amber-500' : 'text-blue-100/85 hover:bg-white/10 hover:text-white',
    )}
    aria-current={active ? 'page' : undefined}
    aria-label={collapsed ? item.label : undefined}
    title={collapsed ? item.label : undefined}
  >
    {(!child || collapsed) && <Icon className="h-4 w-4 flex-shrink-0" />}
    {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
  </NavLink>
}

function ReportNavGroup({ item, open, active, onToggle, onNavigate, pathname, search, collapsed = false }: { item: NavGroupItem; open: boolean; active: boolean; onToggle: () => void; onNavigate: () => void; pathname: string; search: string; collapsed?: boolean }) {
  const Icon = item.Icon
  const contentId = `report-nav-${item.id}`
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  if (collapsed) return <div className="relative">
    <button ref={triggerRef} type="button" aria-expanded={open} aria-controls={contentId} aria-label={item.label} title={item.label} onClick={onToggle} className={cn('relative flex min-h-11 w-full items-center justify-center rounded-md text-blue-100/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:min-h-10', active && 'bg-white/15 font-semibold text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-amber-400')}>
      <Icon className="h-4 w-4" />
    </button>
    {open && <div id={contentId} style={{ top: Math.max(8, Math.min(triggerRef.current?.getBoundingClientRect().top || 80, window.innerHeight - 320)) }} className="fixed left-[72px] z-[80] ml-2 hidden w-64 rounded-lg border border-white/10 bg-[#10203d] p-2 shadow-2xl md:block"><p className="px-2 py-1.5 text-xs font-semibold text-white">{item.label}</p>{item.children.map(child => <SidebarLink key={child.to} item={child} active={navLinkIsActive(child, pathname, search)} onNavigate={onNavigate} />)}</div>}
  </div>
  return <div>
    <button type="button" aria-expanded={open} aria-controls={contentId} onClick={onToggle} className={cn('relative flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:min-h-10', active ? 'font-semibold text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-amber-400' : 'text-blue-100/85')}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="min-w-0 truncate">{item.label}</span>
      <ChevronDown className={cn('ml-auto h-3.5 w-3.5 flex-shrink-0 transition-transform duration-300 ease-out motion-reduce:transition-none', !open && '-rotate-90')} />
    </button>
    <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
      <div className="min-h-0 overflow-hidden">
        <div id={contentId} aria-hidden={!open} inert={!open ? true : undefined} className="ml-4 space-y-0.5 border-l border-blue-200/20 pl-3 py-0.5">
          {item.children.map(child => <SidebarLink key={child.to} item={child} child active={navLinkIsActive(child, pathname, search)} onNavigate={onNavigate} />)}
        </div>
      </div>
    </div>
  </div>
}

function SidebarSearch({ destinations, collapsed, onNavigate, onRequestOpen }: { destinations: SearchDestination[]; collapsed: boolean; onNavigate: (to: string) => void; onRequestOpen?: () => void }) {
  const resultLimit = 10
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const rankedResults = useMemo(() => rankSidebarDestinations(destinations, query), [destinations, query])
  const results = showAll ? rankedResults : rankedResults.slice(0, resultLimit)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editable = target?.matches('input, textarea, select, [contenteditable="true"]')
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !editable) {
        event.preventDefault(); onRequestOpen?.(); setOpen(true); requestAnimationFrame(() => inputRef.current?.focus())
      } else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); setQuery(''); setShowAll(false) }
    }
    const onPointer = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer) }
  }, [onRequestOpen, open])

  useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [collapsed, open])

  const choose = (item: SearchDestination) => { onNavigate(item.to); setOpen(false); setQuery(''); setShowAll(false) }
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(current => Math.min(current + 1, results.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(current => Math.max(current - 1, 0)) }
    else if (event.key === 'Enter' && results[selected]) { event.preventDefault(); choose(results[selected]) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(''); setShowAll(false) }
  }

  return <div ref={rootRef} className="relative px-2 pb-2">
    {collapsed ? <button type="button" aria-label="Find a page" title="Find a page (Ctrl+K)" onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()) }} className="flex min-h-11 w-full items-center justify-center rounded-md text-blue-100/85 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:min-h-10"><Search className="h-4 w-4" /></button> : <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-200/60" /><input ref={inputRef} value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setSelected(0); setShowAll(false); setOpen(true) }} onKeyDown={onInputKeyDown} placeholder="Find a page…" aria-label="Find a page" className="h-11 w-full rounded-md border border-white/10 bg-white/5 pl-9 pr-12 text-sm text-white outline-none placeholder:text-blue-200/55 focus:border-white/30 focus:ring-2 focus:ring-white/20 md:h-10" /><kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-blue-100/60">Ctrl K</kbd></div>}
    {open && <div style={collapsed ? { top: Math.max(8, rootRef.current?.getBoundingClientRect().top || 80) } : undefined} className={cn('z-[90] mt-1 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-[#10203d] p-1.5 shadow-2xl', collapsed ? 'fixed left-[72px] hidden w-72 md:block' : 'absolute left-2 right-2 top-full')}>
      {collapsed && <div className="relative mb-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-200/60" /><input ref={inputRef} autoFocus value={query} onChange={event => { setQuery(event.target.value); setSelected(0); setShowAll(false) }} onKeyDown={onInputKeyDown} placeholder="Find a page…" aria-label="Find a page" className="h-10 w-full rounded-md border border-white/10 bg-white/5 pl-8 pr-2 text-sm text-white outline-none placeholder:text-blue-200/55" /></div>}
      {results.map((item, index) => <button key={`${item.parent}:${item.to}`} type="button" onMouseEnter={() => setSelected(index)} onClick={() => choose(item)} className={cn('flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-blue-50', selected === index ? 'bg-white/15' : 'hover:bg-white/10')}><item.Icon className="h-4 w-4 shrink-0" /><span className="min-w-0"><span className="block truncate font-medium">{item.label}</span><span className="block truncate text-xs text-blue-200/60">{item.parent}</span></span></button>)}
      {!results.length && <p className="px-3 py-5 text-center text-sm text-blue-100/60">No permitted page matches.</p>}
      {rankedResults.length > resultLimit && <button type="button" onClick={() => { setShowAll(value => !value); setSelected(current => showAll ? Math.min(current, resultLimit - 1) : current) }} className="mt-1 flex min-h-10 w-full items-center justify-center rounded-md border-t border-white/10 px-3 text-xs font-medium text-blue-100/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">{showAll ? 'Show fewer results' : `Show all ${rankedResults.length} matches`}</button>}
    </div>}
  </div>
}

function CompanySwitcher({ onSwitched, collapsed = false }: { onSwitched: () => void; collapsed?: boolean }) {
  const company = useAppStore(s => s.company)
  const memberships = useAppStore(s => s.companyMemberships)
  const license = useAppStore(s => s.companyCreationLicense)
  const switchCompany = useAppStore(s => s.switchCompany)
  const createCompany = useAppStore(s => s.createCompany)
  const switcherRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [switchingId, setSwitchingId] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    address: '',
    pan_vat: '',
    phone: '',
    vat_enabled: true,
    fiscal_year_start_bs: DEFAULT_FISCAL_YEAR_START_BS,
    sales_prefix: 'INV-',
    purchase_prefix: 'PB-',
    receipt_prefix: 'RCPT-',
    payment_prefix: 'PAY-',
    sales_return_prefix: 'SR-',
    purchase_return_prefix: 'PR-',
    print_format: 'A5' as 'A5' | 'A4',
  })
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return memberships
    return memberships.filter(entry => [entry.company.name, entry.company.owner_email, entry.company.phone].filter(Boolean).some(value => String(value).toLowerCase().includes(q)))
  }, [memberships, query])
  const canCreate = !!license?.can_create_company
  const limitMessage = 'You have reached your maximum allowed company limit. Please contact the administrator.'
  const updateForm = (key: keyof typeof form, value: string | boolean) => setForm(current => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || switcherRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const handleSwitch = async (companyId: string) => {
    setSwitchingId(companyId)
    setError('')
    try {
      await switchCompany(companyId)
      setOpen(false)
      onSwitched()
    } catch (err) {
      setError(publicErrorMessage(err, 'switching company'))
    } finally {
      setSwitchingId('')
    }
  }
  const handleCreate = async () => {
    setCreating(true)
    setError('')
    try {
      const { fiscal_year_start_bs, ...companyForm } = form
      const fiscalYearStartAd = parseBsDate(fiscal_year_start_bs) ? bsToAd(fiscal_year_start_bs) : ''
      if (!fiscalYearStartAd) {
        setError('Enter a valid fiscal year start date.')
        return
      }
      const formattedName = formatMasterName(form.name) || 'My Company'
      updateForm('name', formattedName)
      const identityError = validateName(formattedName, 'Company name') || validateAddress(form.address) || validatePan(form.pan_vat) || validatePhone(form.phone)
      if (identityError) { setError(identityError); return }
      await createCompany({
        ...companyForm,
        name: formattedName,
        fiscal_year_start: fiscalYearStartAd,
        fiscal_year_configured: true,
      })
      setAddOpen(false)
      setOpen(false)
      onSwitched()
    } catch (err) {
      setError(identityDatabaseError(err) || publicErrorMessage(err, 'creating company'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={switcherRef} className={cn('relative mt-3', collapsed && 'flex justify-center')}>
      <button type="button" aria-label={`Current company: ${company?.name || 'Loading company'}. Switch company`} title={collapsed ? company?.name || 'Switch company' : undefined} onClick={() => setOpen(value => !value)} className={cn('flex items-center gap-1 rounded bg-white/5 text-left text-xs text-blue-100/80 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white', collapsed ? 'h-10 w-10 justify-center p-0' : 'w-full px-2.5 py-2')}>
        {collapsed ? <Building2 className="h-4 w-4" /> : <span className="min-w-0 flex-1 truncate">{company?.name ?? 'Loading company...'}</span>}
        {!collapsed && <ChevronDown className={cn('h-3 w-3 flex-shrink-0 transition-transform', open && 'rotate-180')} />}
      </button>
      {open && (
        <div className={cn('absolute top-full z-[70] mt-2 w-64 rounded-md border border-white/10 bg-[#10203d] p-2 shadow-xl', collapsed ? 'left-full top-0 ml-2 hidden md:block' : 'left-0 right-0')}>
          <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search companies..." className="h-8 border-white/15 bg-white/95 text-xs" />
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {filtered.map(entry => (
              <button key={entry.company_id} type="button" onClick={() => handleSwitch(entry.company_id)} disabled={switchingId === entry.company_id} className={cn('flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-blue-100 hover:bg-white/10', company?.id === entry.company_id && 'bg-white font-semibold text-[#1B2A4A]')}>
                <span className="min-w-0 flex-1 truncate">{entry.company.name}</span>
                {company?.id === entry.company_id && <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
            ))}
            {!filtered.length && <p className="px-2 py-2 text-xs text-blue-100/60">No companies found.</p>}
          </div>
          <button type="button" onClick={() => canCreate ? (setAddOpen(true), setOpen(false)) : setError(limitMessage)} className={cn('mt-2 flex w-full items-center gap-2 rounded border border-white/10 px-2 py-2 text-left text-xs text-blue-100 hover:bg-white/10', !canCreate && 'opacity-60')}>
            <Plus className="h-3.5 w-3.5" />
            <span>Add Company</span>
          </button>
          {license && <p className="mt-1 px-1 text-[10px] text-blue-100/55">{license.unlimited_companies ? 'Unlimited companies' : `${license.current_companies}/${license.max_companies} companies used`}</p>}
          {error && <p className="mt-2 rounded bg-red-500/10 px-2 py-1.5 text-[11px] text-red-100">{error}</p>}
        </div>
      )}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Company</DialogTitle>
            <DialogDescription>Create an independent company under this login.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Company Name</Label><Input value={form.name} maxLength={IDENTITY_LIMITS.name} onChange={event => updateForm('name', event.target.value)} onBlur={() => updateForm('name', formatMasterName(form.name))} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} inputMode="numeric" maxLength={10} onChange={event => updateForm('phone', normalizePhoneInput(event.target.value))} /></div>
            <div className="space-y-1.5"><Label>PAN / VAT No.</Label><Input value={form.pan_vat} inputMode="numeric" maxLength={9} onChange={event => updateForm('pan_vat', normalizePanInput(event.target.value))} /></div>
            <div className="space-y-1.5"><Label>Fiscal Year Start Date (B.S.)</Label><NepaliDateInput value={form.fiscal_year_start_bs} onChange={value => updateForm('fiscal_year_start_bs', value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Address</Label><Textarea rows={2} maxLength={IDENTITY_LIMITS.address} value={form.address} onChange={event => updateForm('address', event.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.vat_enabled} onChange={event => updateForm('vat_enabled', event.target.checked)} /> VAT Mode</label>
            <div className="space-y-1.5"><Label>Print Format</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.print_format} onChange={event => updateForm('print_format', event.target.value as 'A5' | 'A4')}><option value="A5">A5</option><option value="A4">A4</option></select></div>
            {(['sales_prefix','purchase_prefix','receipt_prefix','payment_prefix','sales_return_prefix','purchase_return_prefix'] as const).map(key => (
              <div key={key} className="space-y-1.5"><Label>{key.replaceAll('_', ' ')}</Label><Input value={form[key]} onChange={event => updateForm(key, event.target.value)} /></div>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !canCreate}>{creating ? 'Creating...' : 'Create Company'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function AppShell() {
  const company = useAppStore(s => s.company)
  const userId = useAppStore(s => s.userId)
  const navigate = useNavigate()
  const location = useLocation()
  const developerWorkspace = location.pathname === '/developer'
  const developerView = new URLSearchParams(location.search).get('view') || 'overview'
  const vatEnabled = company?.vat_enabled ?? true
  const companyModules = useAppStore(s => s.companyModules)
  const chequePermissions = useAppStore(s => s.chequePermissions)
  const chequeAccess = chequeEntitlement(companyModules.find(entry => entry.module?.key === 'cheque_management'))
  const showChequeNavigation = chequeAccess.canRead && chequePermissions.includes('cheque.view')
  const [developerAdmin, setDeveloperAdmin] = useState(false)
  const billingStatus = companyBillingStatus(company)
  const planInactive = billingStatus === 'expired'
  const readOnly = !developerAdmin && !companyCanWrite(company)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarTransitioning, setSidebarTransitioning] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [transactionMenuOpen, setTransactionMenuOpen] = useState(false)
  const [collapsedMenuId, setCollapsedMenuId] = useState<string | null>(null)
  const [preferencesLoadedFor, setPreferencesLoadedFor] = useState<string | null>(null)
  const [shortcutVoucher, setShortcutVoucher] = useState<SidebarTransactionType | null>(null)
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [openReportGroups, setOpenReportGroups] = useState<Set<string>>(() => new Set([activeReportGroupId(location.pathname, location.search)].filter(Boolean) as string[]))
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const active = NAV_SECTIONS.find(section => section.items.some(item => itemIsActive(item, location.pathname, location.search)))
    return new Set([active && active.label !== 'Overview' ? active.label : 'Transactions'])
  })
  const sidebarRef = useRef<HTMLElement | null>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const transactionMenuRef = useRef<HTMLDivElement | null>(null)
  const transactionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)
  const sidebarTransitionTimerRef = useRef<number | null>(null)
  const sidebarTransitionActiveRef = useRef(false)
  const navigationCollapsed = sidebarCollapsed && !mobileOpen

  const openNewTransactionMenu = useCallback(() => {
    if (location.pathname === '/cheques/pending' || location.pathname === '/cheques/received/pending') {
      navigate('/cheques/received/new'); return
    }
    if (location.pathname === '/cheques/issued/pending') {
      navigate('/cheques/issued/new'); return
    }
    if (location.pathname === '/cheques/banks') {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('Add Other Bank'))?.click(); return
    }
    setAccountMenuOpen(false)
    setCollapsedMenuId(null)
    setMobileOpen(window.matchMedia('(max-width: 767px)').matches)
    setTransactionMenuOpen(true)
    requestAnimationFrame(() => transactionMenuRef.current?.querySelector<HTMLButtonElement>('[role="menu"] button')?.focus())
  }, [location.pathname, navigate])

  useGlobalCreateShortcut({ active: !developerWorkspace, disabled: readOnly, onCreate: openNewTransactionMenu })

  const visibleNavSections = useMemo(() => NAV_SECTIONS.map(section => {
    if (section.label === 'Cheque Management' && !showChequeNavigation) return null
    const chequeItemVisible = (item: NavLinkItem) => {
      if (item.to.endsWith('/new')) return chequeAccess.canWrite && chequePermissions.includes('cheque.create')
      if (item.to === '/cheques/banks') return chequeAccess.canWrite && chequePermissions.includes('cheque.manage_banks')
      if (item.to === '/cheques/parties') return chequePermissions.includes('cheque.view_parties')
      return chequePermissions.includes('cheque.view')
    }
    const items = section.items.map(item => item.kind === 'group' && section.label === 'Cheque Management'
      ? { ...item, children: item.children.filter(chequeItemVisible) }
      : item).filter(item => {
        if (item.kind === 'group') return item.children.length > 0
        if (!vatEnabled && item.to === '/vat-report') return false
        return section.label !== 'Cheque Management' || chequeItemVisible(item)
      })
    return { ...section, items }
  }).filter(Boolean) as typeof NAV_SECTIONS, [chequeAccess.canWrite, chequePermissions, showChequeNavigation, vatEnabled])

  const searchDestinations = useMemo(() => [
    ...visibleNavSections.flatMap(section => section.items.flatMap(item => item.kind === 'group'
      ? item.children.map(child => ({ ...child, parent: `${section.label} / ${item.label}` }))
      : [{ ...item, parent: section.label }])),
    { to: '/settings', label: 'Settings', Icon: Settings, parent: 'Account' },
    ...(developerAdmin ? [{ to: '/developer', label: 'Developer Dashboard', Icon: Code2, parent: 'Developer' }] : []),
  ], [developerAdmin, visibleNavSections])

  useEffect(() => {
    const openCalculator = (event: KeyboardEvent) => {
      if (event.key !== 'F2' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      if (!event.repeat) setCalculatorOpen(true)
    }
    window.addEventListener('keydown', openCalculator, true)
    return () => window.removeEventListener('keydown', openCalculator, true)
  }, [])

  useEffect(() => {
    if (!userId) return
    try {
      const keys = sidebarPreferenceKeys(userId)
      setSidebarCollapsed(localStorage.getItem(keys.collapsed) === 'true')
      const savedSections = JSON.parse(localStorage.getItem(keys.sections) || '[]') as string[]
      const savedGroups = JSON.parse(localStorage.getItem(keys.groups) || '[]') as string[]
      const currentPath = window.location.pathname
      const currentSearch = window.location.search
      const activeSection = NAV_SECTIONS.find(section => section.items.some(item => itemIsActive(item, currentPath, currentSearch)))
      const activeGroup = activeReportGroupId(currentPath, currentSearch)
      setOpenSections(new Set(savedSections.length ? savedSections : [activeSection && activeSection.label !== 'Overview' ? activeSection.label : 'Transactions']))
      setOpenReportGroups(new Set(savedGroups.length ? savedGroups : activeGroup ? [activeGroup] : []))
    } catch { /* storage unavailable or invalid */ }
    setPreferencesLoadedFor(userId)
  }, [userId])

  useEffect(() => {
    if (!userId || preferencesLoadedFor !== userId) return
    try {
      const keys = sidebarPreferenceKeys(userId)
      localStorage.setItem(keys.collapsed, String(sidebarCollapsed))
      localStorage.setItem(keys.sections, JSON.stringify([...openSections]))
      localStorage.setItem(keys.groups, JSON.stringify([...openReportGroups]))
    } catch { /* storage unavailable */ }
  }, [openReportGroups, openSections, preferencesLoadedFor, sidebarCollapsed, userId])

  useEffect(() => () => {
    if (sidebarTransitionTimerRef.current !== null) window.clearTimeout(sidebarTransitionTimerRef.current)
    sidebarTransitionActiveRef.current = false
  }, [])

  useEffect(() => {
    isDeveloperAdmin().then(setDeveloperAdmin)
  }, [])

  useEffect(() => {
    const active = NAV_SECTIONS.find(section => section.items.some(item => itemIsActive(item, location.pathname, location.search)))
    if (!active) return
    const activeLabel = active.label === 'Overview' ? 'Transactions' : active.label
    setOpenSections(current => {
      if (current.has(activeLabel)) return current
      return new Set([...current, activeLabel])
    })
  }, [location.pathname, location.search])

  useEffect(() => {
    const activeGroup = activeReportGroupId(location.pathname, location.search)
    if (activeGroup) setOpenReportGroups(current => current.has(activeGroup) ? current : new Set([...current, activeGroup]))
    setMobileOpen(false)
    setAccountMenuOpen(false)
    setTransactionMenuOpen(false)
    setCollapsedMenuId(null)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!mobileOpen) return
    const sidebar = sidebarRef.current
    const restoreTarget = mobileTriggerRef.current
    const focusable = () => [...(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])].filter(element => !element.hasAttribute('inert'))
    requestAnimationFrame(() => focusable()[0]?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileOpen(false); return }
      if (event.key !== 'Tab') return
      const items = focusable(); if (!items.length) return
      const first = items[0]; const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); requestAnimationFrame(() => restoreTarget?.focus()) }
  }, [mobileOpen])

  useEffect(() => {
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || mobileOpen) return
      setAccountMenuOpen(false)
      setTransactionMenuOpen(false)
      setCollapsedMenuId(null)
    }
    window.addEventListener('keydown', closeMenus)
    return () => window.removeEventListener('keydown', closeMenus)
  }, [mobileOpen])

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Node
      if (transactionMenuOpen && !transactionMenuRef.current?.contains(target)) setTransactionMenuOpen(false)
      if (accountMenuOpen && !accountMenuRef.current?.contains(target)) setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeMenus)
    return () => document.removeEventListener('pointerdown', closeMenus)
  }, [accountMenuOpen, transactionMenuOpen])

  useEffect(() => {
    const openVoucherFromKey = (event: KeyboardEvent) => {
      if (developerWorkspace) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const key = event.key.toUpperCase()
      const newTransactionShortcut = key === 'N'
      const voucherShortcut = VOUCHER_SHORTCUTS.find(entry => entry.key === key)
      const navigationShortcut = NAVIGATION_SHORTCUTS.find(entry => entry.key === key)
      if (!newTransactionShortcut && !voucherShortcut && !navigationShortcut) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      if (event.repeat) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (newTransactionShortcut) {
        if (readOnly) return
        openNewTransactionMenu()
        return
      }
      setMobileOpen(false)
      if (voucherShortcut && !readOnly) setShortcutVoucher(voucherShortcut.type)
      else if (navigationShortcut) { setShortcutVoucher(null); navigate(navigationShortcut.to) }
    }
    window.addEventListener('keydown', openVoucherFromKey)
    return () => window.removeEventListener('keydown', openVoucherFromKey)
  }, [developerWorkspace, navigate, openNewTransactionMenu, readOnly])

  const toggleSection = (label: string) => setOpenSections(current => {
    const next = new Set(current)
    if (next.has(label)) next.delete(label); else next.add(label)
    return next
  })
  const toggleReportGroup = (id: string) => setOpenReportGroups(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const handleTransactionMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setTransactionMenuOpen(false)
      transactionTriggerRef.current?.focus()
      return
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])')]
    if (!items.length) return
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length
    items[nextIndex]?.focus()
  }

  const toggleSidebar = () => {
    if (sidebarTransitionActiveRef.current) return
    sidebarTransitionActiveRef.current = true
    setAccountMenuOpen(false)
    setTransactionMenuOpen(false)
    setCollapsedMenuId(null)
    setSidebarTransitioning(false)
    if (sidebarTransitionTimerRef.current !== null) window.clearTimeout(sidebarTransitionTimerRef.current)
    window.requestAnimationFrame(() => {
      setSidebarTransitioning(true)
      setSidebarCollapsed(value => !value)
      sidebarTransitionTimerRef.current = window.setTimeout(() => {
        setSidebarTransitioning(false)
        sidebarTransitionTimerRef.current = null
        sidebarTransitionActiveRef.current = false
      }, 360)
    })
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const activeDestination = searchDestinations.find(item => navLinkIsActive(item, location.pathname, location.search))
  const breadcrumbParts = activeDestination
    ? [...activeDestination.parent.split(' / '), activeDestination.label]
    : location.pathname.startsWith('/cheques/') ? ['Cheque Management', location.pathname.endsWith('/edit') ? 'Edit Cheque' : 'Cheque Details']
      : location.pathname === '/settings' ? ['Settings'] : []
  const transactionMenuMaxHeight = Math.max(220, Math.floor(
    (accountMenuRef.current?.getBoundingClientRect().top ?? window.innerHeight - 96)
    - (transactionTriggerRef.current?.getBoundingClientRect().bottom ?? 160)
    - 8,
  ))

  if (company?.suspended && !developerAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="font-serif text-2xl font-bold text-foreground">{company?.suspended ? 'Account suspended' : 'Plan inactive'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This company is temporarily suspended. Please contact KhataERP support to continue using the app.
          </p>
          <Button onClick={handleSignOut} className="mt-5">
            Sign out
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell flex h-dvh min-h-0 w-full overflow-hidden bg-background">
      <button ref={mobileTriggerRef} type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="app-mobile-nav fixed left-3 top-3 z-40 flex h-11 w-11 items-center justify-center rounded-md border bg-background shadow-sm md:hidden">
        <Menu className="h-5 w-5" />
      </button>
      {mobileOpen && <button type="button" aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} className="app-mobile-nav fixed inset-0 z-40 bg-black/45 md:hidden" />}
      {/* Sidebar */}
      <aside ref={sidebarRef} aria-label="Application sidebar" data-collapsed={navigationCollapsed || undefined} className={cn('app-shell-sidebar fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-shrink-0 flex-col overflow-visible bg-[#1B2A4A] md:static md:translate-x-0', navigationCollapsed ? 'md:w-[72px]' : 'md:w-64', mobileOpen ? 'translate-x-0' : '-translate-x-full', sidebarTransitioning && 'sidebar-is-transitioning')}>
        {/* Brand */}
        <div className={cn('relative shrink-0 border-b border-white/10 px-4 py-4', navigationCollapsed && 'px-2')}>
          <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 md:hidden"><X className="h-5 w-5" /></button>
          <div className={cn('flex items-start justify-between gap-2', navigationCollapsed && 'justify-center')}>
            <div><div className={cn('font-serif text-2xl font-bold tracking-tight text-white', navigationCollapsed && 'text-center text-xl')}>{navigationCollapsed ? 'K' : 'Khata'}</div>{!navigationCollapsed && <div className="mt-0.5 text-[10px] uppercase tracking-widest text-blue-200/70">{developerWorkspace ? 'Developer Workspace' : 'ERP for Nepal'}</div>}</div>
            <button type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar} className="hidden h-9 w-9 items-center justify-center rounded-md text-blue-100/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:flex">{sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>
          </div>
          {!developerWorkspace && <CompanySwitcher collapsed={navigationCollapsed} onSwitched={() => { setMobileOpen(false); navigate('/') }} />}
        </div>

        {/* Nav */}
        <nav aria-label="Primary navigation" className="sidebar-navigation-scroll min-h-0 flex-1 overflow-y-auto overflow-x-visible py-3">
          {!developerWorkspace && <>
            <SidebarSearch collapsed={navigationCollapsed} destinations={searchDestinations} onRequestOpen={() => { if (window.matchMedia('(max-width: 767px)').matches) setMobileOpen(true) }} onNavigate={to => { navigate(to); setMobileOpen(false) }} />
            <div ref={transactionMenuRef} className="relative px-2 pb-3">
              <button ref={transactionTriggerRef} type="button" disabled={readOnly} aria-expanded={transactionMenuOpen} aria-controls={transactionMenuOpen ? 'sidebar-new-transaction-menu' : undefined} aria-label="New transaction" title={navigationCollapsed ? 'New transaction' : undefined} onClick={() => setTransactionMenuOpen(value => !value)} className={cn('group flex min-h-11 w-full items-center rounded-md border text-sm font-semibold text-blue-50 shadow-sm transition-[background-color,border-color,color,box-shadow] hover:border-blue-100/35 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-10', transactionMenuOpen ? 'border-amber-300/55 bg-amber-300/10 shadow-[inset_3px_0_0_rgba(217,179,94,0.9)]' : 'border-blue-100/15 bg-white/[0.055]', navigationCollapsed ? 'justify-center px-0' : 'gap-2 px-2.5')}><span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-amber-300/30 bg-amber-300/10 text-amber-200 transition-colors group-hover:border-amber-300/50 group-hover:bg-amber-300/15', navigationCollapsed && 'h-8 w-8')}><PlusCircle className="h-4 w-4" /></span>{!navigationCollapsed && <><span>New transaction</span><ChevronDown className={cn('ml-auto h-4 w-4 text-blue-200/75 transition-transform', transactionMenuOpen && 'rotate-180 text-amber-200')} /></>}</button>
              {transactionMenuOpen && <div id="sidebar-new-transaction-menu" role="menu" aria-label="New transaction types" onKeyDown={handleTransactionMenuKeyDown} onWheel={event => event.stopPropagation()} style={{ maxHeight: transactionMenuMaxHeight, ...(navigationCollapsed ? { top: Math.max(8, transactionTriggerRef.current?.getBoundingClientRect().top || 80) } : {}) }} className={cn('sidebar-navigation-scroll z-[80] mt-1 overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-[#10203d] p-1.5 shadow-2xl', navigationCollapsed ? 'fixed left-[72px] hidden w-64 md:block' : 'absolute left-2 right-2 top-full')}>
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-blue-200/50">Quick vouchers</p>
                {VOUCHER_SHORTCUTS.map(shortcut => <button key={shortcut.type} role="menuitem" type="button" onClick={() => { setShortcutVoucher(shortcut.type); setTransactionMenuOpen(false); setMobileOpen(false) }} className="flex min-h-11 w-full items-center justify-between rounded-md px-2.5 text-sm text-blue-50 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"><span>New {shortcut.label}</span><kbd className="text-[10px] text-blue-200/60">{shortcut.key}</kbd></button>)}
                <div className="mx-2 my-1 border-t border-white/10" />
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-blue-200/50">More vouchers</p>
                {SIDEBAR_ADDITIONAL_TRANSACTIONS.map(action => <button key={action.type} role="menuitem" type="button" onClick={() => { setShortcutVoucher(action.type); setTransactionMenuOpen(false); setMobileOpen(false) }} className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-blue-50 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"><action.Icon className="h-4 w-4 shrink-0 text-blue-200/70" /><span>New {action.label}</span></button>)}
              </div>}
            </div>
          </>}
          <div className="space-y-4 px-2">
          {developerWorkspace ? (
            <div className="space-y-1">
              <NavLink to="/" title={navigationCollapsed ? 'Back to ERP' : undefined} aria-label={navigationCollapsed ? 'Back to ERP' : undefined} onClick={() => setMobileOpen(false)} className={cn('mb-4 flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm text-blue-100/80 transition-colors hover:bg-white/10 hover:text-white', navigationCollapsed && 'justify-center px-0')}>
                <ArrowLeftRight className="h-4 w-4" />
                {!navigationCollapsed && <span>Back to ERP</span>}
              </NavLink>
              {!navigationCollapsed && <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-300/50">Developer</div>}
              {DEVELOPER_NAVIGATION.map(item => (
                <NavLink
                  key={item.view}
                  to={`/developer?view=${item.view}`}
                  title={navigationCollapsed ? item.label : undefined}
                  aria-label={navigationCollapsed ? item.label : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
                    navigationCollapsed && 'justify-center px-0',
                    developerView === item.view ? 'bg-white font-semibold text-[#1B2A4A]' : 'text-blue-100/80 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <item.Icon className="h-4 w-4 shrink-0" />
                  {!navigationCollapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ) : visibleNavSections.map(section => {
            const collapsible = section.label !== 'Overview'
            const expanded = !collapsible || openSections.has(section.label)
            const sectionActive = section.items.some(item => itemIsActive(item, location.pathname, location.search))
            return <div key={section.label}>
              {!navigationCollapsed && (collapsible ? <button type="button" aria-expanded={expanded} aria-controls={`nav-section-${section.label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => toggleSection(section.label)} className={cn('relative mb-1 flex min-h-11 w-full items-center rounded-md px-2.5 text-left text-sm font-semibold text-blue-100/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:min-h-10', sectionActive && !expanded && 'text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-amber-400')}>
                <span>{section.label}</span><ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform duration-300 ease-out motion-reduce:transition-none', !expanded && '-rotate-90')} />
              </button> : <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-blue-300/50">{section.label}</div>)}
              <div className={cn('grid', !navigationCollapsed && collapsible && 'transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none', navigationCollapsed || expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
                <div className="min-h-0 overflow-hidden">
                  <div id={`nav-section-${section.label.toLowerCase().replaceAll(' ', '-')}`} aria-hidden={!navigationCollapsed && collapsible && !expanded} inert={!navigationCollapsed && collapsible && !expanded ? true : undefined} className="space-y-0.5">
                    {section.items.map(item => item.kind === 'group'
                      ? <ReportNavGroup key={item.id} item={item} collapsed={navigationCollapsed} open={navigationCollapsed ? collapsedMenuId === item.id : openReportGroups.has(item.id)} active={itemIsActive(item, location.pathname, location.search)} onToggle={() => navigationCollapsed ? setCollapsedMenuId(current => current === item.id ? null : item.id) : toggleReportGroup(item.id)} onNavigate={() => { setMobileOpen(false); setCollapsedMenuId(null) }} pathname={location.pathname} search={location.search} />
                      : <SidebarLink key={item.to} item={item} collapsed={navigationCollapsed} active={navLinkIsActive(item, location.pathname, location.search)} onNavigate={() => setMobileOpen(false)} />)}
                  </div>
                </div>
              </div>
            </div>
          })}
          {!developerWorkspace && developerAdmin && (
            <div>
              {!navigationCollapsed && <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-300/50">
                Developer
              </div>}
              <NavLink
                to="/developer"
                title={navigationCollapsed ? 'Developer Dashboard' : undefined}
                aria-label={navigationCollapsed ? 'Developer Dashboard' : undefined}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80', navigationCollapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-white text-[#1B2A4A] font-semibold'
                      : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                  )
                }
              >
                <Code2 className="h-4 w-4 flex-shrink-0" />
                {!navigationCollapsed && <span>Developer Dashboard</span>}
              </NavLink>
            </div>
          )}
          </div>
        </nav>

        {/* Footer */}
        <div ref={accountMenuRef} className="relative shrink-0 space-y-1 border-t border-white/10 p-2">
          <NavLink
            to="/settings"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn('flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80', navigationCollapsed && 'justify-center px-0', isActive ? 'bg-white text-[#1B2A4A] font-semibold' : 'text-blue-100/80 hover:bg-white/10 hover:text-white')
            }
            title={navigationCollapsed ? 'Settings' : undefined}
            aria-label={navigationCollapsed ? 'Settings' : undefined}
          >
            <Settings className="h-4 w-4" />
            {!navigationCollapsed && <span>Settings</span>}
          </NavLink>
          <button type="button" aria-expanded={accountMenuOpen} aria-label="Account menu" title={navigationCollapsed ? 'Account menu' : undefined} onClick={() => setAccountMenuOpen(value => !value)} className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-blue-100/85 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80', navigationCollapsed && 'justify-center px-0')}><UserCircle2 className="h-4 w-4 shrink-0" />{!navigationCollapsed && <><span className="min-w-0 flex-1 truncate">Account</span><ChevronDown className={cn('h-4 w-4 transition-transform', accountMenuOpen && 'rotate-180')} /></>}</button>
          {accountMenuOpen && <div className={cn('absolute z-[90] rounded-lg border border-white/10 bg-[#10203d] p-1.5 shadow-2xl', navigationCollapsed ? 'bottom-2 left-full ml-2 hidden w-56 md:block' : 'bottom-full left-2 right-2 mb-1')}><div className="border-b border-white/10 px-3 py-2 text-xs text-blue-100/65"><span className="block font-medium text-blue-50">Signed in</span><span className="block truncate">{userId || 'Current account'}</span></div><button type="button" onClick={handleSignOut} className="mt-1 flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-sm text-blue-50 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"><LogOut className="h-4 w-4" />Sign out</button></div>}
        </div>
      </aside>

      {/* Main */}
      <main className="compact-workspace flex min-w-0 flex-1 flex-col overflow-hidden">
        {!developerWorkspace && <div className="app-shortcuts flex-shrink-0 border-b border-border bg-card px-3 py-2 pl-16 md:px-5" aria-label="Global shortcuts">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="mr-1 hidden whitespace-nowrap text-[10px] font-semibold uppercase text-muted-foreground lg:inline">Global shortcuts</span>
            <button type="button" disabled={readOnly} onClick={openNewTransactionMenu} className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 text-xs text-foreground transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45" title={readOnly ? 'Renew the company plan to create transactions.' : 'Open New Transaction menu (N)'}><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] font-semibold text-primary">N</kbd><PlusCircle className="h-3.5 w-3.5" /><span>New transaction</span></button>
            <button type="button" onClick={() => setCalculatorOpen(true)} className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 text-xs text-foreground transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Open Calculator (F2)"><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] font-semibold text-primary">F2</kbd><Calculator className="h-3.5 w-3.5" /><span>Calculator</span></button>
            {VOUCHER_SHORTCUTS.map(shortcut => <button key={shortcut.key} type="button" disabled={readOnly} onClick={() => { setMobileOpen(false); setShortcutVoucher(shortcut.type) }} className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 text-xs text-foreground transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45" title={readOnly ? 'Renew the company plan to create vouchers.' : `New ${shortcut.label} Voucher (${shortcut.key})`}>
              <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] font-semibold text-primary">{shortcut.key}</kbd>
              <span>{shortcut.label}</span>
            </button>)}
            <span aria-hidden="true" className="mx-0.5 h-5 w-px flex-shrink-0 bg-border" />
            {NAVIGATION_SHORTCUTS.map(shortcut => <button key={shortcut.key} type="button" onClick={() => { setMobileOpen(false); setShortcutVoucher(null); navigate(shortcut.to) }} className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 text-xs text-foreground transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`Open ${shortcut.label} (${shortcut.key})`}>
              <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] font-semibold text-primary">{shortcut.key}</kbd>
              <span>{shortcut.label}</span>
            </button>)}
          </div>
        </div>}
        {!developerWorkspace && breadcrumbParts.length > 1 && <nav aria-label="Breadcrumb" className="flex min-h-9 flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b bg-background px-4 pl-16 text-xs text-muted-foreground md:px-5">{breadcrumbParts.map((part, index) => <span key={`${part}:${index}`} className="flex shrink-0 items-center gap-1.5">{index > 0 && <span aria-hidden="true">/</span>}<span aria-current={index === breadcrumbParts.length - 1 ? 'page' : undefined} className={index === breadcrumbParts.length - 1 ? 'font-semibold text-foreground' : ''}>{part}</span></span>)}</nav>}
        <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto">
          {planInactive && !developerAdmin && <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"><strong>Read-only:</strong> This company trial or paid plan has expired. You can view, print, and export existing data, but changes are disabled until KhataERP support renews the plan.</div>}
          {!developerWorkspace && <AccountingSyncStatus />}
          <Outlet />
        </div>
      </main>
      {!developerWorkspace && (shortcutVoucher === 'Sales' || shortcutVoucher === 'Purchase') && <InvoiceForm type={shortcutVoucher} open voucher={null} onClose={() => setShortcutVoucher(null)} />}
      {!developerWorkspace && (shortcutVoucher === 'Receipt' || shortcutVoucher === 'Payment') && <ReceiptPaymentForm type={shortcutVoucher} open voucher={null} onClose={() => setShortcutVoucher(null)} />}
      {!developerWorkspace && shortcutVoucher === 'Journal' && <JournalForm open voucher={null} onClose={() => setShortcutVoucher(null)} />}
      {!developerWorkspace && <Suspense fallback={null}>
        {(shortcutVoucher === 'Income' || shortcutVoucher === 'Expense') && <SimpleEntryForm entryType={shortcutVoucher} open voucher={null} onClose={() => setShortcutVoucher(null)} />}
        {shortcutVoucher === 'Contra' && <ContraForm open voucher={null} onClose={() => setShortcutVoucher(null)} />}
        {(shortcutVoucher === 'Sales Return' || shortcutVoucher === 'Purchase Return') && <ReturnForm type={shortcutVoucher} open voucher={null} onClose={() => setShortcutVoucher(null)} />}
        {shortcutVoucher === 'Stock Adjustment' && <StockAdjustmentForm open voucher={null} onClose={() => setShortcutVoucher(null)} />}
      </Suspense>}
      <PopupCalculator open={calculatorOpen} onOpenChange={setCalculatorOpen} />
    </div>
  )
}
