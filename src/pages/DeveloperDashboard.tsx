import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, Building2, CheckCircle2, ChevronDown, Database,
  Copy, Download, FileText, Grid2X2, HardDrive, KeyRound, ListChecks, Loader2, Mail, NotebookText, PackageCheck,
  RefreshCcw, ShieldCheck, Trash2, UserRound, Users,
} from 'lucide-react'
import {
  checkSupabaseConnectionStatus,
  clearDeveloperErrorLogs,
  deleteDeveloperCompany,
  fetchDeveloperDashboardData,
  fetchDeveloperSchemaStatus,
  fetchDeveloperUserCompanyLicenses,
  fetchDeveloperBackupStatus,
  fetchDeveloperPerformanceSummary,
  startDeveloperBackupRun,
  exportDeveloperCompanySnapshot,
  recordDeveloperCompanyBackupResult,
  completeDeveloperBackupRun,
  listDeveloperBackupAgents,
  createDeveloperBackupAgent,
  deleteDeveloperBackupAgent,
  revokeDeveloperBackupAgent,
  supabaseProjectHost,
  isDeveloperAdmin,
  updateDeveloperCompany,
  updateUserCompanyLimit,
  upsertCompanyModule,
  type DeveloperSchemaStatusItem,
  type DeveloperBackupRun,
  type DeveloperCompanyBackupStatus,
  type DeveloperBackupAgent,
  type DeveloperPerformanceSummary,
} from '@/lib/supabase'
import { getPerformanceIngestionStatus, subscribePerformanceIngestionStatus, type PerformanceIngestionStatus } from '@/lib/writePerformance'
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
import { buildPortableCompanyBackup, serializePortableBackup, uniqueBackupNames } from '@/lib/portableBackup'
import { downloadBackupZip, ensureDirectoryPermission, loadBackupDirectoryHandle, saveBackupDirectoryHandle, supportsDirectoryBackup, writeCompanyBackup, type DirectoryHandleLike } from '@/lib/developerBackupStorage'
import { companyBillingStatus, companyBillingTooltip, companyPlanExpiryDateInput, companyRemainingDays } from '@/lib/billing'

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
type DeveloperTab = 'overview' | 'license' | 'companies' | 'modules' | 'users' | 'billing' | 'logs' | 'notes' | 'performance' | 'system'
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
  const source = row.display_name || row.email?.split('@')[0] || row.user_id.slice(0, 8)
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
  if (companies.some(company => companyBillingStatus(company) === 'expired')) return 'Expired'
  if (companies.some(company => companyBillingStatus(company) === 'trial')) return 'Trial'
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
  const [planEndsAt, setPlanEndsAt] = useState(() => companyPlanExpiryDateInput(company))
  const [support, setSupport] = useState(company.support_status || 'normal')
  const [suspended, setSuspended] = useState(company.suspended || false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPlan(company.plan_status || 'trial')
    setPlanEndsAt(companyPlanExpiryDateInput(company))
    setSupport(company.support_status || 'normal')
    setSuspended(company.suspended || false)
  }, [company])

  const save = async () => {
    setSaving(true)
    try {
      await updateDeveloperCompany(company.id, {
        plan_status: plan as Company['plan_status'],
        trial_ends_at: plan === 'trial' ? planEndsAt || null : null,
        plan_expires_at: (plan === 'trial' || plan === 'paid') && planEndsAt ? `${planEndsAt}T23:59:59.999+05:45` : null,
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
    <DashboardCard title="Support & Plan" Icon={ListChecks} action={<Button size="sm" onClick={save} disabled={saving || (plan === 'trial' && !planEndsAt)}>{saving ? 'Saving...' : 'Save Changes'}</Button>}>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label>Plan Type</Label><SearchableSelect value={plan} onValueChange={setPlan} options={[{ value: 'free', label: 'Free' }, { value: 'trial', label: 'Trial' }, { value: 'paid', label: 'Paid' }, { value: 'expired', label: 'Expired' }]} /></div>
        <div className="space-y-1.5"><Label>Support Level</Label><SearchableSelect value={support} onValueChange={setSupport} options={[{ value: 'normal', label: 'Normal' }, { value: 'needs_help', label: 'Needs help' }, { value: 'blocked', label: 'Blocked' }]} /></div>
        {(plan === 'trial' || plan === 'paid') && <div className="space-y-1.5"><Label>{plan === 'paid' ? 'Paid Until' : 'Trial Ends'}{plan === 'trial' && ' *'}</Label><Input type="date" value={planEndsAt} onChange={event => setPlanEndsAt(event.target.value)} /><p className="text-xs text-muted-foreground">{plan === 'paid' ? 'Leave blank for lifetime paid access.' : 'Required. Trial access becomes read-only after this deadline.'}</p></div>}
        <div className="rounded-md border bg-muted/20 p-3 text-sm"><MetricLine label="Effective Status" value={<Badge variant={companyBillingStatus(company) === 'expired' ? 'destructive' : 'outline'} className="capitalize">{companyBillingStatus(company)}</Badge>} /><MetricLine label="Remaining" value={companyRemainingDays(company) === null ? 'No expiry' : `${Math.max(companyRemainingDays(company) || 0, 0)} days`} /><p className="mt-2 text-xs text-muted-foreground">{companyBillingTooltip(company)}</p></div>
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
          <MetricLine label="Current Plan" value={<Badge title={companyBillingTooltip(selectedCompany)} variant={statusVariant(companyBillingStatus(selectedCompany))} className="capitalize">{companyBillingStatus(selectedCompany)}</Badge>} />
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
              <Badge title={companyBillingTooltip(company)} variant={statusVariant(companyBillingStatus(company))} className="capitalize">{companyBillingStatus(company)}</Badge>
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
              <Badge title={companyBillingTooltip(company)} variant={statusVariant(companyBillingStatus(company))} className="capitalize">{companyBillingStatus(company)}</Badge>
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

function PerformanceTab() {
  const [summary, setSummary] = useState<DeveloperPerformanceSummary | null>(null)
  const [ingestionStatus, setIngestionStatus] = useState<PerformanceIngestionStatus | null>(() => getPerformanceIngestionStatus())
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = async (windowDays = days) => {
    setLoading(true); setError('')
    try { setSummary(await fetchDeveloperPerformanceSummary(windowDays)) }
    catch (cause) { setError(publicErrorMessage(cause, 'loading performance metrics')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load(days) }, [days])
  useEffect(() => subscribePerformanceIngestionStatus(setIngestionStatus), [])
  return <DashboardCard title="CRUD Performance" Icon={Activity} action={<div className="flex gap-2"><SearchableSelect value={String(days)} onValueChange={value => setDays(Number(value))} options={[{ value: '1', label: '24 hours' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} className="w-32" /><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCcw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></div>}>
    {error && <p className="text-sm text-destructive">{error}</p>}
    {ingestionStatus?.state === 'error' && <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Performance collection failed in this browser (code {ingestionStatus.error_code || 'unknown'}). Confirm the performance migration is applied, then complete another voucher.</span></div>}
    {ingestionStatus?.state === 'success' && <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Collector connected · last sample sent {new Date(ingestionStatus.checked_at).toLocaleString()}</p>}
    <div className="grid gap-3 sm:grid-cols-3"><MetricLine label="Samples" value={summary?.total_samples || 0} /><MetricLine label="Target p50" value="< 500 ms" /><MetricLine label="Target p95" value="< 1,500 ms" /></div>
    <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2">Operation</th><th className="p-2 text-right">Samples</th><th className="p-2 text-right">p50</th><th className="p-2 text-right">p95</th><th className="p-2 text-right">p99</th><th className="p-2 text-right">Errors</th><th className="p-2 text-right">Max</th></tr></thead><tbody>{(summary?.operations || []).map(row => <tr key={row.operation} className="border-t"><td className="p-2 font-medium">{row.operation.replaceAll('_', ' ')}</td><td className="p-2 text-right num">{row.samples}</td><td className="p-2 text-right num">{row.p50_ms} ms</td><td className={`p-2 text-right num ${row.p95_ms > 1500 ? 'text-destructive' : 'text-emerald-700'}`}>{row.p95_ms} ms</td><td className="p-2 text-right num">{row.p99_ms} ms</td><td className="p-2 text-right num">{row.error_rate}%</td><td className="p-2 text-right num">{row.max_ms} ms</td></tr>)}</tbody></table>{!loading && !summary?.operations.length && <p className="p-6 text-center text-sm text-muted-foreground">No samples have been collected in this period. Complete a new Sales or Purchase voucher, then refresh. Earlier operations are not backfilled.</p>}</div>
    {!!summary?.slowest_stages?.length && <div><p className="mb-2 text-sm font-semibold">Slowest stages</p><div className="grid gap-2 md:grid-cols-2">{summary.slowest_stages.slice(0, 8).map(row => <div key={`${row.category}:${row.stage}`} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span><strong>{row.stage.replaceAll('_', ' ')}</strong><small className="ml-2 text-muted-foreground">{row.category}</small></span><span className="num">p95 {row.p95_ms} ms</span></div>)}</div></div>}
  </DashboardCard>
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
          {metrics.errorEvents.slice(0, 8).map(event => {
            const company = event.company_id ? metrics.companies.find(entry => entry.id === event.company_id) : null
            const companyLabel = company?.name || (event.company_id ? 'Deleted or unavailable company' : 'Global / authentication')
            return <div key={event.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <span className="flex min-w-0 items-center gap-2"><Building2 className="h-4 w-4 shrink-0 text-muted-foreground" /><strong className="truncate">{companyLabel}</strong></span>
                <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
              </div>
              <div className="pt-2"><Badge variant="destructive">{event.event_type}</Badge><EventMetadata metadata={event.metadata} /></div>
            </div>
          })}
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
            <TabsTrigger value="performance">Performance</TabsTrigger>
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
        <TabsContent value="performance"><PerformanceTab /></TabsContent>
        <TabsContent value="system"><SystemTab data={systemData} loading={systemLoading} schemaStatus={schemaStatus} supabaseStatus={supabaseStatus} lastSync={lastSync} clearingErrors={clearingErrors} onClearErrors={onClearErrors} /></TabsContent>
      </Tabs>
      <CompanyDangerActions company={selectedCompany} data={data} onSaved={onRefresh} />
    </div>
  )
}

type BackupResult = { companyId: string; companyName: string; userName: string; successful: boolean; error?: string }

function LocalBackupCard({ users }: { users: DeveloperUserCompanyLicense[] }) {
  const [directory, setDirectory] = useState<DirectoryHandleLike | null>(null)
  const [runs, setRuns] = useState<DeveloperBackupRun[]>([])
  const [companyStatuses, setCompanyStatuses] = useState<DeveloperCompanyBackupStatus[]>([])
  const [exporting, setExporting] = useState(false)
  const [completed, setCompleted] = useState(0)
  const [exportTotal, setExportTotal] = useState(0)
  const [current, setCurrent] = useState('')
  const [results, setResults] = useState<BackupResult[]>([])
  const [error, setError] = useState('')
  const [details, setDetails] = useState(false)
  const [agents, setAgents] = useState<DeveloperBackupAgent[]>([])
  const [newAgentToken, setNewAgentToken] = useState('')
  const directorySupported = supportsDirectoryBackup()
  const targets = useMemo(() => {
    const seen = new Set<string>()
    return users.flatMap(user => user.companies.map(company => ({ user, company }))).filter(target => !seen.has(target.company.id) && !!seen.add(target.company.id))
  }, [users])

  const refreshStatus = async () => {
    try {
      const [status, agentRows] = await Promise.all([fetchDeveloperBackupStatus(), listDeveloperBackupAgents()])
      setRuns(status.runs); setCompanyStatuses(status.companies); setAgents(agentRows)
    } catch { /* migrations may not be installed yet */ }
  }

  useEffect(() => {
    void loadBackupDirectoryHandle().then(setDirectory)
    void refreshStatus()
  }, [])

  const selectLocation = async () => {
    setError('')
    if (!window.showDirectoryPicker) return setError('Automatic folder backup requires a supported Chromium browser. Export All will download a ZIP instead.')
    try {
      const handle = await window.showDirectoryPicker()
      if (!await ensureDirectoryPermission(handle)) throw new Error('Read/write permission was not granted.')
      await saveBackupDirectoryHandle(handle)
      setDirectory(handle)
    } catch (caught) {
      if ((caught as DOMException)?.name !== 'AbortError') setError(caught instanceof Error ? caught.message : 'Could not select the backup location.')
    }
  }

  const runExport = async (onlyCompanyIds?: Set<string>) => {
    const selectedTargets = onlyCompanyIds ? targets.filter(target => onlyCompanyIds.has(target.company.id)) : targets
    if (!selectedTargets.length) return setError('No companies are available to export.')
    if (directorySupported && !directory) return setError('Select a backup location before exporting company data.')
    setExporting(true); setCompleted(0); setExportTotal(selectedTargets.length); setCurrent(''); setResults([]); setError(''); setDetails(false)
    const nextResults: BackupResult[] = []
    const zipFiles: { path: string; content: string }[] = []
    let run: DeveloperBackupRun | null = null
    try {
      if (directory && !await ensureDirectoryPermission(directory)) throw new Error('Backup folder permission was lost. Use Change Location or grant permission again.')
      run = await startDeveloperBackupRun(selectedTargets.length)
      const userNames = uniqueBackupNames(users.map(user => ({ id: user.user_id, name: displayNameFor(user) })), 'User')
      const companyNames = new Map<string, Map<string, string>>()
      for (const user of users) companyNames.set(user.user_id, uniqueBackupNames(user.companies.map(company => ({ id: company.id, name: company.name })), 'Company'))
      for (const target of selectedTargets) {
        const userName = userNames.get(target.user.user_id) || `User (${target.user.user_id.slice(0, 8)})`
        const companyName = companyNames.get(target.user.user_id)?.get(target.company.id) || `Company (${target.company.id.slice(0, 8)})`
        setCurrent(`${userName} → ${target.company.name}`)
        let result: BackupResult
        try {
          const snapshot = await exportDeveloperCompanySnapshot(target.company.id)
          const backup = buildPortableCompanyBackup(snapshot, { exportedBy: run.initiated_by })
          const content = serializePortableBackup(backup)
          if (directory) await writeCompanyBackup(directory, userName, companyName, content)
          else zipFiles.push({ path: `${userName}/${companyName}/company-backup.json`, content })
          result = { companyId: target.company.id, companyName: target.company.name, userName, successful: true }
          if (directory) await recordDeveloperCompanyBackupResult(run.id, target.company.id, true)
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Export failed.'
          result = { companyId: target.company.id, companyName: target.company.name, userName, successful: false, error: message }
          try { await recordDeveloperCompanyBackupResult(run.id, target.company.id, false, 'Company backup generation or local write failed.') } catch { /* preserve original result */ }
        }
        nextResults.push(result); setResults([...nextResults]); setCompleted(nextResults.length)
      }
      if (!directory && zipFiles.length) {
        downloadBackupZip(zipFiles)
        for (const result of nextResults.filter(entry => entry.successful)) await recordDeveloperCompanyBackupResult(run.id, result.companyId, true)
      }
      await completeDeveloperBackupRun(run.id)
      const failed = nextResults.filter(result => !result.successful).length
      notifySuccess(failed ? 'Backup completed with warnings' : 'All company backups exported', `${nextResults.length - failed} successful / ${failed} failed`)
      setDetails(failed > 0)
      await refreshStatus()
    } catch (caught) {
      setError(publicErrorMessage(caught, 'exporting all company data'))
      if (run) try { await completeDeveloperBackupRun(run.id) } catch { /* already failed */ }
    } finally { setExporting(false); setCurrent('') }
  }

  const failedIds = new Set(results.filter(result => !result.successful).map(result => result.companyId))
  const companyCount = targets.length
  const lastFullRun = runs.find(run => run.total_companies === companyCount && run.status !== 'running')
  const lastRun = runs.find(run => run.status !== 'running')
  const statusByCompany = new Map(companyStatuses.map(status => [status.company_id, status]))
  const createAgent = async () => {
    const name = window.prompt('Name this Windows backup agent:', 'B Drive Backup Agent')?.trim()
    if (!name) return
    try { const created = await createDeveloperBackupAgent(name); setNewAgentToken(created.token); await refreshStatus() }
    catch (caught) { setError(publicErrorMessage(caught, 'creating Windows backup agent')) }
  }
  const revokeAgent = async (agent: DeveloperBackupAgent) => {
    if (!window.confirm(`Revoke ${agent.name}? Its Windows task will no longer be able to download backups.`)) return
    try { await revokeDeveloperBackupAgent(agent.id); await refreshStatus() }
    catch (caught) { setError(publicErrorMessage(caught, 'revoking Windows backup agent')) }
  }
  const deleteAgent = async (agent: DeveloperBackupAgent) => {
    if (!window.confirm(`Permanently delete ${agent.name}? Its token will stop working immediately. This cannot remove the Scheduled Task from the Windows computer.`)) return
    try { await deleteDeveloperBackupAgent(agent.id); await refreshStatus() }
    catch (caught) { setError(publicErrorMessage(caught, 'deleting Windows backup agent')) }
  }

  return <Card>
    <CardHeader className="pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle className="flex items-center gap-2 text-base"><HardDrive className="h-4 w-4" />Local Backup</CardTitle><p className="mt-1 text-xs text-muted-foreground">Portable company backups for every managed user and company.</p></div><Button variant="outline" size="sm" onClick={selectLocation} disabled={exporting}>{directory ? 'Change Location' : 'Select Backup Location'}</Button></div></CardHeader>
    <CardContent className="space-y-3">
      <div className="grid gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-md border p-2"><span className="text-muted-foreground">Backup Location</span><strong className="mt-1 block truncate">{directory?.name || (directorySupported ? 'Not selected' : 'ZIP download fallback')}</strong></div>
        <div className="rounded-md border p-2"><span className="text-muted-foreground">Last Full Backup</span><strong className="mt-1 block">{lastFullRun?.completed_at ? new Date(lastFullRun.completed_at).toLocaleString() : 'Never'}</strong></div>
        <div className="rounded-md border p-2"><span className="text-muted-foreground">Companies</span><strong className="mt-1 block num">{companyCount}</strong></div>
        <div className="rounded-md border p-2"><span className="text-muted-foreground">Last Result</span><strong className="mt-1 block">{lastRun ? `${lastRun.successful_companies} successful / ${lastRun.failed_companies} failed` : 'No backup yet'}</strong>{lastRun?.initiator_type && <span className="capitalize text-muted-foreground">{lastRun.initiator_type}</span>}</div>
      </div>
      {!directorySupported && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">This browser cannot write directly to B:\ or another folder. Export All downloads one ZIP; automatic replacement requires a Chromium browser with directory permission.</p>}
      {exporting && <div className="rounded-md border bg-muted/30 p-3 text-xs"><p className="font-semibold">Exporting backups...</p><p className="mt-1">Users: {users.length} · Companies: {exportTotal} · Completed: {completed} / {exportTotal}</p>{current && <p className="mt-1 text-muted-foreground">Current: {current}</p>}</div>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="rounded-md border p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">Windows Background Agent</p><p className="text-muted-foreground">Runs at logon and every two hours, even when KhataERP is closed.</p></div><Button size="sm" variant="outline" onClick={() => void createAgent()}><KeyRound className="mr-1.5 h-4 w-4" />Create Agent Token</Button></div>
        {newAgentToken && <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900"><strong>Copy this token now. It is shown only once.</strong><div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-white p-1">{newAgentToken}</code><Button size="icon" variant="outline" aria-label="Copy agent token" onClick={() => void navigator.clipboard.writeText(newAgentToken)}><Copy className="h-4 w-4" /></Button></div><p className="mt-1">Project URL: <code>https://{supabaseProjectHost}</code></p><p className="mt-1">Run <code>windows-backup-agent/Install-KhataERPBackupAgent.ps1</code> on the backup computer.</p></div>}
        {agents.length > 0 && <div className="mt-2 space-y-1">{agents.map(agent => <div key={agent.id} className="flex items-center justify-between gap-2 border-t pt-1"><span><strong>{agent.name}</strong><span className="ml-2 text-muted-foreground">{agent.revoked_at ? 'Revoked' : agent.last_seen_at ? `Last synced ${new Date(agent.last_seen_at).toLocaleString()}` : 'Never connected'}</span></span><span className="flex items-center gap-1">{!agent.revoked_at && <Button size="sm" variant="ghost" onClick={() => void revokeAgent(agent)}>Revoke</Button>}<Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void deleteAgent(agent)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button></span></div>)}</div>}
        <p className="mt-2 text-muted-foreground">Delete removes the server token record. To remove the task from that computer too, run <code>windows-backup-agent/Uninstall-KhataERPBackupAgent.ps1</code> there.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Button onClick={() => void runExport()} disabled={exporting || !companyCount}><Download className="mr-1.5 h-4 w-4" />{exporting ? 'Exporting...' : results.length ? 'Export Again' : 'Export All Company Data'}</Button>{failedIds.size > 0 && <Button variant="outline" onClick={() => void runExport(failedIds)} disabled={exporting}>Retry Failed</Button>}{companyCount > 0 && <Button variant="ghost" onClick={() => setDetails(value => !value)}>{results.length ? 'View Details' : 'Company Status'}</Button>}</div>
      {details && <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">{results.map(result => <div key={result.companyId} className="flex items-start justify-between gap-3 border-b py-1 last:border-0"><div><strong>{result.companyName}</strong><span className="block text-muted-foreground">{result.userName}{result.error ? ` · ${result.error}` : ''}</span></div><Badge variant={result.successful ? 'default' : 'destructive'}>{result.successful ? 'Successful' : 'Failed'}</Badge></div>)}{!results.length && targets.map(target => { const status = statusByCompany.get(target.company.id); return <div key={target.company.id}>{target.company.name}: {status?.last_export_status || 'Not exported'}</div> })}</div>}
    </CardContent>
  </Card>
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
        <LocalBackupCard users={users} />
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
