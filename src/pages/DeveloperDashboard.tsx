import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Building2, Database, ShieldCheck, Users } from 'lucide-react'
import {
  checkSupabaseConnectionStatus,
  deleteDeveloperCompany,
  fetchDeveloperDashboardData,
  fetchDeveloperSchemaStatus,
  isDeveloperAdmin,
  updateDeveloperCompany,
  type DeveloperSchemaStatusItem,
} from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import { recomputeStock } from '@/lib/engine'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { StatCard } from '@/components/StatCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, Textarea } from '@/components/ui/misc'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import type { Account, Company, Item, Party, Voucher } from '@/types'

type DeveloperEvent = {
  id: string
  company_id: string | null
  event_type: string
  metadata?: Record<string, unknown>
  created_at: string
}

interface DeveloperData {
  companies: Company[]
  accounts: Account[]
  parties: Party[]
  items: Item[]
  vouchers: Voucher[]
  events: DeveloperEvent[]
}

type SupabaseStatus = Awaited<ReturnType<typeof checkSupabaseConnectionStatus>>

const today = new Date()
const daysAgo = (date?: string) => {
  if (!date) return Infinity
  return Math.floor((today.getTime() - new Date(date).getTime()) / 86400000)
}

function countBy<T>(rows: T[], getKey: (row: T) => string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = getKey(row)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function StatusPill({ label, status }: { label: string; status: 'ok' | 'error' | 'checking' | string }) {
  const variant = status === 'ok' ? 'sales' : status === 'error' ? 'destructive' : 'outline'
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Badge variant={variant}>{status === 'ok' ? 'Connected' : status === 'error' ? 'Issue' : status}</Badge>
    </div>
  )
}

function EventMetadata({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span className="text-muted-foreground">No metadata</span>
  }

  return (
    <pre className="mt-2 max-h-28 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed text-muted-foreground">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  )
}

function safeFileName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company'
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function DeveloperCompanyRow({
  company,
  data,
  voucherCount,
  partyCount,
  itemCount,
  lastActivity,
  onSaved,
}: {
  company: Company
  data: DeveloperData
  voucherCount: number
  partyCount: number
  itemCount: number
  lastActivity?: string
  onSaved: () => void
}) {
  const [plan, setPlan] = useState(company.plan_status || 'trial')
  const [trialEndsAt, setTrialEndsAt] = useState(company.trial_ends_at || '')
  const [support, setSupport] = useState(company.support_status || 'normal')
  const [notes, setNotes] = useState(company.developer_notes || '')
  const [suspended, setSuspended] = useState(company.suspended || false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const save = async () => {
    setSaving(true)
    await updateDeveloperCompany(company.id, {
      plan_status: plan as Company['plan_status'],
      trial_ends_at: trialEndsAt || undefined,
      support_status: support as Company['support_status'],
      developer_notes: notes,
      suspended,
    })
    setSaving(false)
    onSaved()
  }

  const exportAndDelete = async () => {
    const confirmed = window.confirm(
      `This will export and permanently delete ${company.name} with its related data. Continue?`
    )
    if (!confirmed) return

    const companyVouchers = data.vouchers.filter(v => v.company_id === company.id)
    const voucherIds = new Set(companyVouchers.map(v => v.id))
    const backup = {
      exported_at: new Date().toISOString(),
      export_reason: 'developer_company_delete',
      company,
      accounts: data.accounts.filter(a => a.company_id === company.id),
      parties: data.parties.filter(p => p.company_id === company.id),
      items: data.items.filter(i => i.company_id === company.id),
      vouchers: companyVouchers,
      events: data.events.filter(e => e.company_id === company.id),
      summary: {
        accounts: data.accounts.filter(a => a.company_id === company.id).length,
        parties: data.parties.filter(p => p.company_id === company.id).length,
        items: data.items.filter(i => i.company_id === company.id).length,
        vouchers: companyVouchers.length,
        voucher_ids: Array.from(voucherIds),
      },
    }

    downloadJson(
      `${safeFileName(company.name)}-${new Date().toISOString().slice(0, 10)}-before-delete.json`,
      backup
    )

    const typedName = window.prompt(`Type DELETE to permanently delete ${company.name}.`)
    if (typedName !== 'DELETE') return

    setDeleting(true)
    try {
      await deleteDeveloperCompany(company.id)
      onSaved()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-3">
        <p className="font-semibold">{company.name}</p>
        <p className="text-xs text-muted-foreground">{company.owner_email || company.user_id}</p>
        <p className="text-xs text-muted-foreground">{company.phone || company.address || ''}</p>
      </td>
      <td className="px-3 py-3 text-sm">
        <p>{voucherCount} voucher(s)</p>
        <p>{partyCount} parties</p>
        <p>{itemCount} items</p>
      </td>
      <td className="px-3 py-3 text-sm">
        <p>{lastActivity ? fmtDate(lastActivity) : 'No activity'}</p>
        <p className="text-xs text-muted-foreground">{lastActivity ? `${daysAgo(lastActivity)} day(s) ago` : 'Signed up only'}</p>
      </td>
      <td className="px-3 py-3">
        <SearchableSelect value={plan} onValueChange={setPlan} className="h-8 text-xs" options={[{ value: 'free', label: 'Free' }, { value: 'trial', label: 'Trial' }, { value: 'paid', label: 'Paid' }, { value: 'expired', label: 'Expired' }]} />
        <Input type="date" value={trialEndsAt} onChange={e => setTrialEndsAt(e.target.value)} className="mt-2 h-8 text-xs" />
      </td>
      <td className="px-3 py-3">
        <SearchableSelect value={support} onValueChange={setSupport} className="h-8 text-xs" options={[{ value: 'normal', label: 'Normal' }, { value: 'needs_help', label: 'Needs help' }, { value: 'blocked', label: 'Blocked' }]} />
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={suspended} onChange={e => setSuspended(e.target.checked)} />
          Suspended
        </label>
      </td>
      <td className="px-3 py-3 min-w-[220px]">
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Developer/support notes" />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={saving || deleting}>{saving ? 'Saving...' : 'Save'}</Button>
          <Button size="sm" variant="destructive" onClick={exportAndDelete} disabled={saving || deleting}>
            {deleting ? 'Deleting...' : 'Export + Delete'}
          </Button>
        </div>
      </td>
    </tr>
  )
}

export function DeveloperDashboard() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [data, setData] = useState<DeveloperData | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [lastSync, setLastSync] = useState('')
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatus | null>(null)
  const [schemaStatus, setSchemaStatus] = useState<{
    available: boolean
    items: DeveloperSchemaStatusItem[]
    error?: string
  } | null>(null)

  const load = async () => {
    setError('')
    try {
      const health = await checkSupabaseConnectionStatus()
      setSupabaseStatus(health)
      const isAdmin = await isDeveloperAdmin()
      setAllowed(isAdmin)
      if (!isAdmin) return
      const [next, schema] = await Promise.all([
        fetchDeveloperDashboardData(),
        fetchDeveloperSchemaStatus(),
      ])
      setData(next as DeveloperData)
      setSchemaStatus(schema)
      setLastSync(new Date().toLocaleString())
    } catch (e: unknown) {
      setError((e as Error).message)
    }
  }

  useEffect(() => { load() }, [])

  const metrics = useMemo(() => {
    const companies = data?.companies || []
    const vouchers = data?.vouchers || []
    const parties = data?.parties || []
    const items = data?.items || []
    const events = data?.events || []

    const companyIds = new Set(companies.map(c => c.id))
    const activeCompanyIds = new Set(vouchers.filter(v => daysAgo(v.created_at) <= 30).map(v => v.company_id))
    const voucherByCompany = countBy(vouchers, v => v.company_id)
    const partyByCompany = countBy(parties, p => p.company_id)
    const itemByCompany = countBy(items, i => i.company_id)
    const eventByType = countBy(events, e => e.event_type)
    const voucherByType = countBy(vouchers, v => v.type)

    const lastActivityByCompany: Record<string, string> = {}
    for (const v of vouchers) {
      const current = lastActivityByCompany[v.company_id]
      if (!current || new Date(v.created_at || v.date).getTime() > new Date(current).getTime()) {
        lastActivityByCompany[v.company_id] = v.created_at || v.date
      }
    }

    const companiesWithoutActivity = companies.filter(c => !voucherByCompany[c.id])
    const inactiveCompanies = companies.filter(c => !lastActivityByCompany[c.id] || daysAgo(lastActivityByCompany[c.id]) > 30)
    const missingFiscalYear = companies.filter(c => !c.fiscal_year_start)
    const missingSetup = companies.filter(c => !partyByCompany[c.id] || !itemByCompany[c.id])
    const missingInvoiceNo = vouchers.filter(v => ['Sales', 'Purchase', 'Sales Return', 'Purchase Return', 'Receipt', 'Payment'].includes(v.type) && !v.invoice_no)

    const stockWarnings: string[] = []
    for (const company of companies) {
      const companyItems = items.filter(i => i.company_id === company.id)
      const companyVouchers = vouchers.filter(v => v.company_id === company.id)
      const stock = recomputeStock(companyItems, companyVouchers)
      if (stock.some(s => s.qty < 0)) stockWarnings.push(company.name)
    }

    return {
      companyIds,
      activeCompanyIds,
      voucherByCompany,
      partyByCompany,
      itemByCompany,
      eventByType,
      voucherByType,
      lastActivityByCompany,
      companiesWithoutActivity,
      inactiveCompanies,
      missingFiscalYear,
      missingSetup,
      missingInvoiceNo,
      stockWarnings,
      totalVouchers: vouchers.length,
      totalParties: parties.length,
      totalItems: items.length,
      vatCompanies: companies.filter(c => c.vat_enabled !== false).length,
      internalCompanies: companies.filter(c => c.vat_enabled === false).length,
      trialCompanies: companies.filter(c => c.plan_status === 'trial').length,
      paidCompanies: companies.filter(c => c.plan_status === 'paid').length,
      suspendedCompanies: companies.filter(c => c.suspended).length,
    }
  }, [data])

  const filteredCompanies = useMemo(() => {
    const companies = data?.companies || []
    const q = query.trim().toLowerCase()
    if (!q) return companies
    return companies.filter(c =>
      [c.name, c.owner_email, c.phone, c.address, c.plan_status, c.support_status]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(q))
    )
  }, [data, query])

  if (allowed === null) {
    return <PageContent><p className="text-sm text-muted-foreground">Checking developer access...</p></PageContent>
  }

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Developer Dashboard" description="Developer admin access required" />
        <PageContent>
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Your account is not listed in `developer_admins`.</CardContent></Card>
        </PageContent>
      </div>
    )
  }

  const companies = data?.companies || []
  const events = data?.events || []
  const errorEvents = events.filter(event => event.event_type.toLowerCase().includes('error'))
  const missingMigrations = schemaStatus?.items.filter(item => item.status === 'missing') || []

  return (
    <div>
      <PageHeader
        title="Developer Dashboard"
        description="Adoption, data health, support, plans, and operational diagnostics"
        action={<Button onClick={load}>Refresh</Button>}
      />
      <PageContent className="space-y-5">
        {error && <Card><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>}

        <Card>
          <CardHeader><CardTitle className="text-base">Supabase Connection Status</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <StatusPill label="Auth" status={supabaseStatus?.auth || 'checking'} />
              <StatusPill label="Database" status={supabaseStatus?.database || 'checking'} />
              <StatusPill label="Event Log" status={supabaseStatus?.event_log || 'checking'} />
              <StatusPill label="Realtime" status={supabaseStatus?.realtime || 'configured'} />
            </div>
            <div className="text-xs text-muted-foreground">
              <p>Project: <strong>{supabaseStatus?.project || 'Checking...'}</strong></p>
              <p>Last checked: <strong>{supabaseStatus?.checked_at ? new Date(supabaseStatus.checked_at).toLocaleString() : 'Not checked'}</strong></p>
            </div>
            {supabaseStatus?.messages.length ? (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                {supabaseStatus.messages.map(message => <p key={message}>{message}</p>)}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
          <StatCard label="Companies" value={String(companies.length)} Icon={Building2} sub={`${metrics.activeCompanyIds.size} active in 30 days`} />
          <StatCard label="Vouchers" value={String(metrics.totalVouchers)} Icon={Activity} sub={`Sales ${metrics.voucherByType.Sales || 0} / Purchases ${metrics.voucherByType.Purchase || 0}`} />
          <StatCard label="Parties" value={String(metrics.totalParties)} Icon={Users} />
          <StatCard label="Items" value={String(metrics.totalItems)} Icon={Database} />
          <StatCard label="Paid / Trial" value={`${metrics.paidCompanies}/${metrics.trialCompanies}`} Icon={ShieldCheck} />
          <StatCard label="Health Issues" value={String(metrics.missingSetup.length + metrics.missingInvoiceNo.length + metrics.stockWarnings.length)} Icon={AlertTriangle} color="warning" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Schema / Migration Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {schemaStatus?.available ? (
                <>
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <span className="text-sm text-muted-foreground">Migration issues</span>
                    <Badge variant={missingMigrations.length ? 'destructive' : 'sales'}>
                      {missingMigrations.length ? `${missingMigrations.length} missing` : 'Up to date'}
                    </Badge>
                  </div>
                  <div className="max-h-80 overflow-auto divide-y divide-border rounded-md border border-border">
                    {schemaStatus.items.map(item => (
                      <div key={item.key} className="flex items-start justify-between gap-3 p-3 text-sm">
                        <div>
                          <p className="font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.detail}</p>
                        </div>
                        <Badge variant={item.status === 'ok' ? 'sales' : 'destructive'}>
                          {item.status === 'ok' ? 'OK' : 'Missing'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  <p className="font-medium">Schema checker is not installed yet.</p>
                  <p className="mt-1 text-xs">{schemaStatus?.error || 'Run the latest supabase-schema.sql migration.'}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Error Log</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {errorEvents.slice(0, 8).map(event => {
                const company = companies.find(c => c.id === event.company_id)
                return (
                  <div key={event.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="destructive">{event.event_type}</Badge>
                      <span className="font-medium">{company?.name || 'Unknown company'}</span>
                      <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
                    </div>
                    <EventMetadata metadata={event.metadata} />
                  </div>
                )
              })}
              {errorEvents.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No errors logged yet. Runtime errors will appear here after the latest schema is installed.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Feature Adoption</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>VAT mode: <strong>{metrics.vatCompanies}</strong> companies</p>
              <p>Internal bookkeeping: <strong>{metrics.internalCompanies}</strong> companies</p>
              <p>Stock adjustments: <strong>{metrics.voucherByType['Stock Adjustment'] || 0}</strong> voucher(s)</p>
              <p>Invoice prints: <strong>{metrics.eventByType.print_voucher || 0}</strong></p>
              <p>Party statements printed/shared: <strong>{(metrics.eventByType.print_party_statement || 0) + (metrics.eventByType.share_party_statement || 0)}</strong></p>
              <p>Backup exports/restores: <strong>{(metrics.eventByType.export_backup || 0) + (metrics.eventByType.restore_backup || 0)}</strong></p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Data Health Checks</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>No activity after signup: <strong>{metrics.companiesWithoutActivity.length}</strong></p>
              <p>Inactive 30+ days: <strong>{metrics.inactiveCompanies.length}</strong></p>
              <p>Missing fiscal year: <strong>{metrics.missingFiscalYear.length}</strong></p>
              <p>Missing parties or items: <strong>{metrics.missingSetup.length}</strong></p>
              <p>Vouchers missing number: <strong>{metrics.missingInvoiceNo.length}</strong></p>
              <p>Negative stock companies: <strong>{metrics.stockWarnings.length}</strong></p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">App Diagnostics</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Last dashboard sync: <strong>{lastSync || 'Not synced'}</strong></p>
              <p>Schema version: <strong>developer-dashboard-v1</strong></p>
              <p>Realtime tables watched in app: <strong>8</strong></p>
              <p>Loaded companies: <strong>{metrics.companyIds.size}</strong></p>
              <p>Event log rows loaded: <strong>{events.length}</strong></p>
              <p>Suspended companies: <strong>{metrics.suspendedCompanies}</strong></p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">Company Management</CardTitle>
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search companies, email, plan, status..." className="max-w-sm" />
            </div>
          </CardHeader>
          <CardContent className="p-0 pb-2 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Company</th>
                  <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Usage</th>
                  <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Last Activity</th>
                  <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Plan</th>
                  <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Support</th>
                  <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Developer Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map(company => (
                  <DeveloperCompanyRow
                    key={company.id}
                    company={company}
                    data={data as DeveloperData}
                    voucherCount={metrics.voucherByCompany[company.id] || 0}
                    partyCount={metrics.partyByCompany[company.id] || 0}
                    itemCount={metrics.itemByCompany[company.id] || 0}
                    lastActivity={metrics.lastActivityByCompany[company.id]}
                    onSaved={load}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Event Log</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {events.slice(0, 30).map(event => {
              const company = companies.find(c => c.id === event.company_id)
              return (
                <div key={event.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={event.event_type.includes('error') ? 'destructive' : 'outline'}>{event.event_type}</Badge>
                    <span className="font-medium">{company?.name || 'Unknown company'}</span>
                    <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                  <EventMetadata metadata={event.metadata} />
                </div>
              )
            })}
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No events tracked yet. Print an invoice, export a backup, share a party statement, or trigger a frontend error after installing `app_events`.
              </p>
            )}
          </CardContent>
        </Card>
      </PageContent>
    </div>
  )
}
