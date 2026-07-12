import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { isDeveloperAdmin, signOut } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
  BookOpen, Users, Package, Scale, BarChart2, FileText,
  Percent, Boxes, Settings, LogOut, ChevronRight, Code2, CalendarDays, Library, Database, Undo2, Redo2, Menu, X
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const NAV_SECTIONS: {
  label: string
  items: { to: string; label: string; Icon: React.ComponentType<{ className?: string }>; end?: boolean }[]
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
      { to: '/masters', label: 'Alter Masters', Icon: Database },
      { to: '/parties', label: 'Parties', Icon: Users },
      { to: '/items', label: 'Items & Stock', Icon: Package },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/reports/daybook', label: 'Daybook', Icon: CalendarDays },
      { to: '/reports/ledger', label: 'Ledger Report', Icon: Library },
      { to: '/trial-balance', label: 'Trial Balance', Icon: Scale },
      { to: '/profit-loss', label: 'Profit & Loss', Icon: BarChart2 },
      { to: '/balance-sheet', label: 'Balance Sheet', Icon: FileText },
      { to: '/vat-report', label: 'VAT Report', Icon: Percent },
      { to: '/stock-report', label: 'Stock Summary', Icon: Boxes },
    ],
  },
]

export function AppShell() {
  const company = useAppStore(s => s.company)
  const navigate = useNavigate()
  const vatEnabled = company?.vat_enabled ?? true
  const [developerAdmin, setDeveloperAdmin] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    isDeveloperAdmin().then(setDeveloperAdmin)
  }, [])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  if (company?.suspended && !developerAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="font-serif text-2xl font-bold text-foreground">Account suspended</h1>
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
    <div className="flex h-dvh overflow-hidden bg-background">
      <button type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-md border bg-background shadow-sm md:hidden">
        <Menu className="h-5 w-5" />
      </button>
      {mobileOpen && <button type="button" aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/45 md:hidden" />}
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
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-300/50">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items
                  .filter(item => vatEnabled || item.to !== '/vat-report')
                  .map(({ to, label, Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
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
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
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
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
