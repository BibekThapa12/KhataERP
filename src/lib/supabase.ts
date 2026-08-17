import { createClient } from '@supabase/supabase-js'
import type { Account, AccountCategory, Party, Item, ItemCategory, InvoiceItem, MasterChangeLog, Voucher, VoucherLine, StockLine, Company, VoucherSettlement, AppModule, CompanyModule, ChequeBank, Cheque, ChequeEvent, ChequePermission, CompanyCreateInput, MyCompaniesResponse, DeveloperUserCompanyLicense } from '@/types'
import { DEFAULT_FISCAL_YEAR_START_AD, normalizeVoucherDates } from '@/lib/nepaliDate'
import { setWritePerformanceReporter, type PersistedWritePerformanceSample, type WritePerformanceTrace } from '@/lib/writePerformance'
import { auditFieldMarkers, publicErrorMessage, redactSensitiveText, safeErrorCode, safeErrorMessage, sanitizeForLogging } from '@/lib/security'
import { formatMasterName } from '@/lib/nameFormat'

function requiredPublicEnvironment(name: string, value: string | undefined) {
  if (!value || value.startsWith('your-') || value.includes('your-project-id')) {
    throw new Error(`Missing required public environment variable ${name}`)
  }
  return value
}

function assertBrowserSafeSupabaseKey(key: string) {
  if (/^sb_secret_/i.test(key)) throw new Error('VITE_SUPABASE_ANON_KEY must never contain a Supabase secret key')
  const parts = key.split('.')
  if (parts.length !== 3) return key
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as { role?: string }
    if (payload.role === 'service_role') throw new Error('VITE_SUPABASE_ANON_KEY must never contain the service-role key')
  } catch (error) {
    if (error instanceof Error && error.message.includes('service-role')) throw error
  }
  return key
}

const supabaseUrl = requiredPublicEnvironment('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = assertBrowserSafeSupabaseKey(requiredPublicEnvironment('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY))

try {
  const parsedSupabaseUrl = new URL(supabaseUrl)
  if (!import.meta.env.DEV && parsedSupabaseUrl.protocol !== 'https:') {
    throw new Error('VITE_SUPABASE_URL must use HTTPS in production')
  }
} catch (error) {
  if (error instanceof Error && error.message.includes('must use HTTPS')) throw error
  throw new Error('VITE_SUPABASE_URL must be a valid URL')
}

// A browser-only SPA cannot issue an httpOnly session cookie. This adapter
// allows trusted devices to retain Supabase's rotating refresh token while
// still offering tab-only sessions for shared computers.
const REMEMBER_SESSION_KEY = 'khataerp:remember-session'

function rememberSessionEnabled() {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(REMEMBER_SESSION_KEY) !== 'false' } catch { return false }
}

const authStorage = typeof window === 'undefined' ? undefined : {
  getItem(key: string) {
    try { return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key) } catch { return null }
  },
  setItem(key: string, value: string) {
    try {
      const persistent = rememberSessionEnabled()
      const target = persistent ? window.localStorage : window.sessionStorage
      const other = persistent ? window.sessionStorage : window.localStorage
      target.setItem(key, value)
      other.removeItem(key)
    } catch { /* storage may be unavailable in privacy mode */ }
  },
  removeItem(key: string) {
    try { window.localStorage.removeItem(key) } catch { /* unavailable */ }
    try { window.sessionStorage.removeItem(key) } catch { /* unavailable */ }
  },
}

export function getRememberSession() {
  return rememberSessionEnabled()
}

export function setRememberSession(remember: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(REMEMBER_SESSION_KEY, String(remember))
    // Migrate an existing session immediately if this setting is changed while
    // a token already exists. Never duplicate the token across both stores.
    const source = remember ? window.sessionStorage : window.localStorage
    const target = remember ? window.localStorage : window.sessionStorage
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const key = source.key(index)
      if (!key || !/^sb-.*-auth-token$/i.test(key)) continue
      const value = source.getItem(key)
      if (value) target.setItem(key, value)
      source.removeItem(key)
    }
  } catch { /* storage may be unavailable in privacy mode */ }
}

if (typeof window !== 'undefined') setRememberSession(rememberSessionEnabled())
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    persistSession: Boolean(authStorage),
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

setWritePerformanceReporter(async (sample: PersistedWritePerformanceSample) => {
  const { company_id, ...safeSample } = sample
  const { error } = await supabase.rpc('record_performance_sample', { p_company_id: company_id, p_sample: safeSample })
  if (error) throw error
})

export interface DeveloperPerformanceOperation {
  operation: string
  samples: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
  average_ms: number
  error_rate: number
  max_ms: number
}

export interface DeveloperPerformanceSummary {
  window_days: number
  total_samples: number
  operations: DeveloperPerformanceOperation[]
  slowest_stages: Array<{ stage: string; category: string; samples: number; average_ms: number; p95_ms: number }>
}

export async function fetchDeveloperPerformanceSummary(days = 7): Promise<DeveloperPerformanceSummary> {
  const { data, error } = await supabase.rpc('developer_performance_summary', { p_days: days })
  if (error) throw error
  return (data || { window_days: days, total_samples: 0, operations: [], slowest_stages: [] }) as DeveloperPerformanceSummary
}

const COMPANY_FIELDS = 'id,user_id,owner_email,name,address,pan_vat,phone,vat_enabled,inventory_valuation_method,sales_prefix,purchase_prefix,receipt_prefix,payment_prefix,sales_return_prefix,purchase_return_prefix,journal_numbering_mode,reset_numbering_fiscal_year,allow_admin_chronological_bypass,enforce_sales_invoice_chronology,print_format,show_company_details_on_sales_invoice,invoice_terms,payment_qr_text,logo_url,plan_status,trial_ends_at,plan_expires_at,suspended,fiscal_year_start,fiscal_year_configured,bootstrap_version,created_at'
const DEVELOPER_COMPANY_FIELDS = `${COMPANY_FIELDS},support_status,developer_notes`
const ACCOUNT_FIELDS = 'id,company_id,name,type,group,is_system,is_party,opening_balance,address,contact_no,pan_no,credit_days,bank_account_no,bank_branch,category_id,is_archived,created_at'
const PARTY_FIELDS = 'id,company_id,name,type,phone,pan_vat,address,default_credit_days,account_id,is_archived,created_at'
const ITEM_FIELDS = 'id,company_id,name,unit,alternate_unit,alternate_conversion,sell_rate,opening_qty,opening_rate,reorder_level,category_id,sku,barcode,vat_applicable,is_service,is_archived,created_at'
const ACCOUNT_CATEGORY_FIELDS = 'id,company_id,name,account_type,parent_category_id,is_system,is_archived,created_at'
const ITEM_CATEGORY_FIELDS = 'id,company_id,name,parent_category_id,is_archived,created_at'
const MODULE_FIELDS = 'id,key,name,description,default_price,is_active,created_at'
const COMPANY_MODULE_FIELDS = `id,company_id,module_id,is_enabled,status,billing_type,price,payment_status,starts_at,expires_at,settings,internal_notes,enabled_by,created_at,updated_at,module:modules(${MODULE_FIELDS})`
const CLIENT_COMPANY_MODULE_FIELDS = `id,company_id,module_id,is_enabled,status,billing_type,payment_status,starts_at,expires_at,settings,module:modules(${MODULE_FIELDS})`
const CHEQUE_BANK_FIELDS = 'id,company_id,ledger_account_id,bank_name,branch_name,account_number,institution_type,source,notes,is_active,created_at,updated_at'
const CHEQUE_FIELDS = 'id,company_id,direction,cheque_number,bank_id,account_number,source_account_id,party_ledger_id,amount,issue_date,issue_date_bs,issue_date_bs_key,due_date,due_date_bs,due_date_bs_key,cleared_date_bs,cleared_date_bs_key,notes,status,cleared_at,bounced_at,cancelled_at,status_reason,linked_voucher_id,cleared_to_account_id,created_at,updated_at'
const CHEQUE_EVENT_FIELDS = 'id,action,created_at'
const MASTER_CHANGE_FIELDS = 'id,record_type,action,old_values,new_values,created_at'
const VOUCHER_SETTLEMENT_FIELDS = 'id,company_id,settlement_voucher_id,invoice_voucher_id,party_account_id,amount,created_at'
const VOUCHER_FIELDS = 'id,company_id,type,date,date_ad,date_bs,date_bs_key,invoice_no,draft_no,supplier_invoice_no,numbering_period,credit_days,due_date_ad,due_date_bs,due_date_bs_key,narration,original_voucher_id,return_reason,settlement_mode,settlement_account_id,simple_entry_type,contra_entry,contra_destination_account_id,contra_charge_amount,restock_items,party_account_id,is_cash,subtotal,discount,vat_rate,vat_amount,total,cancelled,status,seq,created_by,updated_by,created_at,updated_at,completed_by,completed_at,draft_payload'
const VOUCHER_LINE_FIELDS = 'id,voucher_id,account_id,debit,credit'
const STOCK_LINE_FIELDS = 'id,voucher_id,item_id,qty,rate,direction,stock_condition,is_transfer'
const INVOICE_ITEM_FIELDS = 'id,voucher_id,item_id,qty,rate,amount,source_invoice_item_id,item_name,unit,entry_unit,conversion_factor,base_qty,discount_amount,taxable_amount,vat_amount,cost_rate'
const VOUCHER_WITH_CHILDREN_FIELDS = `${VOUCHER_FIELDS},lines:voucher_lines(${VOUCHER_LINE_FIELDS}),stock_lines:stock_lines(${STOCK_LINE_FIELDS}),invoice_items:invoice_items(${INVOICE_ITEM_FIELDS}),settlements:voucher_settlements!settlement_voucher_id(${VOUCHER_SETTLEMENT_FIELDS})`
export const supabaseProjectHost = (() => {
  if (!supabaseUrl) return ''
  try {
    return new URL(supabaseUrl).host
  } catch {
    return ''
  }
})()

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const getSession = () => supabase.auth.getSession()
export const signIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password })
  // Future CAPTCHA: add options: { captchaToken } to this request.

export const requestPasswordReset = (email: string) =>
  supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
    // Future CAPTCHA: add captchaToken here.
  })

export const updateRecoveredPassword = (password: string) =>
  supabase.auth.updateUser({ password })

export interface CompanySignupDetails {
  name: string
  address: string
  pan_vat: string
  phone: string
  vat_enabled: boolean
}

export const signUp = (email: string, password: string, company: CompanySignupDetails) =>
  supabase.auth.signUp({
    email,
    password,
    options: {
      // Future CAPTCHA: add captchaToken here.
      emailRedirectTo: `${window.location.origin}/login`,
      data: {
        company_name: formatMasterName(company.name),
        company_address: company.address,
        company_pan_vat: company.pan_vat,
        company_phone: company.phone,
        company_vat_enabled: company.vat_enabled,
      },
    },
  })
export const signOut = () => supabase.auth.signOut()

export async function isDeveloperAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data, error } = await supabase
    .from('developer_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return false
  return !!data
}

export async function logAppEvent(event_type: string, company_id?: string | null, metadata: Record<string, unknown> = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !company_id) return
  await supabase.from('app_events').insert({ event_type, company_id, user_id: user.id, metadata: sanitizeForLogging(metadata) })
}

export function logAppError(company_id: string | undefined | null, error: unknown, context: Record<string, unknown> = {}) {
  const message = safeErrorMessage(error)
  const code = safeErrorCode(error)
  const stack = error instanceof Error && error.stack ? redactSensitiveText(error.stack) : undefined
  logAppEvent('frontend_error', company_id, {
    message,
    code,
    stack,
    path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    ...(sanitizeForLogging(context) as Record<string, unknown>),
  })
}

export type DeveloperSchemaStatusItem = {
  key: string
  label: string
  status: 'ok' | 'missing'
  detail: string
}

export async function fetchDeveloperSchemaStatus(): Promise<{
  available: boolean
  items: DeveloperSchemaStatusItem[]
  error?: string
}> {
  const { data, error } = await supabase.rpc('get_developer_schema_status')
  if (error) {
    return {
      available: false,
      items: [],
      error: publicErrorMessage(error, 'checking database schema'),
    }
  }
  return {
    available: true,
    items: Array.isArray(data) ? data as DeveloperSchemaStatusItem[] : [],
  }
}

export async function checkSupabaseConnectionStatus() {
  const messages: string[] = []
  let project = 'Missing VITE_SUPABASE_URL'
  if (supabaseUrl) {
    try {
      project = new URL(supabaseUrl).host
    } catch {
      project = supabaseUrl
    }
  }
  const status = {
    checked_at: new Date().toISOString(),
    project,
    auth: 'checking' as 'ok' | 'error' | 'checking',
    database: 'checking' as 'ok' | 'error' | 'checking',
    event_log: 'checking' as 'ok' | 'error' | 'checking',
    realtime: 'configured',
    messages,
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    status.auth = 'error'
    status.database = 'error'
    status.event_log = 'error'
    messages.push('Missing Supabase environment variables.')
    return status
  }

  const { error: authError } = await supabase.auth.getSession()
  status.auth = authError ? 'error' : 'ok'
  if (authError) messages.push(publicErrorMessage(authError, 'checking authentication'))

  const { error: dbError } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
  status.database = dbError ? 'error' : 'ok'
  if (dbError) messages.push(publicErrorMessage(dbError, 'checking company storage'))

  const { error: eventError } = await supabase
    .from('app_events')
    .select('id', { count: 'exact', head: true })
  status.event_log = eventError ? 'error' : 'ok'
  if (eventError) messages.push(publicErrorMessage(eventError, 'checking event storage'))

  return status
}

// ─── Company ──────────────────────────────────────────────────────────────────

const companyInitializationPromises = new Map<string, Promise<Company>>()

async function clearSignupCompanyMetadata(metadata: Record<string, unknown>) {
  // Supabase keeps keys whose value was cleared to null. Treat those as
  // already cleared so every later login does not perform an unnecessary
  // blocking auth.updateUser round trip.
  if (!Object.entries(metadata).some(([key, value]) => key.startsWith('company_') && value !== null && value !== undefined)) return
  await supabase.auth.updateUser({ data: {
    company_name: null,
    company_address: null,
    company_pan_vat: null,
    company_phone: null,
    company_vat_enabled: null,
  } })
}

export async function fetchMyCompanies(): Promise<MyCompaniesResponse> {
  const { data, error } = await supabase.rpc('get_my_companies')
  if (error) throw error
  const response = (data || {}) as Partial<MyCompaniesResponse>
  return {
    active_company_id: response.active_company_id || null,
    memberships: Array.isArray(response.memberships) ? response.memberships : [],
    license: response.license || {
      user_id: '',
      current_companies: 0,
      max_companies: 1,
      unlimited_companies: false,
      company_creation_enabled: true,
      license_status: 'active',
      expires_at: null,
      remaining_companies: 1,
      can_create_company: true,
    },
  }
}

export async function createCompanyAtomic(company: CompanyCreateInput): Promise<Company> {
  const payload = { ...company, name: formatMasterName(company.name || '') || 'My Company' }
  const { data, error } = await supabase.rpc('create_company_atomic', { p_company: payload })
  if (error) throw error
  return data as Company
}

export async function setActiveCompanyRemote(companyId: string): Promise<Company> {
  const { data, error } = await supabase.rpc('set_active_company', { target_company: companyId })
  if (error) throw error
  return data as Company
}

export async function addExistingCompanyAdmin(companyId: string, email: string) {
  const { data, error } = await supabase.rpc('add_existing_company_admin', { target_company: companyId, target_email: email })
  if (error) throw error
  return data
}

export async function fetchDeveloperUserCompanyLicenses(): Promise<DeveloperUserCompanyLicense[]> {
  const { data, error } = await supabase.rpc('developer_user_company_licenses')
  if (error) throw error
  return Array.isArray(data) ? data as DeveloperUserCompanyLicense[] : []
}

export interface DeveloperBackupRun {
  id: string; started_at: string; completed_at?: string | null; initiated_by: string
  initiator_type?: 'manual' | 'automated' | 'agent_retry'
  total_companies: number; successful_companies: number; failed_companies: number
  status: 'running' | 'successful' | 'partial' | 'failed'
}
export interface DeveloperCompanyBackupStatus {
  company_id: string; last_exported_at?: string | null; last_attempted_at?: string | null
  last_export_status: 'successful' | 'failed'; last_exported_by?: string | null; last_error?: string | null
}
export interface DeveloperBackupAgent { id: string; name: string; created_at: string; last_seen_at?: string | null; revoked_at?: string | null }

export async function listDeveloperBackupAgents() {
  const { data, error } = await supabase.rpc('list_developer_backup_agents')
  if (error) throw error
  return (data || []) as DeveloperBackupAgent[]
}

export async function createDeveloperBackupAgent(name: string) {
  const { data, error } = await supabase.rpc('create_developer_backup_agent', { p_name: name })
  if (error) throw error
  return data as { id: string; name: string; token: string; created_at: string }
}

export async function revokeDeveloperBackupAgent(id: string) {
  const { error } = await supabase.rpc('revoke_developer_backup_agent', { p_agent_id: id })
  if (error) throw error
}

export async function deleteDeveloperBackupAgent(id: string) {
  const { error } = await supabase.rpc('delete_developer_backup_agent', { p_agent_id: id })
  if (error) throw error
}

export async function fetchDeveloperBackupStatus() {
  const [{ data: runs, error: runError }, { data: companies, error: companyError }] = await Promise.all([
    supabase.from('developer_backup_runs').select('*').order('started_at', { ascending: false }).limit(20),
    supabase.from('developer_company_backup_status').select('*'),
  ])
  if (runError) throw runError
  if (companyError) throw companyError
  return { runs: (runs || []) as DeveloperBackupRun[], companies: (companies || []) as DeveloperCompanyBackupStatus[] }
}

export async function startDeveloperBackupRun(totalCompanies: number) {
  const { data, error } = await supabase.rpc('start_developer_backup_run', { p_total_companies: totalCompanies })
  if (error) throw error
  return data as DeveloperBackupRun
}

export async function exportDeveloperCompanySnapshot(companyId: string) {
  const { data, error } = await supabase.rpc('developer_export_company_backup', { target_company: companyId })
  if (error) throw error
  return data as Record<string, unknown>
}

export async function recordDeveloperCompanyBackupResult(runId: string, companyId: string, successful: boolean, errorMessage?: string) {
  const { data, error } = await supabase.rpc('record_developer_company_backup_result', { p_run_id: runId, p_company_id: companyId, p_successful: successful, p_error: errorMessage || null })
  if (error) throw error
  return data as DeveloperCompanyBackupStatus
}

export async function completeDeveloperBackupRun(runId: string) {
  const { data, error } = await supabase.rpc('complete_developer_backup_run', { p_run_id: runId })
  if (error) throw error
  return data as DeveloperBackupRun
}

export async function updateUserCompanyLimit(value: {
  user_id: string
  max_companies: number
  unlimited_companies: boolean
  company_creation_enabled: boolean
  license_status: 'active' | 'expired' | 'suspended'
  expires_at?: string | null
}) {
  const { data, error } = await supabase.rpc('update_user_company_limit', {
    target_user: value.user_id,
    p_max_companies: value.max_companies,
    p_unlimited_companies: value.unlimited_companies,
    p_company_creation_enabled: value.company_creation_enabled,
    p_license_status: value.license_status,
    p_expires_at: value.expires_at || null,
  })
  if (error) throw error
  return data
}

async function getOrCreateCompanyInternal(user_id: string): Promise<Company> {
  const [{ data: userData }, companyResponse] = await Promise.all([
    supabase.auth.getUser(),
    fetchMyCompanies(),
  ])

  const metadata = userData.user?.user_metadata ?? {}
  const metadataCompany = {
    owner_email: userData.user?.email,
    name: String(metadata.company_name || '').trim(),
    address: String(metadata.company_address || '').trim(),
    pan_vat: String(metadata.company_pan_vat || '').trim(),
    phone: String(metadata.company_phone || '').trim(),
    vat_enabled: metadata.company_vat_enabled !== false,
  }

  const existingMemberships = companyResponse.memberships || []
  if (existingMemberships.length) {
    const scoreCompany = (company: Company) => {
      let score = 0
      if (company.name && company.name !== 'My Trading Co.') score += 5
      if (company.address) score += 2
      if (company.pan_vat) score += 2
      if (company.phone) score += 2
      if (company.owner_email) score += 1
      return score
    }

    const activeCompany = existingMemberships.find(entry => entry.company_id === companyResponse.active_company_id)?.company
    const selected = activeCompany || [...existingMemberships.map(entry => entry.company)].sort((a, b) => scoreCompany(b) - scoreCompany(a))[0]
    const updates: Partial<Company> = {}

    if (!selected.fiscal_year_start) {
      updates.fiscal_year_start = DEFAULT_FISCAL_YEAR_START_AD
    }
    if (!selected.owner_email && metadataCompany.owner_email) {
      updates.owner_email = metadataCompany.owner_email
    }
    if (selected.name === 'My Trading Co.' && metadataCompany.name) {
      updates.name = metadataCompany.name
    }
    if (!selected.address && metadataCompany.address) {
      updates.address = metadataCompany.address
    }
    if (!selected.pan_vat && metadataCompany.pan_vat) {
      updates.pan_vat = metadataCompany.pan_vat
    }
    if (!selected.phone && metadataCompany.phone) {
      updates.phone = metadataCompany.phone
    }

    if (Object.keys(updates).length) {
      await updateCompany(selected.id, updates)
      await clearSignupCompanyMetadata(metadata)
      return { ...selected, ...updates }
    }
    const active = companyResponse.active_company_id === selected.id ? selected : await setActiveCompanyRemote(selected.id)
    await clearSignupCompanyMetadata(metadata)
    return active
  }

  const company = {
    name: metadataCompany.name || 'My Trading Co.',
    address: metadataCompany.address,
    pan_vat: metadataCompany.pan_vat,
    phone: metadataCompany.phone,
    vat_enabled: metadataCompany.vat_enabled,
    sales_prefix: 'INV-',
    purchase_prefix: 'PB-',
    receipt_prefix: 'RCPT-',
    payment_prefix: 'PAY-',
    sales_return_prefix: 'SR-',
    purchase_return_prefix: 'PR-',
    journal_numbering_mode: 'auto',
    reset_numbering_fiscal_year: true,
    allow_admin_chronological_bypass: false,
    enforce_sales_invoice_chronology: false,
    print_format: 'A5',
    show_company_details_on_sales_invoice: true,
    fiscal_year_start: DEFAULT_FISCAL_YEAR_START_AD,
    fiscal_year_configured: true,
  }

  const newCompany = await createCompanyAtomic(company)
  await clearSignupCompanyMetadata(metadata)
  return newCompany
}

export function getOrCreateCompany(user_id: string): Promise<Company> {
  const pending = companyInitializationPromises.get(user_id)
  if (pending) return pending

  const request = getOrCreateCompanyInternal(user_id)
    .finally(() => companyInitializationPromises.delete(user_id))
  companyInitializationPromises.set(user_id, request)
  return request
}

export async function updateCompany(id: string, updates: Partial<Company>) {
  const payload = typeof updates.name === 'string' ? { ...updates, name: formatMasterName(updates.name) || 'My Company' } : updates
  const { error } = await supabase.from('companies').update(payload).eq('id', id)
  if (error) throw error
}

export async function fetchDeveloperDashboardData(companyIds?: string[]) {
  const scoped = Array.isArray(companyIds)
  if (scoped && companyIds.length === 0) {
    const [modulesRes, companyModulesRes] = await Promise.all([
      supabase.from('modules').select(MODULE_FIELDS).order('name'),
      supabase.from('company_modules').select(COMPANY_MODULE_FIELDS).limit(0),
    ])
    return {
      companies: [],
      accounts: [],
      parties: [],
      items: [],
      vouchers: [],
      events: [],
      modules: modulesRes.error ? [] : (modulesRes.data || []) as AppModule[],
      companyModules: companyModulesRes.error ? [] : (companyModulesRes.data || []) as CompanyModule[],
    }
  }

  let companiesQuery = supabase.from('companies').select(DEVELOPER_COMPANY_FIELDS).order('created_at', { ascending: false })
  let accountsQuery = supabase.from('accounts').select(ACCOUNT_FIELDS)
  let partiesQuery = supabase.from('parties').select(PARTY_FIELDS)
  let itemsQuery = supabase.from('items').select(ITEM_FIELDS)
  let vouchersQuery = supabase.from('vouchers').select(VOUCHER_WITH_CHILDREN_FIELDS).order('date_bs_key', { ascending: false })
  let eventsQuery = supabase.from('app_events').select('id,company_id,user_id,event_type,metadata,created_at').order('created_at', { ascending: false }).limit(1000)
  let companyModulesQuery = supabase.from('company_modules').select(COMPANY_MODULE_FIELDS)

  if (scoped) {
    companiesQuery = companiesQuery.in('id', companyIds)
    accountsQuery = accountsQuery.in('company_id', companyIds)
    partiesQuery = partiesQuery.in('company_id', companyIds)
    itemsQuery = itemsQuery.in('company_id', companyIds)
    vouchersQuery = vouchersQuery.in('company_id', companyIds)
    eventsQuery = eventsQuery.in('company_id', companyIds)
    companyModulesQuery = companyModulesQuery.in('company_id', companyIds)
  }

  const [companiesRes, accountsRes, partiesRes, itemsRes, vouchersRes, eventsRes, modulesRes, companyModulesRes] = await Promise.all([
    companiesQuery,
    accountsQuery,
    partiesQuery,
    itemsQuery,
    vouchersQuery,
    eventsQuery,
    supabase.from('modules').select(MODULE_FIELDS).order('name'),
    companyModulesQuery,
  ])

  for (const res of [companiesRes, accountsRes, partiesRes, itemsRes, vouchersRes]) {
    if (res.error) throw res.error
  }

  return {
    companies: (companiesRes.data || []) as Company[],
    accounts: (accountsRes.data || []).map(a => ({ ...a, balance: 0 })) as Account[],
    parties: (partiesRes.data || []) as Party[],
    items: (itemsRes.data || []) as Item[],
    vouchers: (vouchersRes.data || []).map(v => normalizeVoucherDates(v) as Voucher),
    events: eventsRes.error ? [] : (eventsRes.data || []),
    modules: modulesRes.error ? [] : (modulesRes.data || []) as AppModule[],
    companyModules: companyModulesRes.error ? [] : (companyModulesRes.data || []) as CompanyModule[],
  }
}

export async function updateDeveloperCompany(id: string, updates: Partial<Company>) {
  const { error } = await supabase.from('companies').update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteDeveloperCompany(id: string) {
  const { error } = await supabase.rpc('delete_developer_company', { target_company: id })
  if (error) throw error
}

export async function clearDeveloperErrorLogs(companyId?: string): Promise<number> {
  const { data, error } = await supabase.rpc('clear_frontend_error_logs', {
    target_company_id: companyId || null,
  })
  if (error) throw error
  return Number(data || 0)
}

export async function fetchModuleCatalogue(): Promise<AppModule[]> {
  const {data,error}=await supabase.from('modules').select(MODULE_FIELDS).order('name'); if(error) throw error; return (data||[]) as AppModule[]
}
export async function fetchCompanyModules(company_id?:string): Promise<CompanyModule[]> {
  let query=supabase.from('company_modules').select(CLIENT_COMPANY_MODULE_FIELDS); if(company_id) query=query.eq('company_id',company_id)
  const {data,error}=await query; if(error) throw error; return (data||[]) as CompanyModule[]
}
export async function upsertCompanyModule(value:Partial<CompanyModule>&{company_id:string;module_id:string}) {
  const {data:old}=await supabase.from('company_modules').select(COMPANY_MODULE_FIELDS).eq('company_id',value.company_id).eq('module_id',value.module_id).maybeSingle()
  const {data:{user}}=await supabase.auth.getUser(); const {data,error}=await supabase.from('company_modules').upsert({...value,enabled_by:user?.id,updated_at:new Date().toISOString()},{onConflict:'company_id,module_id'}).select(COMPANY_MODULE_FIELDS).single(); if(error) throw error
  const changedFields:string[]=[]
  if(!old||old.is_enabled!==data.is_enabled)changedFields.push('is_enabled')
  if(!old||old.status!==data.status)changedFields.push('status')
  if(!old||old.payment_status!==data.payment_status)changedFields.push('payment_status')
  if(!old||old.starts_at!==data.starts_at||old.expires_at!==data.expires_at)changedFields.push('dates')
  if(!old||Number(old.price)!==Number(data.price))changedFields.push('price')
  if(!old||JSON.stringify(old.settings)!==JSON.stringify(data.settings))changedFields.push('settings')
  const snapshot=(entry:CompanyModule|null)=>entry?{is_enabled:entry.is_enabled,status:entry.status,billing_type:entry.billing_type,price:entry.price,payment_status:entry.payment_status,starts_at:entry.starts_at,expires_at:entry.expires_at}:{}
  const action=!old||old.is_enabled!==data.is_enabled?(data.is_enabled?'module_enabled':'module_disabled'):'module_updated'
  await logChequeEvent(value.company_id,action,undefined,undefined,snapshot(old as CompanyModule|null),{...snapshot(data as CompanyModule),changed_fields:changedFields})
  return data as CompanyModule
}
export async function fetchChequePermissions(company_id:string):Promise<ChequePermission[]> {
  const {data,error}=await supabase.from('company_user_permissions').select('permission').eq('company_id',company_id); if(error) throw error; return (data||[]).map(row=>row.permission as ChequePermission)
}
export async function fetchChequeBanks(company_id:string):Promise<ChequeBank[]> { const {data,error}=await supabase.from('cheque_banks').select(CHEQUE_BANK_FIELDS).eq('company_id',company_id).order('bank_name'); if(error) throw error; return (data||[]) as ChequeBank[] }
export async function fetchCheques(company_id:string):Promise<Cheque[]> { const {data,error}=await supabase.from('cheques').select(CHEQUE_FIELDS).eq('company_id',company_id).order('due_date_bs_key'); if(error) throw error; return (data||[]) as Cheque[] }
export async function fetchChequeEvents(company_id:string,cheque_id?:string):Promise<ChequeEvent[]> { let query=supabase.from('cheque_events').select(CHEQUE_EVENT_FIELDS).eq('company_id',company_id).order('created_at',{ascending:false}); if(cheque_id) query=query.eq('cheque_id',cheque_id); const {data,error}=await query; if(error) throw error; return (data||[]) as ChequeEvent[] }
export async function createChequeBank(value:Omit<ChequeBank,'id'|'created_at'|'updated_at'>) { const {data:{user}}=await supabase.auth.getUser(); const {data,error}=await supabase.from('cheque_banks').insert({...value,created_by:user?.id,updated_by:user?.id}).select(CHEQUE_BANK_FIELDS).single(); if(error) throw error; await logChequeEvent(value.company_id,'bank_created',undefined,data.id,{},data); return data as ChequeBank }
export async function updateChequeBank(id:string,company_id:string,updates:Partial<ChequeBank>,old:ChequeBank) { const {data,error}=await supabase.from('cheque_banks').update({...updates,updated_at:new Date().toISOString()}).eq('id',id).eq('company_id',company_id).select(CHEQUE_BANK_FIELDS).single(); if(error) throw error; await logChequeEvent(company_id,updates.is_active===false?'bank_archived':'bank_updated',undefined,id,old,data); return data as ChequeBank }
export async function createCheque(value:Omit<Cheque,'id'|'created_at'|'updated_at'|'status'>) { const {data:{user}}=await supabase.auth.getUser(); const {data,error}=await supabase.from('cheques').insert({...value,status:'pending',created_by:user?.id,updated_by:user?.id}).select(CHEQUE_FIELDS).single(); if(error) throw error; await logChequeEvent(value.company_id,'cheque_created',data.id,undefined,{},data); return data as Cheque }
export async function updateCheque(id:string,company_id:string,updates:Partial<Cheque>,old:Cheque) { const {data,error}=await supabase.from('cheques').update(updates).eq('id',id).eq('company_id',company_id).select(CHEQUE_FIELDS).single(); if(error) throw error; await logChequeEvent(company_id,updates.status?`cheque_${updates.status}`:'cheque_updated',id,undefined,old,data); return data as Cheque }
export async function clearChequeAtomic(params:{cheque_id:string;date:string;date_bs:string;date_bs_key:number;numbering_period:string;invoice_prefix:string;reset_numbering:boolean;period_start_key:number|null;next_period_start_key:number|null;settlement_account_id?:string|null;reason?:string}) { const {data,error}=await supabase.rpc('clear_cheque_atomic',{p_cheque_id:params.cheque_id,p_date_ad:params.date,p_date_bs:params.date_bs,p_date_bs_key:params.date_bs_key,p_numbering_period:params.numbering_period,p_invoice_prefix:params.invoice_prefix,p_reset_numbering:params.reset_numbering,p_period_start_key:params.period_start_key,p_next_period_start_key:params.next_period_start_key,p_settlement_account_id:params.settlement_account_id||null,p_reason:params.reason||null});if(error)throw error;return data as {cheque:Cheque;voucher:Voucher}}
export async function logChequeEvents(company_id:string,events:{action:string;cheque_id?:string;bank_id?:string;old_values?:unknown;new_values?:unknown}[]) { if(!events.length)return; const {data:{user}}=await supabase.auth.getUser(); if(!user)return; const {error}=await supabase.from('cheque_events').insert(events.map(event=>({company_id,action:event.action,cheque_id:event.cheque_id,bank_id:event.bank_id,old_values:auditFieldMarkers(event.old_values),new_values:auditFieldMarkers(event.new_values),actor_id:user.id}))); if(error)throw error }
export async function logChequeEvent(company_id:string,action:string,cheque_id?:string,bank_id?:string,old_values:unknown={},new_values:unknown={}) { await logChequeEvents(company_id,[{action,cheque_id,bank_id,old_values,new_values}]) }

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function fetchAccounts(company_id: string): Promise<Account[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_FIELDS)
    .eq('company_id', company_id)
    .order('name')
  if (error) throw error
  return (data || []).map(a => ({ ...a, balance: 0 }))
}

export async function insertAccounts(accounts: Omit<Account, 'balance' | 'created_at'>[]) {
  const { error } = await supabase
    .from('accounts')
    .upsert(accounts, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

export async function insertAccount(account: Omit<Account, 'balance' | 'created_at'>) {
  const { data, error } = await supabase.from('accounts').insert(account).select(ACCOUNT_FIELDS).single()
  if (error) throw error
  return data
}

export async function upsertAccounts(accounts: Account[]) {
  if (!accounts.length) return
  const rows = accounts.map(account => {
    const { balance: _balance, created_at: _createdAt, ...stored } = account
    return stored
  })
  const { error } = await supabase.from('accounts').upsert(rows, { onConflict: 'id' })
  if (error) throw error
}

export async function updateAccount(id: string, updates: Partial<Account>) {
  const { balance: _balance, ...storedUpdates } = updates
  const { error } = await supabase.from('accounts').update(storedUpdates).eq('id', id)
  if (error) throw error
}

export async function deleteAccount(id: string) {
  const { error } = await supabase.from('accounts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchAccountCategories(company_id: string): Promise<AccountCategory[]> {
  const { data, error } = await supabase.from('account_categories').select(ACCOUNT_CATEGORY_FIELDS).eq('company_id', company_id).order('name')
  if (error) throw error
  return data || []
}

export async function insertAccountCategory(category: Omit<AccountCategory, 'id' | 'created_at'>): Promise<AccountCategory> {
  const { data, error } = await supabase.from('account_categories').upsert(category, { onConflict: 'company_id,name,account_type' }).select(ACCOUNT_CATEGORY_FIELDS).single()
  if (error) throw error
  return data
}

export async function insertAccountCategories(categories: Omit<AccountCategory, 'id' | 'created_at'>[]): Promise<AccountCategory[]> {
  if (!categories.length) return []
  const { data, error } = await supabase.from('account_categories').upsert(categories, { onConflict: 'company_id,name,account_type' }).select(ACCOUNT_CATEGORY_FIELDS)
  if (error) throw error
  return data || []
}

export async function updateAccountCategory(id: string, updates: Partial<AccountCategory>) {
  const { error } = await supabase.from('account_categories').update(updates).eq('id', id)
  if (error) throw error
  if (updates.name) {
    const { error: accountsError } = await supabase.from('accounts').update({ group: updates.name }).eq('category_id', id)
    if (accountsError) throw accountsError
  }
}

export async function deleteAccountCategory(id: string) {
  const { error } = await supabase.from('account_categories').delete().eq('id', id)
  if (error) throw error
}

// ─── Parties ──────────────────────────────────────────────────────────────────

export async function fetchParties(company_id: string): Promise<Party[]> {
  const { data, error } = await supabase
    .from('parties')
    .select(PARTY_FIELDS)
    .eq('company_id', company_id)
    .order('name')
  if (error) throw error
  return data || []
}

export async function insertParty(party: Omit<Party, 'id' | 'created_at' | 'account'>) {
  const { data, error } = await supabase.from('parties').insert(party).select(PARTY_FIELDS).single()
  if (error) throw error
  return data as Party
}

export async function insertParties(parties: Omit<Party, 'id' | 'created_at' | 'account'>[]): Promise<Party[]> {
  if (!parties.length) return []
  const { data, error } = await supabase.from('parties').insert(parties).select(PARTY_FIELDS)
  if (error) throw error
  return (data || []) as Party[]
}

export async function updateParty(id: string, updates: Partial<Party>) {
  const { error } = await supabase.from('parties').update(updates).eq('id', id)
  if (error) throw error
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function fetchItems(company_id: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select(ITEM_FIELDS)
    .eq('company_id', company_id)
    .order('name')
  if (error) throw error
  return data || []
}

export async function insertItem(item: Omit<Item, 'id' | 'created_at' | 'stock_qty' | 'avg_cost' | 'stock_value'>) {
  const { data, error } = await supabase.from('items').insert(item).select(ITEM_FIELDS).single()
  if (error) throw error
  return data as Item
}

export async function updateItem(id: string, updates: Partial<Item>) {
  const { error } = await supabase.from('items').update(updates).eq('id', id)
  if (error) throw error
}

export async function updateItemsByIds(ids: string[], updates: Partial<Item>) {
  if (!ids.length) return
  const { error } = await supabase.from('items').update(updates).in('id', ids)
  if (error) throw error
}

export async function fetchItemCategories(company_id: string): Promise<ItemCategory[]> {
  const { data, error } = await supabase.from('item_categories').select(ITEM_CATEGORY_FIELDS).eq('company_id', company_id).order('name')
  if (error) throw error
  return data || []
}

export async function insertItemCategory(category: Omit<ItemCategory, 'id' | 'created_at'>): Promise<ItemCategory> {
  const { data, error } = await supabase.from('item_categories').upsert(category, { onConflict: 'company_id,name' }).select(ITEM_CATEGORY_FIELDS).single()
  if (error) throw error
  return data
}

export async function updateItemCategory(id: string, updates: Partial<ItemCategory>) {
  const { error } = await supabase.from('item_categories').update(updates).eq('id', id)
  if (error) throw error
}

export async function logMasterChange(company_id: string, record_type: string, record_id: string, action: string, old_values: Record<string, unknown>, new_values: Record<string, unknown>) {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('master_change_logs').insert({
    company_id,
    user_id: user?.id,
    record_type,
    record_id,
    action,
    old_values: auditFieldMarkers(old_values),
    new_values: auditFieldMarkers(new_values),
  })
  if (error) throw error
}

export async function fetchMasterChangeLogs(company_id: string): Promise<MasterChangeLog[]> {
  const { data, error } = await supabase.from('master_change_logs').select(MASTER_CHANGE_FIELDS).eq('company_id', company_id).order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  return data || []
}

// ─── Vouchers ─────────────────────────────────────────────────────────────────

export async function fetchVouchers(company_id: string): Promise<Voucher[]> {
  const settlementRequest = supabase
    .from('voucher_settlements')
    .select(VOUCHER_SETTLEMENT_FIELDS)
    .eq('company_id', company_id)
  const voucherRequest = supabase
    .from('vouchers')
    .select(VOUCHER_WITH_CHILDREN_FIELDS)
    .eq('company_id', company_id)
    .order('date_bs_key', { ascending: false })
    .order('seq', { ascending: false })
  const [
    { data: settlementData, error: settlementError },
    { data, error },
  ] = await Promise.all([settlementRequest, voucherRequest])
  const settlements = settlementError && /does not exist|schema cache/i.test(settlementError.message)
    ? []
    : settlementError
      ? (() => { throw settlementError })()
      : (settlementData || []) as VoucherSettlement[]
  const byVoucher = new Map<string, VoucherSettlement[]>()
  for (const settlement of settlements) {
    const rows = byVoucher.get(settlement.settlement_voucher_id) || []
    rows.push(settlement)
    byVoucher.set(settlement.settlement_voucher_id, rows)
  }
  const attachSettlements = (voucher: Voucher) => ({ ...voucher, settlements: byVoucher.get(voucher.id) || [] })
  if (!error) {
    return (data || [])
      .map(v => attachSettlements(normalizeVoucherDates(v) as Voucher))
      .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq)
  }

  const { data: legacyData, error: legacyError } = await supabase
    .from('vouchers')
    .select(VOUCHER_WITH_CHILDREN_FIELDS)
    .eq('company_id', company_id)
    .order('date', { ascending: false })
    .order('seq', { ascending: false })
  if (legacyError) throw legacyError
  return (legacyData || [])
    .map(v => attachSettlements(normalizeVoucherDates(v) as Voucher))
    .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq)
}

export async function createPartyWithLedgerAtomic(params: {
  company_id: string
  account_id: string
  name: string
  type: 'customer' | 'supplier'
  category_id: string
  opening_balance: number
  phone?: string
  pan_vat?: string
  address?: string
  default_credit_days: number
}): Promise<Party> {
  const { data, error } = await supabase.rpc('create_party_with_ledger_atomic', {
    p_company_id: params.company_id,
    p_account_id: params.account_id,
    p_name: params.name,
    p_party_type: params.type,
    p_category_id: params.category_id,
    p_opening_balance: params.opening_balance,
    p_phone: params.phone || null,
    p_pan_vat: params.pan_vat || null,
    p_address: params.address || null,
    p_credit_days: params.default_credit_days,
  })
  if (error) throw error
  return data as Party
}

export interface VoucherPageCursor {
  date_bs_key: number
  seq: number
  id: string
}

export interface VoucherPage {
  records: Voucher[]
  next_cursor: VoucherPageCursor | null
  has_more: boolean
}

export interface VoucherPageQuery {
  limit?: number
  cursor?: VoucherPageCursor | null
  status?: Voucher['status']
  type?: Voucher['type']
  from_date_bs_key?: number
  to_date_bs_key?: number
  invoice_number?: string
}

/** Stable server-side page used by large voucher lists. Reports can request
 * their own date range instead of requiring the entire company history. */
export async function fetchVoucherPage(company_id: string, options: VoucherPageQuery = {}): Promise<VoucherPage> {
  const limit = Math.max(1, Math.min(options.limit || 100, 250))
  let query = supabase.from('vouchers').select(VOUCHER_WITH_CHILDREN_FIELDS)
    .eq('company_id', company_id)
    .order('date_bs_key', { ascending: false })
    .order('seq', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (options.status) query = query.eq('status', options.status)
  if (options.type) query = query.eq('type', options.type)
  if (options.from_date_bs_key != null) query = query.gte('date_bs_key', options.from_date_bs_key)
  if (options.to_date_bs_key != null) query = query.lte('date_bs_key', options.to_date_bs_key)
  if (options.invoice_number?.trim()) query = query.ilike('invoice_no', `%${options.invoice_number.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`)
  if (options.cursor) {
    const { date_bs_key, seq, id } = options.cursor
    query = query.or(`date_bs_key.lt.${date_bs_key},and(date_bs_key.eq.${date_bs_key},seq.lt.${seq}),and(date_bs_key.eq.${date_bs_key},seq.eq.${seq},id.lt.${id})`)
  }
  const { data, error } = await query
  if (error) throw error
  const rows = (data || []).map(row => normalizeVoucherDates(row) as Voucher)
  const hasMore = rows.length > limit
  const records = hasMore ? rows.slice(0, limit) : rows
  const tail = records.at(-1)
  return {
    records,
    has_more: hasMore,
    next_cursor: tail ? { date_bs_key: tail.date_bs_key, seq: tail.seq, id: tail.id } : null,
  }
}

interface InsertVoucherPayload {
  voucher: Omit<Voucher, 'id' | 'seq' | 'created_at' | 'lines' | 'stock_lines' | 'invoice_items' | 'settlements' | 'party'>
  lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]
  stock_lines?: Omit<StockLine, 'id' | 'voucher_id'>[]
  invoice_items?: InvoiceItem[]
  settlements?: VoucherSettlementInput[]
  numbering: AtomicVoucherNumbering
  audit?: AtomicVoucherAudit
  trace?: WritePerformanceTrace
}

interface UpdateVoucherPayload {
  id: string
  voucher: Partial<Omit<Voucher, 'id' | 'created_at' | 'lines' | 'stock_lines' | 'invoice_items' | 'settlements' | 'party'>>
  lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]
  stock_lines?: Omit<StockLine, 'id' | 'voucher_id'>[]
  invoice_items?: InvoiceItem[]
  settlements?: VoucherSettlementInput[]
  audit?: AtomicVoucherAudit
  trace?: WritePerformanceTrace
}

export type VoucherSettlementInput = Pick<VoucherSettlement, 'invoice_voucher_id' | 'party_account_id' | 'amount'>

export interface AtomicVoucherNumbering {
  prefix: string
  resetByFiscalYear: boolean
  periodStartKey: number | null
  nextPeriodStartKey: number | null
}

export interface AtomicVoucherAudit {
  eventType?: string
  metadata?: Record<string, unknown>
}

const voucherIdempotencyKeys = new Map<string, string>()

function voucherRequestFingerprint(
  voucher: InsertVoucherPayload['voucher'],
  lines: UpdateVoucherPayload['lines'],
  stockLines?: UpdateVoucherPayload['stock_lines'],
  invoiceItems?: UpdateVoucherPayload['invoice_items'],
  settlements?: UpdateVoucherPayload['settlements'],
) {
  const header = [voucher.company_id, voucher.type, voucher.date_bs, voucher.invoice_no, voucher.supplier_invoice_no, voucher.party_account_id, voucher.settlement_account_id, voucher.total, voucher.credit_days, voucher.discount, voucher.vat_rate, voucher.narration, voucher.status].join('|')
  const ledger = lines.map(line => `${line.account_id}:${line.debit}:${line.credit}`).join(',')
  const stock = (stockLines || []).map(line => `${line.item_id}:${line.direction}:${line.qty}:${line.rate}:${line.stock_condition || 'saleable'}`).join(',')
  const items = (invoiceItems || []).map(item => `${item.item_id}:${item.qty}:${item.rate}:${item.source_invoice_item_id || ''}`).join(',')
  const allocations = (settlements || []).map(row => `${row.invoice_voucher_id}:${row.party_account_id}:${row.amount}`).join(',')
  return `${header}|${ledger}|${stock}|${items}|${allocations}`
}

function atomicVoucherRequest(
  voucher: InsertVoucherPayload['voucher'] | UpdateVoucherPayload['voucher'],
  lines: UpdateVoucherPayload['lines'],
  stockLines: UpdateVoucherPayload['stock_lines'],
  invoiceItems: UpdateVoucherPayload['invoice_items'],
  settlements: UpdateVoucherPayload['settlements'],
  id: string | null,
  numbering?: AtomicVoucherNumbering,
  audit?: AtomicVoucherAudit,
  idempotencyKey?: string,
  traceId?: string,
) {
  return supabase.rpc('save_voucher_with_performance_timing_atomic', {
    p_voucher: idempotencyKey ? { ...voucher, idempotency_key: idempotencyKey } : voucher,
    p_lines: lines,
    p_stock_lines: stockLines || [],
    p_invoice_items: invoiceItems || [],
    p_settlements: settlements || [],
    p_voucher_id: id,
    p_invoice_prefix: numbering?.prefix || null,
    p_reset_numbering: numbering?.resetByFiscalYear || false,
    p_period_start_key: numbering?.periodStartKey ?? null,
    p_next_period_start_key: numbering?.nextPeriodStartKey ?? null,
    p_audit_event_type: audit?.eventType || null,
    p_audit_metadata: traceId ? { ...(audit?.metadata || {}), performance_trace_id: traceId } : audit?.metadata || {},
    p_manual_invoice_no: voucher.invoice_no || null,
    p_supplier_invoice_no: voucher.supplier_invoice_no || null,
  })
}

function isTransientRequestFailure(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message || '') : String(error || '')
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  return /failed to fetch|network|timeout|timed out|connection|gateway|temporar/i.test(message) || /^(502|503|504|PGRST000)$/.test(code)
}

async function runIdempotentVoucherRequestWithRetry<T extends { error: unknown }>(request: () => PromiseLike<T>): Promise<T> {
  try {
    const first = await request()
    if (!first.error || !isTransientRequestFailure(first.error)) return first
  } catch (error) {
    if (!isTransientRequestFailure(error)) throw error
  }
  await new Promise(resolve => globalThis.setTimeout(resolve, 150))
  return await request()
}

export async function insertVoucher({ voucher, lines, stock_lines, invoice_items, settlements, numbering, audit, trace }: InsertVoucherPayload): Promise<Voucher> {
  // Keep one key for every attempt/retry of this request. The database returns
  // the original result if the request reached it but the response was lost.
  const fingerprint = voucherRequestFingerprint(voucher, lines, stock_lines, invoice_items, settlements)
  const idempotencyKey = voucherIdempotencyKeys.get(fingerprint) || crypto.randomUUID()
  voucherIdempotencyKeys.set(fingerprint, idempotencyKey)
  const request = () => runIdempotentVoucherRequestWithRetry(() => atomicVoucherRequest(voucher, lines, stock_lines, invoice_items, settlements, null, numbering, audit, idempotencyKey, trace?.traceId))
  const requestStartedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
  const { data, error } = trace
    ? await trace.measure('atomic_voucher_post', request, { category: 'network_database', query: true, dbFunction: 'rpc:save_voucher_with_performance_timing_atomic' })
    : await request()
  if (error) {
      globalThis.setTimeout(() => {
      if (voucherIdempotencyKeys.get(fingerprint) === idempotencyKey) voucherIdempotencyKeys.delete(fingerprint)
    }, 5 * 60 * 1000)
    throw error
  }
  if (trace && data && typeof data === 'object') {
    const postgresMs = Number((data as Record<string, unknown>)._performance && ((data as Record<string, unknown>)._performance as Record<string, unknown>).postgres_ms)
    const requestEndedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    if (Number.isFinite(postgresMs)) {
      trace.recordStage('postgres_execution', postgresMs, { category: 'network_database', dbFunction: 'rpc:save_voucher_with_performance_timing_atomic' })
      trace.recordStage('network_gateway_transfer', Math.max(0, requestEndedAt - requestStartedAt - postgresMs), { category: 'network_database' })
    }
  }
  voucherIdempotencyKeys.delete(fingerprint)
  return normalizeVoucherDates(data as Voucher) as Voucher
}

export async function updateVoucher({ id, voucher, lines, stock_lines, invoice_items, settlements, audit, trace }: UpdateVoucherPayload): Promise<Voucher> {
  const request = () => atomicVoucherRequest(voucher, lines, stock_lines, invoice_items, settlements, id, undefined, audit, undefined, trace?.traceId)
  const requestStartedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
  const { data, error } = trace
    ? await trace.measure('atomic_voucher_replace', request, { category: 'network_database', query: true, dbFunction: 'rpc:save_voucher_with_performance_timing_atomic' })
    : await request()
  if (error) throw error
  if (trace && data && typeof data === 'object') {
    const postgresMs = Number((data as Record<string, unknown>)._performance && ((data as Record<string, unknown>)._performance as Record<string, unknown>).postgres_ms)
    const requestEndedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    if (Number.isFinite(postgresMs)) {
      trace.recordStage('postgres_execution', postgresMs, { category: 'network_database', dbFunction: 'rpc:save_voucher_with_performance_timing_atomic' })
      trace.recordStage('network_gateway_transfer', Math.max(0, requestEndedAt - requestStartedAt - postgresMs), { category: 'network_database' })
    }
  }
  return normalizeVoucherDates(data as Voucher) as Voucher
}

export async function insertDraftVoucher(
  voucher: Omit<Voucher, 'id' | 'seq' | 'created_at' | 'updated_at' | 'lines' | 'stock_lines' | 'invoice_items' | 'settlements' | 'party'>,
  draft_no: string,
  seq: number,
): Promise<Voucher> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('vouchers')
    .insert({
      ...voucher,
      invoice_no: null,
      draft_no,
      seq,
      status: 'Draft',
      created_by: user?.id,
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    })
    .select(VOUCHER_WITH_CHILDREN_FIELDS)
    .single()
  if (error) throw error
  return normalizeVoucherDates(data as Voucher) as Voucher
}

export async function updateDraftVoucher(
  id: string,
  voucher: Partial<Omit<Voucher, 'id' | 'created_at' | 'updated_at' | 'lines' | 'stock_lines' | 'invoice_items' | 'settlements' | 'party'>>,
): Promise<Voucher> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('vouchers')
    .update({ ...voucher, status: 'Draft', updated_by: user?.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'Draft')
    .select(VOUCHER_WITH_CHILDREN_FIELDS)
    .single()
  if (error) throw error
  return normalizeVoucherDates(data as Voucher) as Voucher
}

export async function cancelVoucher(id: string, trace?: WritePerformanceTrace) {
  const request = () => supabase.from('vouchers').update({ cancelled: true }).eq('id', id)
  const { error } = trace
    ? await trace.measure('voucher_cancel_update', request, { category: 'network_database', query: true, dbFunction: 'postgrest:vouchers.update' })
    : await request()
  if (error) throw error
}

export async function deleteVoucher(id: string) {
  const { error } = await supabase.from('vouchers').delete().eq('id', id).eq('status', 'Draft')
  if (error) throw error
}
