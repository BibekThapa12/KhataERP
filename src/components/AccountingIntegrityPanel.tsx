import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { isDeveloperAdmin, supabase } from '@/lib/supabase'
import { fetchCompanySnapshot } from '@/lib/companySnapshot'
import { checkAccountingIntegrity, type IntegrityManifest } from '@/lib/accountingIntegrity'
import { publicErrorMessage } from '@/lib/security'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function AccountingIntegrityPanel() {
  const company = useAppStore(s => s.company)
  const userId = useAppStore(s => s.userId)
  const memberships = useAppStore(s => s.companyMemberships)
  const [developer, setDeveloper] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<ReturnType<typeof checkAccountingIntegrity> | null>(null)
  useEffect(() => {
    let active = true
    setDeveloper(false)
    void isDeveloperAdmin().then(value => { if (active) setDeveloper(value) })
    return () => { active = false }
  }, [userId])
  useEffect(() => { setReport(null); setError('') }, [company?.id, userId])
  const allowed = developer || memberships.some(m => m.company_id === company?.id && m.role === 'Admin' && m.status === 'active')
  if (!company || !allowed) return null
  const visibleReport = report?.company_id === company.id ? report : null
  return <Card>
    <CardHeader><CardTitle className="text-base">Accounting Integrity Check (read-only)</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="text-muted-foreground">Compare full company history with the loaded client and administrator database counts. No vouchers, masters, balances, or stock records are changed.</p>
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setReport(null)
        const before = useAppStore.getState()
        const stillCurrent = () => useAppStore.getState().company?.id === company.id && useAppStore.getState().userId === userId
        try {
          // Authorization also enforced by the RPC; this UI gate is not security.
          const manifestResult = await supabase.rpc('accounting_integrity_manifest', { target_company: company.id })
          if (manifestResult.error?.code === '42501') throw manifestResult.error
          const snapshot = await fetchCompanySnapshot(company)
          if (!stillCurrent()) return
          const result = checkAccountingIntegrity({ company, ...snapshot }, before.vouchers.map(v => v.id), manifestResult.error ? null : manifestResult.data as IntegrityManifest)
          if (manifestResult.error) result.anomalies.push({ company_id: company.id, voucher_id: null, reference: null, check: 'manifest_request_failed', severity: 'unavailable', evidence: publicErrorMessage(manifestResult.error, 'reading database integrity manifest') })
          setReport(result)
        } catch (e) {
          if (stillCurrent()) setError(publicErrorMessage(e, 'checking accounting integrity'))
        } finally { setBusy(false) }
      }}>{busy ? 'Checking…' : 'Run read-only check'}</Button>
      {error && <p role="alert" className="text-destructive">{error} No complete report was produced.</p>}
      {visibleReport && <>
        <p>{visibleReport.api_counts.vouchers} API vouchers; {visibleReport.client_voucher_count} loaded client vouchers. {visibleReport.anomalies.length} findings (including unavailable checks).</p>
        {!visibleReport.database && <p className="text-amber-700">Database comparison unavailable. This is not a clean database audit. Apply the diagnostic migration in staging first.</p>}
        <Button variant="outline" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(visibleReport, null, 2)], { type: 'application/json' }))
          const a = document.createElement('a'); a.href = url; a.download = `accounting-integrity-${company.id}.json`; a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}>Export evidence (JSON)</Button>
        <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Reference / ID</th><th>Check</th><th>Severity</th></tr></thead><tbody>
          {visibleReport.anomalies.slice(0, 100).map((a, i) => <tr key={i} className="border-t"><td className="py-2">{a.reference || a.voucher_id || 'Company'}</td><td>{a.check}</td><td>{a.severity}</td></tr>)}
        </tbody></table></div>
        {visibleReport.anomalies.length > 100 && <p>Showing the first 100 findings. Export contains all findings.</p>}
      </>}
    </CardContent>
  </Card>
}
