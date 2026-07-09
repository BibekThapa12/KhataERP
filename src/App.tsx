import { Component, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { logAppError, supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { SalesPage } from '@/pages/Sales'
import { PurchasePage } from '@/pages/Purchase'
import { ReceiptsPage } from '@/pages/Receipts'
import { PaymentsPage } from '@/pages/Payments'
import { JournalPage } from '@/pages/Journal'
import { PartiesPage } from '@/pages/Parties'
import { ItemsPage } from '@/pages/Items'
import { AccountsPage } from '@/pages/Accounts'
import { TrialBalancePage } from '@/pages/reports/TrialBalance'
import { ProfitLossPage } from '@/pages/reports/ProfitLoss'
import { BalanceSheetPage } from '@/pages/reports/BalanceSheet'
import { VatReportPage } from '@/pages/reports/VatReport'
import { StockReportPage } from '@/pages/reports/StockReport'
import { SettingsPage } from '@/pages/Settings'
import { DeveloperDashboard } from '@/pages/DeveloperDashboard'

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
  }, [])

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
        <Routes>
          <Route path="/login" element={!authReady ? <FullPageStatus message="Checking session..." /> : userId ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/" element={<ProtectedRoute authReady={authReady}><AppShell /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="purchase" element={<PurchasePage />} />
            <Route path="purchases" element={<PurchasePage />} />
            <Route path="receipts" element={<ReceiptsPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="transactions" element={<Navigate to="/sales" replace />} />
            <Route path="transactions/sales" element={<SalesPage />} />
            <Route path="transactions/purchase" element={<PurchasePage />} />
            <Route path="transactions/purchases" element={<PurchasePage />} />
            <Route path="transactions/receipts" element={<ReceiptsPage />} />
            <Route path="transactions/payments" element={<PaymentsPage />} />
            <Route path="transactions/journal" element={<JournalPage />} />
            <Route path="parties" element={<PartiesPage />} />
            <Route path="items" element={<ItemsPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="trial-balance" element={<TrialBalancePage />} />
            <Route path="profit-loss" element={<ProfitLossPage />} />
            <Route path="balance-sheet" element={<BalanceSheetPage />} />
            <Route path="vat-report" element={<VatReportPage />} />
            <Route path="stock-report" element={<StockReportPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="developer" element={<DeveloperDashboard />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}
