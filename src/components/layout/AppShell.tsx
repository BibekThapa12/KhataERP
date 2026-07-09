import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { signOut } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
  BookOpen, Users, Package, List, Scale, BarChart2, FileText,
  Receipt, Percent, Boxes, Settings, LogOut, ChevronRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/misc'

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
      { to: '/receipts', label: 'Receipts', Icon: ArrowDownCircle },
      { to: '/payments', label: 'Payments', Icon: ArrowUpCircle },
      { to: '/journal', label: 'Journal Entries', Icon: BookOpen },
    ],
  },
  {
    label: 'Masters',
    items: [
      { to: '/parties', label: 'Parties', Icon: Users },
      { to: '/items', label: 'Items & Stock', Icon: Package },
      { to: '/accounts', label: 'Chart of Accounts', Icon: List },
    ],
  },
  {
    label: 'Reports',
    items: [
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

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-[#1B2A4A] flex flex-col overflow-y-auto">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-white/10">
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
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-white/10 space-y-1">
          <NavLink
            to="/settings"
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
