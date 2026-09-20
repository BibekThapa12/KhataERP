import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

export function AccountingSyncStatus() {
  const stale = useAppStore(s => s.dataStale)
  const error = useAppStore(s => s.error)
  const company = useAppStore(s => s.company)
  const reconcile = useAppStore(s => s.reconcileCompany)
  const [retrying, setRetrying] = useState(false)
  if (!stale || !company) return null
  return <div role="status" className="print:hidden border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
    {error || 'Refreshing accounting data. Displayed balances and stock may be out of date.'}
    {error && <Button size="sm" variant="outline" className="ml-3" disabled={retrying} onClick={async () => {
      setRetrying(true)
      try { await reconcile(company.id) } finally { setRetrying(false) }
    }}>Retry refresh</Button>}
  </div>
}
