import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { isDeveloperAdmin, signOut } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
  BookOpen, Users, Package, Scale, BarChart2, FileText,
  Percent, Boxes, Settings, LogOut, ChevronDown, Code2, CalendarDays, Library, Database, Undo2, Redo2, Menu, X, ListTree, WalletCards, Clock3, Files, Landmark, Plus, CheckCircle2, ArrowLeftRight
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

type NavIcon = React.ComponentType<{ className?: string }>
type NavLinkItem = { kind?: 'link'; to: string; label: string; Icon: NavIcon; end?: boolean }
type NavGroupItem = { kind: 'group'; id: string; label: string; Icon: NavIcon; matchPath?: string; children: NavLinkItem[] }
type NavItem = NavLinkItem | NavGroupItem
type VoucherShortcutType = 'Payment' | 'Receipt' | 'Journal' | 'Sales' | 'Purchase'

const VOUCHER_SHORTCUTS = [
  { key: 'F5', label: 'Payment', type: 'Payment' },
  { key: 'F6', label: 'Receipt', type: 'Receipt' },
  { key: 'F7', label: 'Journal', type: 'Journal' },
  { key: 'F8', label: 'Sales', type: 'Sales' },
  { key: 'F9', label: 'Purchase', type: 'Purchase' },
] as const satisfies ReadonlyArray<{ key: string; label: string; type: VoucherShortcutType }>

const NAVIGATION_SHORTCUTS = [
  { key: 'D', label: 'Daybook', to: '/reports/daybook' },
  { key: 'P', label: 'Parties', to: '/parties' },
  { key: 'S', label: 'Stock Summary', to: '/stock-report' },
  { key: 'L', label: 'Ledger / Group', to: '/reports/ledger' },
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
      { to: '/sales-returns', label: 'Sales Returns', Icon: Undo2 },
      { to: '/purchase-returns', label: 'Purchase Returns', Icon: Redo2 },
      { to: '/receipts', label: 'Receipts', Icon: ArrowDownCircle },
      { to: '/payments', label: 'Payments', Icon: ArrowUpCircle },
      { to: '/transactions/income', label: 'Add Income', Icon: TrendingUp },
      { to: '/transactions/expenses', label: 'Add Expense', Icon: TrendingDown },
      { to: '/transactions/contra', label: 'Contra', Icon: ArrowLeftRight },
      { to: '/journal', label: 'Journal Entries', Icon: BookOpen },
    ],
  },
  {
    label: 'Masters',
    items: [
      { to: '/accounts', label: 'Chart of Accounts', Icon: ListTree },
      { to: '/masters', label: 'Alter Masters', Icon: Database },
      { to: '/parties', label: 'Parties', Icon: Users },
      { to: '/items', label: 'Items & Stock', Icon: Package },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/reports/daybook', label: 'Daybook', Icon: CalendarDays },
      { to: '/reports/ledger', label: 'Ledger / Group Reports', Icon: Library },
      { to: '/reports/registers', label: 'Transaction Registers', Icon: Files },
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
      { to: '/cheques/parties', label: 'Parties', Icon: Users },
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

function SidebarLink({ item, active, onNavigate, child = false }: { item: NavLinkItem; active: boolean; onNavigate: () => void; child?: boolean }) {
  const Icon = item.Icon
  return <NavLink
    to={item.to}
    end={item.end}
    onClick={onNavigate}
    className={cn(
      'flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
      child && 'relative py-1.5 pl-4 before:absolute before:-left-3 before:top-1/2 before:h-px before:w-3 before:bg-blue-200/20',
      active ? 'bg-white font-semibold text-[#1B2A4A]' : 'text-blue-100/80 hover:bg-white/10 hover:text-white',
    )}
  >
    {!child && <Icon className="h-4 w-4 flex-shrink-0" />}
    <span className="min-w-0 truncate">{item.label}</span>
  </NavLink>
}

function ReportNavGroup({ item, open, active, onToggle, onNavigate, pathname, search }: { item: NavGroupItem; open: boolean; active: boolean; onToggle: () => void; onNavigate: () => void; pathname: string; search: string }) {
  const Icon = item.Icon
  const contentId = `report-nav-${item.id}`
  return <div>
    <button type="button" aria-expanded={open} aria-controls={contentId} onClick={onToggle} className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/10 hover:text-white', active ? 'font-semibold text-white' : 'text-blue-100/80')}>
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

function CompanySwitcher({ onSwitched }: { onSwitched: () => void }) {
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
    <div ref={switcherRef} className="relative mt-3">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-1 rounded bg-white/5 px-2.5 py-1.5 text-left text-xs text-blue-100/80 transition-colors hover:bg-white/10">
        <span className="min-w-0 flex-1 truncate">{company?.name ?? 'Loading company...'}</span>
        <ChevronDown className={cn('h-3 w-3 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-md border border-white/10 bg-[#10203d] p-2 shadow-xl">
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
  const navigate = useNavigate()
  const location = useLocation()
  const vatEnabled = company?.vat_enabled ?? true
  const companyModules = useAppStore(s => s.companyModules)
  const chequePermissions = useAppStore(s => s.chequePermissions)
  const chequeAccess = chequeEntitlement(companyModules.find(entry => entry.module?.key === 'cheque_management'))
  const showChequeNavigation = chequeAccess.canRead && chequePermissions.includes('cheque.view')
  const [developerAdmin, setDeveloperAdmin] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [shortcutVoucher, setShortcutVoucher] = useState<VoucherShortcutType | null>(null)
  const [openReportGroup, setOpenReportGroup] = useState<string | null>(() => activeReportGroupId(location.pathname, location.search))
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const active = NAV_SECTIONS.find(section => section.items.some(item => itemIsActive(item, location.pathname, location.search)))
    return new Set(active && active.label !== 'Overview' ? [active.label] : [])
  })

  useEffect(() => {
    isDeveloperAdmin().then(setDeveloperAdmin)
  }, [])

  useEffect(() => {
    const active = NAV_SECTIONS.find(section => section.items.some(item => itemIsActive(item, location.pathname, location.search)))
    if (!active) return
    const activeLabel = active.label === 'Overview' ? null : active.label
    setOpenSections(current => {
      if (activeLabel && current.size === 1 && current.has(activeLabel)) return current
      if (!activeLabel && current.size === 0) return current
      return new Set(activeLabel ? [activeLabel] : [])
    })
  }, [location.pathname, location.search])

  useEffect(() => {
    setOpenReportGroup(activeReportGroupId(location.pathname, location.search))
  }, [location.pathname, location.search])

  useEffect(() => {
    const openVoucherFromKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const key = event.key.toUpperCase()
      const voucherShortcut = VOUCHER_SHORTCUTS.find(entry => entry.key === key)
      const navigationShortcut = NAVIGATION_SHORTCUTS.find(entry => entry.key === key)
      if (!voucherShortcut && !navigationShortcut) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      if (event.repeat) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      setMobileOpen(false)
      if (voucherShortcut) setShortcutVoucher(voucherShortcut.type)
      else if (navigationShortcut) { setShortcutVoucher(null); navigate(navigationShortcut.to) }
    }
    window.addEventListener('keydown', openVoucherFromKey)
    return () => window.removeEventListener('keydown', openVoucherFromKey)
  }, [navigate])

  const toggleSection = (label: string) => setOpenSections(current => {
    return current.has(label) ? new Set() : new Set([label])
  })

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const trialExpired = company?.plan_status === 'trial' && !!company.trial_ends_at
    && new Date(`${company.trial_ends_at}T23:59:59`).getTime() < Date.now()
  const planInactive = company?.plan_status === 'expired' || trialExpired

  if ((company?.suspended || planInactive) && !developerAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="font-serif text-2xl font-bold text-foreground">{company?.suspended ? 'Account suspended' : 'Plan inactive'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {company?.suspended
              ? 'This company is temporarily suspended. Please contact KhataERP support to continue using the app.'
              : 'This company trial or subscription has ended. Please contact KhataERP support to continue using the app.'}
          </p>
          <Button onClick={handleSignOut} className="mt-5">
            Sign out
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <button type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="app-mobile-nav fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-md border bg-background shadow-sm md:hidden">
        <Menu className="h-5 w-5" />
      </button>
      {mobileOpen && <button type="button" aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} className="app-mobile-nav fixed inset-0 z-40 bg-black/45 md:hidden" />}
      {/* Sidebar */}
      <aside className={cn('fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-shrink-0 flex-col overflow-y-auto bg-[#1B2A4A] transition-transform md:static md:w-56 md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        {/* Brand */}
        <div className="relative px-4 py-5 border-b border-white/10">
          <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 md:hidden"><X className="h-5 w-5" /></button>
          <div className="font-serif text-2xl font-bold text-white tracking-tight">Khata</div>
          <div className="text-[10px] uppercase tracking-widest text-blue-200/70 mt-0.5">ERP for Nepal</div>
          <CompanySwitcher onSwitched={() => { setMobileOpen(false); navigate('/') }} />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-4">
          {NAV_SECTIONS.map(section => {
            if (section.label === 'Cheque Management' && !showChequeNavigation) return null
            const collapsible = section.label !== 'Overview'
            const expanded = !collapsible || openSections.has(section.label)
            const chequeItemVisible = (item: NavLinkItem) => {
              if (item.to.endsWith('/new')) return chequeAccess.canWrite && chequePermissions.includes('cheque.create')
              if (item.to === '/cheques/banks') return chequeAccess.canWrite && chequePermissions.includes('cheque.manage_banks')
              if (item.to === '/cheques/parties') return chequePermissions.includes('cheque.view_parties')
              return chequePermissions.includes('cheque.view')
            }
            const visibleItems = section.items.map(item => {
              if (item.kind === 'group' && section.label === 'Cheque Management') {
                return { ...item, children: item.children.filter(chequeItemVisible) }
              }
              return item
            }).filter(item => {
              if (item.kind === 'group') return item.children.length > 0
              if (!vatEnabled && item.to === '/vat-report') return false
              if (section.label !== 'Cheque Management') return true
              return chequeItemVisible(item)
            })
            return <div key={section.label}>
              {collapsible ? <button type="button" aria-expanded={expanded} aria-controls={`nav-section-${section.label.toLowerCase()}`} onClick={() => toggleSection(section.label)} className="mb-1 flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs font-medium uppercase tracking-wider text-blue-100/75 transition-colors hover:bg-white/10 hover:text-white">
                <span>{section.label}</span><ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform duration-300 ease-out motion-reduce:transition-none', !expanded && '-rotate-90')} />
              </button> : <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-300/50">{section.label}</div>}
              <div className={cn('grid', collapsible && 'transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none', expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
                <div className="min-h-0 overflow-hidden">
                  <div id={`nav-section-${section.label.toLowerCase()}`} aria-hidden={collapsible && !expanded} inert={collapsible && !expanded ? true : undefined} className="space-y-0.5">
                    {visibleItems.map(item => item.kind === 'group'
                      ? <ReportNavGroup key={item.id} item={item} open={openReportGroup === item.id} active={itemIsActive(item, location.pathname, location.search)} onToggle={() => setOpenReportGroup(current => current === item.id ? null : item.id)} onNavigate={() => setMobileOpen(false)} pathname={location.pathname} search={location.search} />
                      : <SidebarLink key={item.to} item={item} active={navLinkIsActive(item, location.pathname, location.search)} onNavigate={() => setMobileOpen(false)} />)}
                  </div>
                </div>
              </div>
            </div>
          })}
          {developerAdmin && (
            <div>
              <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-300/50">
                Developer
              </div>
              <NavLink
                to="/developer"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-white text-[#1B2A4A] font-semibold'
                      : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                  )
                }
              >
                <Code2 className="h-4 w-4 flex-shrink-0" />
                <span>Developer Dashboard</span>
              </NavLink>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-white/10 space-y-1">
          <NavLink
            to="/settings"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn('flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors', isActive ? 'bg-white text-[#1B2A4A] font-semibold' : 'text-blue-100/80 hover:bg-white/10 hover:text-white')
            }
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </NavLink>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="w-full justify-start gap-2.5 text-blue-100/80 hover:bg-white/10 hover:text-white px-2.5"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="compact-workspace flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="app-shortcuts flex-shrink-0 border-b border-border bg-card px-3 py-2 pl-16 md:px-5" aria-label="Quick shortcuts">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="mr-1 hidden whitespace-nowrap text-[10px] font-semibold uppercase text-muted-foreground lg:inline">Quick shortcuts</span>
            {VOUCHER_SHORTCUTS.map(shortcut => <button key={shortcut.key} type="button" onClick={() => { setMobileOpen(false); setShortcutVoucher(shortcut.type) }} className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 text-xs text-foreground transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`New ${shortcut.label} Voucher (${shortcut.key})`}>
              <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] font-semibold text-primary">{shortcut.key}</kbd>
              <span>{shortcut.label}</span>
            </button>)}
            <span aria-hidden="true" className="mx-0.5 h-5 w-px flex-shrink-0 bg-border" />
            {NAVIGATION_SHORTCUTS.map(shortcut => <button key={shortcut.key} type="button" onClick={() => { setMobileOpen(false); setShortcutVoucher(null); navigate(shortcut.to) }} className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 text-xs text-foreground transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={`Open ${shortcut.label} (${shortcut.key})`}>
              <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] font-semibold text-primary">{shortcut.key}</kbd>
              <span>{shortcut.label}</span>
            </button>)}
          </div>
        </div>
        <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
      {(shortcutVoucher === 'Sales' || shortcutVoucher === 'Purchase') && <InvoiceForm type={shortcutVoucher} open voucher={null} onClose={() => setShortcutVoucher(null)} />}
      {(shortcutVoucher === 'Receipt' || shortcutVoucher === 'Payment') && <ReceiptPaymentForm type={shortcutVoucher} open voucher={null} onClose={() => setShortcutVoucher(null)} />}
      {shortcutVoucher === 'Journal' && <JournalForm open voucher={null} onClose={() => setShortcutVoucher(null)} />}
    </div>
  )
}
