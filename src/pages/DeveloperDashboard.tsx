import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, Building2, CheckCircle2, ChevronDown, Database,
  FileText, Grid2X2, ListChecks, Loader2, Mail, NotebookText, PackageCheck,
  RefreshCcw, ShieldCheck, Trash2, UserRound, Users,
} from 'lucide-react'
import {
  checkSupabaseConnectionStatus,
  clearDeveloperErrorLogs,
  deleteDeveloperCompany,
  fetchDeveloperDashboardData,
  fetchDeveloperSchemaStatus,
  fetchDeveloperUserCompanyLicenses,
  isDeveloperAdmin,
  updateDeveloperCompany,
  updateUserCompanyLimit,
  upsertCompanyModule,
  type DeveloperSchemaStatusItem,
} from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import { publicErrorMessage } from '@/lib/security'
import { recomputeStock } from '@/lib/engine'
import { PageContent, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, Textarea } from '@/components/ui/misc'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Account, AppModule, Company, CompanyModule, DeveloperUserCompanyLicense, Item, Party, Voucher } from '@/types'
import { notifySuccess } from '@/lib/notifications'

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
  modules: AppModule[]
  companyModules: CompanyModule[]
}

type SupabaseStatus = Awaited<ReturnType<typeof checkSupabaseConnectionStatus>>
type DeveloperTab = 'overview' | 'license' | 'companies' | 'modules' | 'users' | 'billing' | 'logs' | 'notes' | 'system'
type DeveloperUserFilter = 'all' | 'expiring' | 'errors' | 'suspended' | 'limit'

const today = new Date()
const PAGE_SIZE = 8

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

function displayNameFor(row: DeveloperUserCompanyLicense) {
  const source = row.email?.split('@')[0] || row.user_id.slice(0, 8)
  return source
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase())
}

function initialsFor(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U'
}

function statusVariant(status?: string) {
  if (status === 'active' || status === 'paid') return 'sales'
  if (status === 'trial') return 'purchase'
  if (status === 'expired' || status === 'suspended' || status === 'blocked') return 'destructive'
  return 'outline'
}

function userStatus(row: DeveloperUserCompanyLicense, companies: Company[]) {
  if (row.license.license_status === 'suspended' || companies.some(company => company.suspended)) return 'Suspended'
  if (row.license.license_status === 'expired') return 'Expired'
  if (companies.some(company => company.plan_status === 'trial')) return 'Trial'
  return 'Active'
}

function licenseExpiresSoon(row: DeveloperUserCompanyLicense) {
  if (!row.license.expires_at) return false
  const days = daysAgo(row.license.expires_at)
  return days <= 0 && days >= -7
}

function licenseLimitReached(row: DeveloperUserCompanyLicense) {
  return !row.license.unlimited_companies && (row.license.remaining_companies ?? 0) <= 0
}

function userHasError(row: DeveloperUserCompanyLicense, events: DeveloperEvent[]) {
  const companyIds = new Set(row.companies.map(company => company.id))
  return events.some(event => event.event_type.toLowerCase().includes('error') && event.company_id && companyIds.has(event.company_id))
}

function matchesDeveloperUserFilter(row: DeveloperUserCompanyLicense, filter: DeveloperUserFilter, companies: Company[], events: DeveloperEvent[]) {
  if (filter === 'all') return true
  if (filter === 'expiring') return licenseExpiresSoon(row)
  if (filter === 'limit') return licenseLimitReached(row)
  if (filter === 'errors') return userHasError(row, events)
  if (filter === 'suspended') return row.license.license_status === 'suspended' || companies.some(company => company.suspended)
  return true
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

function MetricLine({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><strong className="text-right">{value}</strong></div>
}

function DashboardCard({ title, Icon, action, children }: { title: string; Icon: React.ComponentType<{ className?: string }>; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 p-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">{children}</CardContent>
    </Card>
  )
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
  if (!metadata || Object.keys(metadata).length === 0) return <span className="text-muted-foreground">No metadata</span>
  return <pre className="mt-2 max-h-28 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed text-muted-foreground">{JSON.stringify(metadata, null, 2)}</pre>
}

function DeveloperUserCard({ row, selected, companies, onSelect }: { row: DeveloperUserCompanyLicense; selected: boolean; companies: Company[]; onSelect: () => void }) {
  const name = displayNameFor(row)
  const status = userStatus(row, companies)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-background hover:bg-muted/40'}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{initialsFor(name)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{row.email || row.user_id}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{row.license.current_companies} compan{row.license.current_companies === 1 ? 'y' : 'ies'}</span>
        </span>
        <Badge variant={statusVariant(status.toLowerCase())}>{status}</Badge>
      </div>
    </button>
  )
}

function DeveloperUserList({
  users,
  selectedUserId,
  loading,
  companyById,
  events,
  activeFilter,
  onFilterChange,
  onSelect,
}: {
  users: DeveloperUserCompanyLicense[]
  selectedUserId?: string
  loading: boolean
  companyById: Map<string, Company>
  events: DeveloperEvent[]
  activeFilter: DeveloperUserFilter
  onFilterChange: (filter: DeveloperUserFilter) => void
  onSelect: (userId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filteredByKpi = users.filter(row => matchesDeveloperUserFilter(row, activeFilter, row.companies.map(company => companyById.get(company.id)).filter(Boolean) as Company[], events))
    if (!q) return filteredByKpi
    return filteredByKpi.filter(row => [displayNameFor(row), row.email, row.user_id, ...row.companies.map(company => company.name)]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q)))
  }, [activeFilter, companyById, events, query, users])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => setPage(1), [query])

  return (
    <Card className="h-fit lg:sticky lg:top-4">
      <CardHeader className="p-4">
        <CardTitle className="text-base">Users</CardTitle>
        {activeFilter !== 'all' && (
          <button type="button" onClick={() => onFilterChange('all')} className="w-fit text-xs font-semibold text-primary hover:underline">
            Clear KPI filter
          </button>
        )}
        <div className="relative">
          <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search users by name, email..." className="pl-8" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        {loading && <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading users...</div>}
        {!loading && pageRows.map(row => (
          <DeveloperUserCard
            key={row.user_id}
            row={row}
            selected={row.user_id === selectedUserId}
            companies={row.companies.map(company => companyById.get(company.id)).filter(Boolean) as Company[]}
            onSelect={() => onSelect(row.user_id)}
          />
        ))}
        {!loading && !filtered.length && <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">No users match this search or KPI filter.</div>}
        {pageCount > 1 && (
          <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>{page} / {pageCount}</span>
            <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DeveloperKpiStrip({
  users,
  companyById,
  events,
  activeFilter,
  systemLoaded,
  onFilter,
  onErrors,
}: {
  users: DeveloperUserCompanyLicense[]
  companyById: Map<string, Company>
  events: DeveloperEvent[]
  activeFilter: DeveloperUserFilter
  systemLoaded: boolean
  onFilter: (filter: DeveloperUserFilter) => void
  onErrors: () => void
}) {
  const expiringUsers = users.filter(licenseExpiresSoon)
  const suspendedUsers = users.filter(row => matchesDeveloperUserFilter(row, 'suspended', row.companies.map(company => companyById.get(company.id)).filter(Boolean) as Company[], events))
  const limitReachedUsers = users.filter(licenseLimitReached)
  const errorEvents = events.filter(event => event.event_type.toLowerCase().includes('error'))
  const latestError = errorEvents[0]
  const latestErrorCompany = latestError?.company_id ? companyById.get(latestError.company_id) : undefined

  const cards: Array<{
    key: DeveloperUserFilter
    title: string
    value: string
    detail: string
    Icon: React.ComponentType<{ className?: string }>
    onClick: () => void
  }> = [
    {
      key: 'expiring',
      title: 'Expiring Soon',
      value: String(expiringUsers.length),
      detail: 'licenses within 7 days',
      Icon: ShieldCheck,
      onClick: () => onFilter('expiring'),
    },
    {
      key: 'errors',
      title: 'Recent Errors',
      value: systemLoaded ? String(errorEvents.length) : 'Load',
      detail: latestErrorCompany ? latestErrorCompany.name : systemLoaded ? 'no company errors' : 'open system diagnostics',
      Icon: AlertTriangle,
      onClick: onErrors,
    },
    {
      key: 'suspended',
      title: 'Suspended',
      value: String(suspendedUsers.length),
      detail: 'users or companies',
      Icon: Users,
      onClick: () => onFilter('suspended'),
    },
    {
      key: 'limit',
      title: 'Limit Reached',
      value: String(limitReachedUsers.length),
      detail: 'no company slots left',
      Icon: Building2,
      onClick: () => onFilter('limit'),
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(card => (
        <button
          key={card.key}
          type="button"
          onClick={card.onClick}
          className={`rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40 ${activeFilter === card.key ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{card.title}</p>
              <p className="mt-2 text-2xl font-bold">{card.value}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{card.detail}</p>
            </div>
            <span className="rounded-md bg-primary/10 p-2 text-primary"><card.Icon className="h-4 w-4" /></span>
          </div>
        </button>
      ))}
    </div>
  )
}

function CompanyModulesDialog({ company, modules, entitlements, open, onClose, onSaved }: { company: Company; modules: AppModule[]; entitlements: CompanyModule[]; open: boolean; onClose: () => void; onSaved: () => void }) {
  const module = modules.find(entry => entry.key === 'cheque_management')
  const existing = entitlements.find(entry => entry.module_id === module?.id)
  const [enabled, setEnabled] = useState(existing?.is_enabled || false)
  const [status, setStatus] = useState(existing?.status || 'disabled')
  const [billing, setBilling] = useState(existing?.billing_type || 'included')
  const [payment, setPayment] = useState(existing?.payment_status || 'pending')
  const [price, setPrice] = useState(String(existing?.price ?? module?.default_price ?? 0))
  const [starts, setStarts] = useState(existing?.starts_at || '')
  const [expires, setExpires] = useState(existing?.expires_at || '')
  const [notes, setNotes] = useState(existing?.internal_notes || '')
  const [settings, setSettings] = useState(JSON.stringify(existing?.settings || {}, null, 2))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setEnabled(existing?.is_enabled || false)
    setStatus(existing?.status || 'disabled')
    setBilling(existing?.billing_type || 'included')
    setPayment(existing?.payment_status || 'pending')
    setPrice(String(existing?.price ?? module?.default_price ?? 0))
    setStarts(existing?.starts_at || '')
    setExpires(existing?.expires_at || '')
    setNotes(existing?.internal_notes || '')
    setSettings(JSON.stringify(existing?.settings || {}, null, 2))
    setError('')
  }, [open, existing, module])

  const save = async () => {
    if (!module) return
    setSaving(true)
    setError('')
    try {
      await upsertCompanyModule({
        company_id: company.id,
        module_id: module.id,
        is_enabled: enabled,
        status: status as CompanyModule['status'],
        billing_type: billing as CompanyModule['billing_type'],
        payment_status: payment as CompanyModule['payment_status'],
        price: Number(price) || 0,
        starts_at: starts || null,
        expires_at: expires || null,
        internal_notes: notes,
        settings: settings.trim() ? JSON.parse(settings) : {},
      })
      notifySuccess('Company module settings saved', company.name)
      onSaved()
      onClose()
    } catch (e) {
      setError(publicErrorMessage(e, 'saving module'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{company.name} · Modules</DialogTitle></DialogHeader>
        {!module ? <p className="text-sm text-destructive">Run the Cheque Management migration to create the module catalogue.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); if (e.target.checked && status === 'disabled') setStatus('active') }} />Enable Cheque Management</label>
            <div />
            <div><Label>Status</Label><SearchableSelect value={status} onValueChange={value => setStatus(value as CompanyModule['status'])} options={['active', 'trial', 'grace_period', 'read_only', 'disabled'].map(value => ({ value, label: value.replaceAll('_', ' ') }))} /></div>
            <div><Label>Payment</Label><SearchableSelect value={payment} onValueChange={value => setPayment(value as CompanyModule['payment_status'])} options={['paid', 'pending', 'overdue', 'waived', 'cancelled'].map(value => ({ value, label: value }))} /></div>
            <div><Label>Billing</Label><SearchableSelect value={billing} onValueChange={value => setBilling(value as CompanyModule['billing_type'])} options={['included', 'monthly', 'yearly', 'one_time', 'custom'].map(value => ({ value, label: value.replaceAll('_', ' ') }))} /></div>
            <div><Label>Price</Label><Input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></div>
            <div><Label>Starts</Label><Input type="date" value={starts} onChange={e => setStarts(e.target.value)} /></div>
            <div><Label>Expires</Label><Input type="date" value={expires} onChange={e => setExpires(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Module settings (JSON)</Label><Textarea rows={5} value={settings} onChange={e => setSettings(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Internal notes</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>
            {error && <p className="sm:col-span-2 text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!module || saving} onClick={save}>{saving ? 'Saving...' : 'Save Module'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LicenseEditor({ row, onSaved }: { row: DeveloperUserCompanyLicense; onSaved: () => void }) {
  const license = row.license
  const [maxCompanies, setMaxCompanies] = useState(String(license.max_companies ?? 1))
  const [unlimited, setUnlimited] = useState(!!license.unlimited_companies)
  const [enabled, setEnabled] = useState(license.company_creation_enabled !== false)
  const [status, setStatus] = useState(license.license_status || 'active')
  const [expiresAt, setExpiresAt] = useState(license.expires_at || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setMaxCompanies(String(license.max_companies ?? 1))
    setUnlimited(!!license.unlimited_companies)
    setEnabled(license.company_creation_enabled !== false)
    setStatus(license.license_status || 'active')
    setExpiresAt(license.expires_at || '')
    setError('')
  }, [license])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await updateUserCompanyLimit({
        user_id: row.user_id,
        max_companies: Number(maxCompanies) || 0,
        unlimited_companies: unlimited,
        company_creation_enabled: enabled,
        license_status: status as 'active' | 'expired' | 'suspended',
        expires_at: expiresAt || null,
      })
      notifySuccess('Company license saved', row.email || row.user_id)
      onSaved()
    } catch (err) {
      setError(publicErrorMessage(err, 'saving company license'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardCard title="License Information" Icon={ShieldCheck} action={<Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save License'}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label>Maximum Companies</Label><Input type="number" min="0" value={maxCompanies} onChange={event => setMaxCompanies(event.target.value)} disabled={unlimited} /></div>
        <div className="space-y-1.5"><Label>Status</Label><SearchableSelect value={status} onValueChange={setStatus} options={['active', 'expired', 'suspended'].map(value => ({ value, label: value }))} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unlimited} onChange={event => setUnlimited(event.target.checked)} />Unlimited Companies</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Company Creation Enabled</label>
        <div className="space-y-1.5"><Label>Expires At</Label><Input type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <MetricLine label="Current" value={license.current_companies} />
          <MetricLine label="Remaining" value={license.unlimited_companies ? 'Unlimited' : license.remaining_companies ?? 0} />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </DashboardCard>
  )
}

function CompanySupportEditor({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [plan, setPlan] = useState(company.plan_status || 'trial')
  const [trialEndsAt, setTrialEndsAt] = useState(company.trial_ends_at || '')
  const [support, setSupport] = useState(company.support_status || 'normal')
  const [suspended, setSuspended] = useState(company.suspended || false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPlan(company.plan_status || 'trial')
    setTrialEndsAt(company.trial_ends_at || '')
    setSupport(company.support_status || 'normal')
    setSuspended(company.suspended || false)
  }, [company])

  const save = async () => {
    setSaving(true)
    try {
      await updateDeveloperCompany(company.id, {
        plan_status: plan as Company['plan_status'],
        trial_ends_at: trialEndsAt || undefined,
        support_status: support as Company['support_status'],
        suspended,
      })
      notifySuccess('Company support settings saved', company.name)
      onSaved()
    } catch (error) {
      publicErrorMessage(error, 'saving company support settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardCard title="Support & Plan" Icon={ListChecks} action={<Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>}>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label>Plan Type</Label><SearchableSelect value={plan} onValueChange={setPlan} options={[{ value: 'free', label: 'Free' }, { value: 'trial', label: 'Trial' }, { value: 'paid', label: 'Paid' }, { value: 'expired', label: 'Expired' }]} /></div>
        <div className="space-y-1.5"><Label>Support Level</Label><SearchableSelect value={support} onValueChange={setSupport} options={[{ value: 'normal', label: 'Normal' }, { value: 'needs_help', label: 'Needs help' }, { value: 'blocked', label: 'Blocked' }]} /></div>
        <div className="space-y-1.5"><Label>Support Expiry</Label><Input type="date" value={trialEndsAt} onChange={event => setTrialEndsAt(event.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={suspended} onChange={event => setSuspended(event.target.checked)} />Suspended</label>
      </div>
    </DashboardCard>
  )
}

function DeveloperNotesCard({ company, onSaved }: { company?: Company; onSaved: () => void }) {
  const [notes, setNotes] = useState(company?.developer_notes || '')
  const [saving, setSaving] = useState(false)
  useEffect(() => setNotes(company?.developer_notes || ''), [company])
  const save = async () => {
    if (!company) return
    setSaving(true)
    try {
      await updateDeveloperCompany(company.id, { developer_notes: notes })
      notifySuccess('Developer notes saved', company.name)
      onSaved()
    } catch (error) {
      publicErrorMessage(error, 'saving developer notes')
    } finally {
      setSaving(false)
    }
  }
  return (
    <DashboardCard title="Developer Notes" Icon={NotebookText} action={<Button size="sm" onClick={save} disabled={!company || saving}>{saving ? 'Saving...' : 'Save Notes'}</Button>}>
      <Textarea value={notes} onChange={event => setNotes(event.target.value)} rows={5} placeholder={company ? 'Developer/support notes...' : 'Select a company to edit notes'} disabled={!company} />
    </DashboardCard>
  )
}

function CompanyDangerActions({ company, data, onSaved }: { company?: Company; data?: DeveloperData; onSaved: () => void }) {
  const [deleting, setDeleting] = useState(false)
  if (!company) return null

  const exportData = () => {
    const companyVouchers = data?.vouchers.filter(v => v.company_id === company.id) || []
    const voucherIds = new Set(companyVouchers.map(v => v.id))
    downloadJson(`${safeFileName(company.name)}-${new Date().toISOString().slice(0, 10)}-before-delete.json`, {
      exported_at: new Date().toISOString(),
      export_reason: 'developer_company_export',
      company,
      accounts: data?.accounts.filter(a => a.company_id === company.id) || [],
      parties: data?.parties.filter(p => p.company_id === company.id) || [],
      items: data?.items.filter(i => i.company_id === company.id) || [],
      vouchers: companyVouchers,
      events: data?.events.filter(e => e.company_id === company.id) || [],
      summary: {
        accounts: data?.accounts.filter(a => a.company_id === company.id).length || 0,
        parties: data?.parties.filter(p => p.company_id === company.id).length || 0,
        items: data?.items.filter(i => i.company_id === company.id).length || 0,
        vouchers: companyVouchers.length,
        voucher_ids: Array.from(voucherIds),
      },
    })
  }

  const suspendCompany = async () => {
    if (!window.confirm(`Suspend ${company.name}?`)) return
    await updateDeveloperCompany(company.id, { suspended: true })
    notifySuccess('Company suspended', company.name)
    onSaved()
  }

  const exportAndDelete = async () => {
    if (!window.confirm(`This will export and permanently delete ${company.name} with its related data. Continue?`)) return
    exportData()
    const typedName = window.prompt(`Type DELETE to permanently delete ${company.name}.`)
    if (typedName !== 'DELETE') return
    setDeleting(true)
    try {
      await deleteDeveloperCompany(company.id)
      notifySuccess('Company exported and deleted', company.name)
      onSaved()
    } catch (error) {
      publicErrorMessage(error, 'deleting company')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-wrap justify-between gap-3 rounded-lg border bg-background p-3">
      <Button variant="outline" onClick={suspendCompany} disabled={company.suspended}>Suspend Company</Button>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={exportData}>Export Data</Button>
        <Button variant="destructive" onClick={exportAndDelete} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete Company'}</Button>
      </div>
    </div>
  )
}

function CompanySelector({ companies, selectedCompanyId, onSelect }: { companies: Company[]; selectedCompanyId?: string; onSelect: (id: string) => void }) {
  if (companies.length <= 1) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Managed company</span>
      <SearchableSelect className="w-full sm:w-72" value={selectedCompanyId || ''} onValueChange={onSelect} options={companies.map(company => ({ value: company.id, label: company.name, searchText: `${company.phone || ''} ${company.address || ''}` }))} />
    </div>
  )
}

function OverviewTab({ row, data, selectedCompany, onSaved, onTab }: { row: DeveloperUserCompanyLicense; data?: DeveloperData; selectedCompany?: Company; onSaved: () => void; onTab: (tab: DeveloperTab) => void }) {
  const companies = data?.companies || []
  const vouchers = data?.vouchers || []
  const parties = data?.parties || []
  const items = data?.items || []
  const events = data?.events || []
  const license = row.license
  const lastActivity = vouchers.reduce<string | undefined>((latest, voucher) => {
    const value = voucher.created_at || voucher.date
    return !latest || new Date(value).getTime() > new Date(latest).getTime() ? value : latest
  }, undefined)
  const enabledModules = (data?.companyModules || []).filter(entry => entry.is_enabled)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <DashboardCard title="License Information" Icon={ShieldCheck} action={<Button size="sm" variant="outline" onClick={() => onTab('license')}>Edit License</Button>}>
          <MetricLine label="Current Plan" value={<Badge variant={statusVariant(selectedCompany?.plan_status || 'trial')}>{selectedCompany?.plan_status || 'trial'}</Badge>} />
          <MetricLine label="Status" value={<Badge variant={statusVariant(license.license_status)}>{license.license_status}</Badge>} />
          <MetricLine label="Maximum Companies" value={license.unlimited_companies ? 'Unlimited' : license.max_companies} />
          <MetricLine label="Companies Used" value={license.current_companies} />
          <MetricLine label="Remaining" value={license.unlimited_companies ? 'Unlimited' : license.remaining_companies ?? 0} />
          <MetricLine label="Company Creation" value={license.company_creation_enabled ? 'Enabled' : 'Disabled'} />
          <MetricLine label="Expires On" value={license.expires_at ? fmtDate(license.expires_at) : 'No expiry'} />
        </DashboardCard>
        <DashboardCard title={`Companies (${companies.length})`} Icon={Building2} action={<Button size="sm" variant="outline" onClick={() => onTab('license')}>Add Company</Button>}>
          {companies.slice(0, 4).map((company, index) => (
            <div key={company.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{index + 1}. {company.name}</p>
                <p className="text-xs text-muted-foreground">{company.phone || company.id.slice(0, 8)}</p>
              </div>
              <Badge variant={statusVariant(company.plan_status || 'trial')}>{company.plan_status || 'trial'}</Badge>
            </div>
          ))}
          {!companies.length && <p className="text-sm text-muted-foreground">No companies loaded for this user.</p>}
          <Button size="sm" variant="link" className="px-0" onClick={() => onTab('companies')}>View All Companies</Button>
        </DashboardCard>
        <DashboardCard title="Usage Summary" Icon={Activity} action={<Button size="sm" variant="link" className="px-0" onClick={() => onTab('logs')}>View Detailed Usage</Button>}>
          <MetricLine label="Total Vouchers" value={vouchers.length} />
          <MetricLine label="Total Parties" value={parties.length} />
          <MetricLine label="Total Items" value={items.length} />
          <MetricLine label="Last Activity" value={lastActivity ? fmtDate(lastActivity) : 'No activity'} />
          <MetricLine label="Event Logs" value={events.length} />
        </DashboardCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <DashboardCard title="Modules" Icon={Grid2X2} action={<Button size="sm" variant="outline" onClick={() => onTab('modules')}>Configure</Button>}>
          {enabledModules.slice(0, 6).map(entry => <div key={entry.id} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{entry.module?.name || entry.module_id}</div>)}
          {!enabledModules.length && <p className="text-sm text-muted-foreground">No enabled modules for these companies.</p>}
          <Button size="sm" variant="link" className="px-0" onClick={() => onTab('modules')}>View All Modules</Button>
        </DashboardCard>
        {selectedCompany && <CompanySupportEditor company={selectedCompany} onSaved={onSaved} />}
        <DeveloperNotesCard company={selectedCompany} onSaved={onSaved} />
      </div>
    </div>
  )
}

function CompaniesTab({ data, modules, onSaved }: { data?: DeveloperData; modules: AppModule[]; onSaved: () => void }) {
  const [modulesCompany, setModulesCompany] = useState<Company | null>(null)
  const voucherByCompany = countBy(data?.vouchers || [], voucher => voucher.company_id)
  const partyByCompany = countBy(data?.parties || [], party => party.company_id)
  const itemByCompany = countBy(data?.items || [], item => item.company_id)
  return (
    <div className="space-y-3">
      {(data?.companies || []).map(company => (
        <Card key={company.id}>
          <CardContent className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
            <div>
              <p className="font-semibold">{company.name}</p>
              <p className="text-xs text-muted-foreground">{company.phone || company.id}</p>
            </div>
            <div className="text-sm">
              <p>{voucherByCompany[company.id] || 0} voucher(s)</p>
              <p>{partyByCompany[company.id] || 0} parties</p>
              <p>{itemByCompany[company.id] || 0} items</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(company.plan_status || 'trial')}>{company.plan_status || 'trial'}</Badge>
              {company.suspended && <Badge variant="destructive">Suspended</Badge>}
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button size="sm" variant="outline" onClick={() => setModulesCompany(company)}>Modules</Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {!data?.companies.length && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No companies found for this user.</CardContent></Card>}
      {modulesCompany && <CompanyModulesDialog company={modulesCompany} modules={modules} entitlements={(data?.companyModules || []).filter(entry => entry.company_id === modulesCompany.id)} open={!!modulesCompany} onClose={() => setModulesCompany(null)} onSaved={onSaved} />}
    </div>
  )
}

function ModulesTab({ data, modules, onSaved }: { data?: DeveloperData; modules: AppModule[]; onSaved: () => void }) {
  const [modulesCompany, setModulesCompany] = useState<Company | null>(null)
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {(data?.companies || []).map(company => {
        const entitlements = (data?.companyModules || []).filter(entry => entry.company_id === company.id)
        return (
          <DashboardCard key={company.id} title={company.name} Icon={PackageCheck} action={<Button size="sm" variant="outline" onClick={() => setModulesCompany(company)}>Configure</Button>}>
            {modules.map(module => {
              const entitlement = entitlements.find(entry => entry.module_id === module.id)
              return <div key={module.id} className="flex items-center justify-between gap-3 text-sm"><span>{module.name}</span><Badge variant={entitlement?.is_enabled ? 'sales' : 'outline'}>{entitlement?.is_enabled ? entitlement.status : 'disabled'}</Badge></div>
            })}
            {!modules.length && <p className="text-sm text-muted-foreground">No module catalogue loaded.</p>}
          </DashboardCard>
        )
      })}
      {modulesCompany && <CompanyModulesDialog company={modulesCompany} modules={modules} entitlements={(data?.companyModules || []).filter(entry => entry.company_id === modulesCompany.id)} open={!!modulesCompany} onClose={() => setModulesCompany(null)} onSaved={onSaved} />}
    </div>
  )
}

function LogsTab({ data, companies }: { data?: DeveloperData; companies: Company[] }) {
  const companyById = new Map(companies.map(company => [company.id, company]))
  return (
    <div className="space-y-2">
      {(data?.events || []).slice(0, 80).map(event => (
        <div key={event.id} className="rounded-md border bg-background p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={event.event_type.includes('error') ? 'destructive' : 'outline'}>{event.event_type}</Badge>
            <span className="font-medium">{event.company_id ? companyById.get(event.company_id)?.name || 'Unknown company' : 'Global'}</span>
            <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
          </div>
          <EventMetadata metadata={event.metadata} />
        </div>
      ))}
      {!data?.events.length && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No logs found for this user.</CardContent></Card>}
    </div>
  )
}

function SystemTab({
  data,
  loading,
  schemaStatus,
  supabaseStatus,
  lastSync,
  clearingErrors,
  onClearErrors,
}: {
  data?: DeveloperData
  loading: boolean
  schemaStatus: { available: boolean; items: DeveloperSchemaStatusItem[]; error?: string } | null
  supabaseStatus: SupabaseStatus | null
  lastSync: string
  clearingErrors: boolean
  onClearErrors: () => void
}) {
  const metrics = useMemo(() => {
    const companies = data?.companies || []
    const vouchers = data?.vouchers || []
    const parties = data?.parties || []
    const items = data?.items || []
    const events = data?.events || []
    const voucherByCompany = countBy(vouchers, v => v.company_id)
    const partyByCompany = countBy(parties, p => p.company_id)
    const itemByCompany = countBy(items, i => i.company_id)
    const eventByType = countBy(events, e => e.event_type)
    const voucherByType = countBy(vouchers, v => v.type)
    const stockWarnings: string[] = []
    for (const company of companies) {
      const stock = recomputeStock(items.filter(i => i.company_id === company.id), vouchers.filter(v => v.company_id === company.id))
      if (stock.some(s => s.qty < 0)) stockWarnings.push(company.name)
    }
    return {
      companies,
      events,
      errorEvents: events.filter(event => event.event_type.toLowerCase().includes('error')),
      missingMigrations: schemaStatus?.items.filter(item => item.status === 'missing') || [],
      voucherByCompany,
      partyByCompany,
      itemByCompany,
      eventByType,
      voucherByType,
      stockWarnings,
      missingSetup: companies.filter(c => !partyByCompany[c.id] || !itemByCompany[c.id]),
      inactiveCompanies: companies.filter(c => !voucherByCompany[c.id]),
    }
  }, [data, schemaStatus])

  if (loading) return <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading system diagnostics...</CardContent></Card>

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <StatusPill label="Auth" status={supabaseStatus?.auth || 'checking'} />
        <StatusPill label="Database" status={supabaseStatus?.database || 'checking'} />
        <StatusPill label="Event Log" status={supabaseStatus?.event_log || 'checking'} />
        <StatusPill label="Realtime" status={supabaseStatus?.realtime || 'configured'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <DashboardCard title="Schema / Migration Status" Icon={Database}>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className="text-sm text-muted-foreground">Migration issues</span>
            <Badge variant={metrics.missingMigrations.length ? 'destructive' : 'sales'}>{metrics.missingMigrations.length ? `${metrics.missingMigrations.length} missing` : 'Up to date'}</Badge>
          </div>
          {schemaStatus?.available ? schemaStatus.items.map(item => (
            <div key={item.key} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <div><p className="font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div>
              <Badge variant={item.status === 'ok' ? 'sales' : 'destructive'}>{item.status === 'ok' ? 'OK' : 'Missing'}</Badge>
            </div>
          )) : <p className="text-sm text-warning">{schemaStatus?.error || 'Schema checker is not installed yet.'}</p>}
        </DashboardCard>
        <DashboardCard title="Error Log" Icon={AlertTriangle} action={<Button size="sm" variant="outline" onClick={onClearErrors} disabled={!metrics.errorEvents.length || clearingErrors}><Trash2 className="mr-1 h-3.5 w-3.5" />{clearingErrors ? 'Clearing...' : 'Clear errors'}</Button>}>
          {metrics.errorEvents.slice(0, 8).map(event => <div key={event.id} className="rounded-md border p-3 text-sm"><Badge variant="destructive">{event.event_type}</Badge><span className="ml-2 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span><EventMetadata metadata={event.metadata} /></div>)}
          {!metrics.errorEvents.length && <p className="text-sm text-muted-foreground">No errors logged yet.</p>}
        </DashboardCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <DashboardCard title="Feature Adoption" Icon={ShieldCheck}>
          <MetricLine label="VAT companies" value={metrics.companies.filter(c => c.vat_enabled !== false).length} />
          <MetricLine label="Internal bookkeeping" value={metrics.companies.filter(c => c.vat_enabled === false).length} />
          <MetricLine label="Stock adjustments" value={metrics.voucherByType['Stock Adjustment'] || 0} />
          <MetricLine label="Invoice prints" value={metrics.eventByType.print_voucher || 0} />
        </DashboardCard>
        <DashboardCard title="Data Health Checks" Icon={Activity}>
          <MetricLine label="No activity after signup" value={metrics.inactiveCompanies.length} />
          <MetricLine label="Missing setup" value={metrics.missingSetup.length} />
          <MetricLine label="Negative stock companies" value={metrics.stockWarnings.length} />
        </DashboardCard>
        <DashboardCard title="App Diagnostics" Icon={FileText}>
          <MetricLine label="Last sync" value={lastSync || 'Not synced'} />
          <MetricLine label="Loaded companies" value={metrics.companies.length} />
          <MetricLine label="Event log rows" value={metrics.events.length} />
          <MetricLine label="Suspended companies" value={metrics.companies.filter(c => c.suspended).length} />
        </DashboardCard>
      </div>
    </div>
  )
}

function DeveloperUserHeader({ row, selectedCompany, onRefresh, onTab, mobileBack }: { row: DeveloperUserCompanyLicense; selectedCompany?: Company; onRefresh: () => void; onTab: (tab: DeveloperTab) => void; mobileBack: () => void }) {
  const name = displayNameFor(row)
  const status = selectedCompany?.suspended ? 'Suspended' : row.license.license_status
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="outline" onClick={mobileBack} className="shrink-0"><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{initialsFor(name)}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-bold">{name}</h2><Badge variant={statusVariant(status)}>{status}</Badge></div>
            <p className="truncate text-sm text-muted-foreground">{row.email || row.user_id} · Joined {row.companies[0]?.created_at ? fmtDate(row.companies[0].created_at) : 'Unknown'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onRefresh}><RefreshCcw className="mr-1.5 h-4 w-4" />Refresh</Button>
          <Button variant="outline" onClick={() => onTab('license')}>License</Button>
          <Button variant="outline" onClick={() => onTab('system')}>System</Button>
          <Button onClick={() => onTab('logs')}>Actions <ChevronDown className="ml-1.5 h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DeveloperUserManagementPanel({
  row,
  data,
  loading,
  modules,
  selectedCompanyId,
  activeTab,
  onCompanyChange,
  onTabChange,
  onRefresh,
  onMobileBack,
  systemData,
  systemLoading,
  schemaStatus,
  supabaseStatus,
  lastSync,
  clearingErrors,
  onClearErrors,
}: {
  row: DeveloperUserCompanyLicense
  data?: DeveloperData
  loading: boolean
  modules: AppModule[]
  selectedCompanyId?: string
  activeTab: DeveloperTab
  onCompanyChange: (id: string) => void
  onTabChange: (tab: DeveloperTab) => void
  onRefresh: () => void
  onMobileBack: () => void
  systemData?: DeveloperData
  systemLoading: boolean
  schemaStatus: { available: boolean; items: DeveloperSchemaStatusItem[]; error?: string } | null
  supabaseStatus: SupabaseStatus | null
  lastSync: string
  clearingErrors: boolean
  onClearErrors: () => void
}) {
  const companies = data?.companies || []
  const selectedCompany = companies.find(company => company.id === selectedCompanyId) || companies[0]
  return (
    <div className="space-y-4">
      <DeveloperUserHeader row={row} selectedCompany={selectedCompany} onRefresh={onRefresh} onTab={onTabChange} mobileBack={onMobileBack} />
      <CompanySelector companies={companies} selectedCompanyId={selectedCompany?.id} onSelect={onCompanyChange} />
      {loading && <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading selected user data...</CardContent></Card>}
      <Tabs value={activeTab} onValueChange={value => onTabChange(value as DeveloperTab)}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="overview"><UserRound className="mr-1.5 h-3.5 w-3.5" />Overview</TabsTrigger>
            <TabsTrigger value="license">License</TabsTrigger>
            <TabsTrigger value="companies">Companies ({companies.length})</TabsTrigger>
            <TabsTrigger value="modules">Modules</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview"><OverviewTab row={row} data={data} selectedCompany={selectedCompany} onSaved={onRefresh} onTab={onTabChange} /></TabsContent>
        <TabsContent value="license"><LicenseEditor row={row} onSaved={onRefresh} /></TabsContent>
        <TabsContent value="companies"><CompaniesTab data={data} modules={modules} onSaved={onRefresh} /></TabsContent>
        <TabsContent value="modules"><ModulesTab data={data} modules={modules} onSaved={onRefresh} /></TabsContent>
        <TabsContent value="users"><DashboardCard title="Users" Icon={Users}><p className="text-sm text-muted-foreground">Company member management is not available in the current developer data. Existing access and permissions are unchanged.</p></DashboardCard></TabsContent>
        <TabsContent value="billing"><DashboardCard title="Billing" Icon={FileText}><MetricLine label="License Status" value={row.license.license_status} /><MetricLine label="Company Limit" value={row.license.unlimited_companies ? 'Unlimited' : row.license.max_companies} /><p className="text-sm text-muted-foreground">No separate billing backend is currently installed.</p></DashboardCard></TabsContent>
        <TabsContent value="logs"><LogsTab data={data} companies={companies} /></TabsContent>
        <TabsContent value="notes"><DeveloperNotesCard company={selectedCompany} onSaved={onRefresh} /></TabsContent>
        <TabsContent value="system"><SystemTab data={systemData} loading={systemLoading} schemaStatus={schemaStatus} supabaseStatus={supabaseStatus} lastSync={lastSync} clearingErrors={clearingErrors} onClearErrors={onClearErrors} /></TabsContent>
      </Tabs>
      <CompanyDangerActions company={selectedCompany} data={data} onSaved={onRefresh} />
    </div>
  )
}

export function DeveloperDashboard() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [users, setUsers] = useState<DeveloperUserCompanyLicense[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [activeTab, setActiveTab] = useState<DeveloperTab>('overview')
  const [activeUserFilter, setActiveUserFilter] = useState<DeveloperUserFilter>('all')
  const [selectedData, setSelectedData] = useState<DeveloperData | undefined>()
  const [systemData, setSystemData] = useState<DeveloperData | undefined>()
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingSelected, setLoadingSelected] = useState(false)
  const [loadingSystem, setLoadingSystem] = useState(false)
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState('')
  const [clearingErrors, setClearingErrors] = useState(false)
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatus | null>(null)
  const [schemaStatus, setSchemaStatus] = useState<{ available: boolean; items: DeveloperSchemaStatusItem[]; error?: string } | null>(null)
  const [mobileDetail, setMobileDetail] = useState(false)

  const selectedUser = users.find(row => row.user_id === selectedUserId)
  const companyById = useMemo(() => new Map((selectedData?.companies || systemData?.companies || []).map(company => [company.id, company])), [selectedData, systemData])
  const modules = selectedData?.modules || systemData?.modules || []
  const kpiEvents = systemData?.events || selectedData?.events || []

  const loadUsers = async () => {
    setLoadingUsers(true)
    setError('')
    try {
      const health = await checkSupabaseConnectionStatus()
      setSupabaseStatus(health)
      const isAdmin = await isDeveloperAdmin()
      setAllowed(isAdmin)
      if (!isAdmin) return
      const [schema, userLicenses] = await Promise.all([fetchDeveloperSchemaStatus(), fetchDeveloperUserCompanyLicenses()])
      setSchemaStatus(schema)
      setUsers(userLicenses)
      setSelectedUserId(current => current || userLicenses[0]?.user_id || '')
      setLastSync(new Date().toLocaleString())
    } catch (e: unknown) {
      setError(publicErrorMessage(e, 'loading developer dashboard'))
    } finally {
      setLoadingUsers(false)
    }
  }

  const loadSelectedUser = async (row: DeveloperUserCompanyLicense) => {
    setLoadingSelected(true)
    setSelectedData(undefined)
    setError('')
    try {
      const data = await fetchDeveloperDashboardData(row.companies.map(company => company.id))
      setSelectedData(data as DeveloperData)
      setSelectedCompanyId(current => current && data.companies.some(company => company.id === current) ? current : data.companies[0]?.id || '')
      setLastSync(new Date().toLocaleString())
    } catch (e: unknown) {
      setError(publicErrorMessage(e, 'loading selected user'))
    } finally {
      setLoadingSelected(false)
    }
  }

  const loadSystemData = async () => {
    if (systemData || loadingSystem) return
    setLoadingSystem(true)
    try {
      const data = await fetchDeveloperDashboardData()
      setSystemData(data as DeveloperData)
      setLastSync(new Date().toLocaleString())
    } catch (e: unknown) {
      setError(publicErrorMessage(e, 'loading system diagnostics'))
    } finally {
      setLoadingSystem(false)
    }
  }

  const showErrorUsers = async () => {
    setActiveUserFilter('errors')
    setActiveTab('system')
    setMobileDetail(true)
    await loadSystemData()
  }

  const refreshSelected = async () => {
    const [userLicenses] = await Promise.all([fetchDeveloperUserCompanyLicenses()])
    setUsers(userLicenses)
    const row = userLicenses.find(entry => entry.user_id === selectedUserId) || userLicenses[0]
    if (row) {
      setSelectedUserId(row.user_id)
      await loadSelectedUser(row)
    }
    setSystemData(undefined)
  }

  const clearErrors = async () => {
    if (!window.confirm('Clear all recorded frontend errors? Other audit and activity events will be preserved.')) return
    setClearingErrors(true)
    try {
      const count = await clearDeveloperErrorLogs()
      setSystemData(current => current ? { ...current, events: current.events.filter(event => event.event_type !== 'frontend_error') } : current)
      notifySuccess('Error log cleared', `${count} error record${count === 1 ? '' : 's'} removed`)
    } catch (clearError) {
      publicErrorMessage(clearError, 'clearing error logs')
    } finally {
      setClearingErrors(false)
    }
  }

  useEffect(() => { loadUsers() }, [])
  useEffect(() => { if (selectedUser) loadSelectedUser(selectedUser) }, [selectedUserId])
  useEffect(() => { if (activeTab === 'system') loadSystemData() }, [activeTab])

  if (allowed === null) return <PageContent><p className="text-sm text-muted-foreground">Checking developer access...</p></PageContent>

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Developer Dashboard" description="Developer admin access required" />
        <PageContent><Card><CardContent className="p-6 text-sm text-muted-foreground">Your account is not listed in `developer_admins`.</CardContent></Card></PageContent>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Developer Dashboard" description="User-centric management, licensing, support, modules, and diagnostics" action={<Button onClick={loadUsers}><RefreshCcw className="mr-1.5 h-4 w-4" />Refresh</Button>} />
      <PageContent className="space-y-4">
        {error && <Card><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>}
        <DeveloperKpiStrip
          users={users}
          companyById={companyById}
          events={kpiEvents}
          activeFilter={activeUserFilter}
          systemLoaded={!!systemData}
          onFilter={setActiveUserFilter}
          onErrors={showErrorUsers}
        />
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
          <div className={mobileDetail ? 'hidden lg:block' : 'block'}>
            <DeveloperUserList
              users={users}
              selectedUserId={selectedUserId}
              loading={loadingUsers}
              companyById={companyById}
              events={kpiEvents}
              activeFilter={activeUserFilter}
              onFilterChange={setActiveUserFilter}
              onSelect={userId => { setSelectedUserId(userId); setMobileDetail(true); setActiveTab('overview') }}
            />
          </div>
          <div className={mobileDetail ? 'block' : 'hidden lg:block'}>
            {selectedUser ? (
              <DeveloperUserManagementPanel
                row={selectedUser}
                data={selectedData}
                loading={loadingSelected}
                modules={modules}
                selectedCompanyId={selectedCompanyId}
                activeTab={activeTab}
                onCompanyChange={setSelectedCompanyId}
                onTabChange={setActiveTab}
                onRefresh={refreshSelected}
                onMobileBack={() => setMobileDetail(false)}
                systemData={systemData}
                systemLoading={loadingSystem}
                schemaStatus={schemaStatus}
                supabaseStatus={supabaseStatus}
                lastSync={lastSync}
                clearingErrors={clearingErrors}
                onClearErrors={clearErrors}
              />
            ) : (
              <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Select a user to manage licensing, companies, modules, and support.</CardContent></Card>
            )}
          </div>
        </div>
      </PageContent>
    </div>
  )
}
