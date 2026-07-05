import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const userId = useAppStore(s => s.userId)
  if (!userId) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const { userId, setUserId, loadAll } = useAppStore()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null
      setUserId(uid)
      if (uid) loadAll(uid)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null
      setUserId(uid)
      if (uid) loadAll(uid)
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={userId ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="purchase" element={<PurchasePage />} />
          <Route path="receipts" element={<ReceiptsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="journal" element={<JournalPage />} />
          <Route path="parties" element={<PartiesPage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="trial-balance" element={<TrialBalancePage />} />
          <Route path="profit-loss" element={<ProfitLossPage />} />
          <Route path="balance-sheet" element={<BalanceSheetPage />} />
          <Route path="vat-report" element={<VatReportPage />} />
          <Route path="stock-report" element={<StockReportPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
