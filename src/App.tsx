import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { logAppError, supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import { AppShell } from '@/components/layout/AppShell'

const LoginPage = lazy(() => import('@/pages/Login').then(m => ({ default: m.LoginPage })))
const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const SalesPage = lazy(() => import('@/pages/Sales').then(m => ({ default: m.SalesPage })))
const PurchasePage = lazy(() => import('@/pages/Purchase').then(m => ({ default: m.PurchasePage })))
const SalesReturnPage = lazy(() => import('@/pages/SalesReturn').then(m => ({ default: m.SalesReturnPage })))
const PurchaseReturnPage = lazy(() => import('@/pages/PurchaseReturn').then(m => ({ default: m.PurchaseReturnPage })))
const ReceiptsPage = lazy(() => import('@/pages/Receipts').then(m => ({ default: m.ReceiptsPage })))
const PaymentsPage = lazy(() => import('@/pages/Payments').then(m => ({ default: m.PaymentsPage })))
const JournalPage = lazy(() => import('@/pages/Journal').then(m => ({ default: m.JournalPage })))
const PartiesPage = lazy(() => import('@/pages/Parties').then(m => ({ default: m.PartiesPage })))
const ItemsPage = lazy(() => import('@/pages/Items').then(m => ({ default: m.ItemsPage })))
const AccountsPage = lazy(() => import('@/pages/Accounts').then(m => ({ default: m.AccountsPage })))
const MastersPage = lazy(() => import('@/pages/Masters').then(m => ({ default: m.MastersPage })))
const TrialBalancePage = lazy(() => import('@/pages/reports/TrialBalance').then(m => ({ default: m.TrialBalancePage })))
const ProfitLossPage = lazy(() => import('@/pages/reports/ProfitLoss').then(m => ({ default: m.ProfitLossPage })))
const BalanceSheetPage = lazy(() => import('@/pages/reports/BalanceSheet').then(m => ({ default: m.BalanceSheetPage })))
const VatReportPage = lazy(() => import('@/pages/reports/VatReport').then(m => ({ default: m.VatReportPage })))
const StockReportPage = lazy(() => import('@/pages/reports/StockReport').then(m => ({ default: m.StockReportPage })))
const DaybookPage = lazy(() => import('@/pages/reports/Daybook').then(m => ({ default: m.DaybookPage })))
const LedgerReportPage = lazy(() => import('@/pages/reports/LedgerReport').then(m => ({ default: m.LedgerReportPage })))
const CashFlowPage = lazy(() => import('@/pages/reports/CashFlow').then(m => ({ default: m.CashFlowPage })))
const SettingsPage = lazy(() => import('@/pages/Settings').then(m => ({ default: m.SettingsPage })))
const DeveloperDashboard = lazy(() => import('@/pages/DeveloperDashboard').then(m => ({ default: m.DeveloperDashboard })))

class AppErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-lg rounded-lg border bg-card p-5 shadow-sm">
            <h1 className="font-serif text-xl font-bold text-destructive">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The app hit a runtime error while opening this page.
            </p>
            <pre className="mt-4 overflow-auto rounded bg-muted p-3 text-xs text-foreground">
              {this.state.error.message}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function FullPageStatus({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function ProtectedRoute({ children, authReady }: { children: React.ReactNode; authReady: boolean }) {
  const userId = useAppStore(s => s.userId)
  if (!authReady) return <FullPageStatus message="Checking session..." />
  if (!userId) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const { userId, company, setUserId, loadAll } = useAppStore()
  const [authReady, setAuthReady] = useState(false)
  const refreshTimer = useRef<number | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null
      setUserId(uid)
      if (uid) loadAll(uid)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null
      setUserId(uid)
      if (uid) loadAll(uid)
      setAuthReady(true)
    })
    return () => subscription.unsubscribe()
  }, [loadAll, setUserId])

  useEffect(() => {
    if (!userId) return

    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(() => {
        loadAll(userId)
        refreshTimer.current = null
      }, 500)
    }

    const channel = supabase
      .channel(`company-sync-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vouchers' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voucher_lines' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_lines' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_items' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'account_categories' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_categories' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current)
        refreshTimer.current = null
      }
      supabase.removeChannel(channel)
    }
  }, [userId, loadAll])

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      logAppError(company?.id, event.error || event.message, {
        source: 'window_error',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      logAppError(company?.id, event.reason, { source: 'unhandled_rejection' })
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [company?.id])

  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<FullPageStatus message="Loading page..." />}>
        <Routes>
          <Route path="/login" element={!authReady ? <FullPageStatus message="Checking session..." /> : userId ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/" element={<ProtectedRoute authReady={authReady}><AppShell /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="purchase" element={<PurchasePage />} />
            <Route path="sales-returns" element={<SalesReturnPage />} />
            <Route path="purchase-returns" element={<PurchaseReturnPage />} />
            <Route path="purchases" element={<PurchasePage />} />
            <Route path="receipts" element={<ReceiptsPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="transactions" element={<Navigate to="/sales" replace />} />
            <Route path="transactions/sales" element={<SalesPage />} />
            <Route path="transactions/purchase" element={<PurchasePage />} />
            <Route path="transactions/purchases" element={<PurchasePage />} />
            <Route path="transactions/sales-returns" element={<SalesReturnPage />} />
            <Route path="transactions/purchase-returns" element={<PurchaseReturnPage />} />
            <Route path="transactions/receipts" element={<ReceiptsPage />} />
            <Route path="transactions/payments" element={<PaymentsPage />} />
            <Route path="transactions/journal" element={<JournalPage />} />
            <Route path="parties" element={<PartiesPage />} />
            <Route path="items" element={<ItemsPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="masters" element={<MastersPage />} />
            <Route path="trial-balance" element={<TrialBalancePage />} />
            <Route path="profit-loss" element={<ProfitLossPage />} />
            <Route path="balance-sheet" element={<BalanceSheetPage />} />
            <Route path="vat-report" element={<VatReportPage />} />
            <Route path="stock-report" element={<StockReportPage />} />
            <Route path="reports/daybook" element={<DaybookPage />} />
            <Route path="reports/ledger" element={<LedgerReportPage />} />
            <Route path="reports/cash-flow" element={<CashFlowPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="developer" element={<DeveloperDashboard />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}
