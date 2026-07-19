import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { isDeveloperAdmin, signOut } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
  BookOpen, Users, Package, Scale, BarChart2, FileText,
  Percent, Boxes, Settings, LogOut, ChevronDown, ChevronRight, Code2, CalendarDays, Library, Database, Undo2, Redo2, Menu, X, ListTree, WalletCards, Clock3, Files, Landmark, Plus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { JournalForm, ReceiptPaymentForm } from '@/components/forms/OtherForms'
import { chequeEntitlement } from '@/lib/cheques'

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
      { to: '/cheques/new', label: 'Create Cheque', Icon: Plus },
      { to: '/cheques/pending', label: 'Pending Cheques', Icon: Clock3 },
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
  const reports = NAV_SECTIONS.find(section => section.label === 'Reports')
  const group = reports?.items.find(item => item.kind === 'group' && itemIsActive(item, pathname, search))
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
          <button
            onClick={() => navigate('/settings')}
            className="mt-3 w-full text-left text-xs text-blue-100/80 bg-white/5 hover:bg-white/10 rounded px-2.5 py-1.5 transition-colors truncate flex items-center gap-1"
          >
            {company?.name ?? '…'}
            <ChevronRight className="h-3 w-3 ml-auto flex-shrink-0" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-4">
          {NAV_SECTIONS.map(section => {
            if (section.label === 'Cheque Management' && !showChequeNavigation) return null
            const collapsible = section.label !== 'Overview'
            const expanded = !collapsible || openSections.has(section.label)
            const visibleItems = section.items.filter(item => {
              if (item.kind === 'group') return true
              if (!vatEnabled && item.to === '/vat-report') return false
              if (section.label !== 'Cheque Management') return true
              if (item.to === '/cheques/new') return chequeAccess.canWrite && chequePermissions.includes('cheque.create')
              if (item.to === '/cheques/banks') return chequeAccess.canWrite && chequePermissions.includes('cheque.manage_banks')
              if (item.to === '/cheques/parties') return chequePermissions.includes('cheque.view_parties')
              return chequePermissions.includes('cheque.view')
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
