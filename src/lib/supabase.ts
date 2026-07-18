import { createClient } from '@supabase/supabase-js'
import type { Account, AccountCategory, Party, Item, ItemCategory, InvoiceItem, MasterChangeLog, Voucher, VoucherLine, StockLine, Company, VoucherSettlement, VoucherType, AppModule, CompanyModule, ChequeBank, Cheque, ChequeEvent, ChequePermission } from '@/types'
import { adToBs, DEFAULT_FISCAL_YEAR_START_AD, makeBsKey, normalizeVoucherDates } from '@/lib/nepaliDate'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export const supabaseProjectHost = (() => {
  if (!supabaseUrl) return ''
  try {
    return new URL(supabaseUrl).host
  } catch {
    return supabaseUrl
  }
})()

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const getSession = () => supabase.auth.getSession()
export const signIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password })

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
      emailRedirectTo: `${window.location.origin}/login`,
      data: {
        company_name: company.name,
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
  await supabase.from('app_events').insert({ event_type, company_id, user_id: user.id, metadata })
}

export function logAppError(company_id: string | undefined | null, error: unknown, context: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  logAppEvent('frontend_error', company_id, {
    message,
    stack,
    path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    ...context,
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
      error: error.message,
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
  if (authError) messages.push(authError.message)

  const { error: dbError } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
  status.database = dbError ? 'error' : 'ok'
  if (dbError) messages.push(`companies: ${dbError.message}`)

  const { error: eventError } = await supabase
    .from('app_events')
    .select('id', { count: 'exact', head: true })
  status.event_log = eventError ? 'error' : 'ok'
  if (eventError) messages.push(`app_events: ${eventError.message}`)

  return status
}

// ─── Company ──────────────────────────────────────────────────────────────────

const companyInitializationPromises = new Map<string, Promise<Company>>()

async function getOrCreateCompanyInternal(user_id: string): Promise<Company> {
  const { data: userData } = await supabase.auth.getUser()
  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: true })
  if (companyError) throw companyError

  const metadata = userData.user?.user_metadata ?? {}
  const metadataCompany = {
    owner_email: userData.user?.email,
    name: String(metadata.company_name || '').trim(),
    address: String(metadata.company_address || '').trim(),
    pan_vat: String(metadata.company_pan_vat || '').trim(),
    phone: String(metadata.company_phone || '').trim(),
    vat_enabled: metadata.company_vat_enabled !== false,
  }

  const existingCompanies = companies || []
  if (existingCompanies.length) {
    const scoreCompany = (company: Company) => {
      let score = 0
      if (company.name && company.name !== 'My Trading Co.') score += 5
      if (company.address) score += 2
      if (company.pan_vat) score += 2
      if (company.phone) score += 2
      if (company.owner_email) score += 1
      return score
    }

    const selected = [...existingCompanies].sort((a, b) => scoreCompany(b) - scoreCompany(a))[0]
    const updates: Partial<Company> = {}

    if (!selected.fiscal_year_start || selected.fiscal_year_start === '2026-04-01') {
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
      return { ...selected, ...updates }
    }
    return selected
  }

  const company = {
    user_id,
    owner_email: metadataCompany.owner_email,
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
    reset_numbering_fiscal_year: false,
    print_format: 'A5',
    fiscal_year_start: DEFAULT_FISCAL_YEAR_START_AD,
  }

  const { data: newCompany, error } = await supabase
    .from('companies')
    .insert(company)
    .select()
    .single()
  if (error) {
    // A second browser context may have created the company after our initial
    // SELECT. The database singleton constraint makes that race harmless.
    if (error.code === '23505') {
      const { data: concurrentCompany, error: concurrentError } = await supabase
        .from('companies')
        .select('*')
        .eq('user_id', user_id)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()
      if (!concurrentError && concurrentCompany) return concurrentCompany
    }
    throw error
  }
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
  const nextUpdates: Record<string, unknown> = { ...updates }
  const skippedColumns: string[] = []

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { error } = await supabase.from('companies').update(nextUpdates).eq('id', id)
    if (!error) {
      if (skippedColumns.length) {
        console.warn(`Skipped missing companies columns while saving: ${skippedColumns.join(', ')}`)
      }
      return
    }

    const message = error.message || ''
    const missingColumn =
      /Could not find the '([^']+)' column/.exec(message)?.[1] ||
      /column companies\.([a-zA-Z0-9_]+) does not exist/.exec(message)?.[1]

    if (!missingColumn || !(missingColumn in nextUpdates)) throw error

    delete nextUpdates[missingColumn]
    skippedColumns.push(missingColumn)
  }

  throw new Error('Could not save company details because too many Supabase columns are missing.')
}

export async function fetchDeveloperDashboardData() {
  const [companiesRes, accountsRes, partiesRes, itemsRes, vouchersRes, eventsRes, modulesRes, companyModulesRes] = await Promise.all([
    supabase.from('companies').select('*').order('created_at', { ascending: false }),
    supabase.from('accounts').select('*'),
    supabase.from('parties').select('*'),
    supabase.from('items').select('*'),
    supabase.from('vouchers').select(`
      *,
      lines:voucher_lines(*),
      stock_lines:stock_lines(*),
      invoice_items:invoice_items(*)
    `).order('date_bs_key', { ascending: false }),
    supabase.from('app_events').select('*').order('created_at', { ascending: false }).limit(1000),
    supabase.from('modules').select('*').order('name'),
    supabase.from('company_modules').select('*,module:modules(*)'),
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
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}

export async function fetchModuleCatalogue(): Promise<AppModule[]> {
  const {data,error}=await supabase.from('modules').select('*').order('name'); if(error) throw error; return (data||[]) as AppModule[]
}
export async function fetchCompanyModules(company_id?:string): Promise<CompanyModule[]> {
  let query=supabase.from('company_modules').select('*,module:modules(*)'); if(company_id) query=query.eq('company_id',company_id)
  const {data,error}=await query; if(error) throw error; return (data||[]) as CompanyModule[]
}
export async function upsertCompanyModule(value:Partial<CompanyModule>&{company_id:string;module_id:string}) {
  const {data:old}=await supabase.from('company_modules').select('*').eq('company_id',value.company_id).eq('module_id',value.module_id).maybeSingle()
  const {data:{user}}=await supabase.auth.getUser(); const {data,error}=await supabase.from('company_modules').upsert({...value,enabled_by:user?.id,updated_at:new Date().toISOString()},{onConflict:'company_id,module_id'}).select('*,module:modules(*)').single(); if(error) throw error
  const actions:string[]=[]
  if(!old||old.is_enabled!==data.is_enabled)actions.push(data.is_enabled?'module_enabled':'module_disabled')
  if(old&&old.status!==data.status)actions.push('module_status_changed')
  if(old&&old.payment_status!==data.payment_status)actions.push('module_payment_status_changed')
  if(old&&(old.starts_at!==data.starts_at||old.expires_at!==data.expires_at))actions.push('module_dates_changed')
  if(old&&Number(old.price)!==Number(data.price))actions.push('module_price_changed')
  if(old&&JSON.stringify(old.settings)!==JSON.stringify(data.settings))actions.push('module_settings_changed')
  for(const action of actions.length?actions:['module_updated'])await logChequeEvent(value.company_id,action,undefined,undefined,old||{},data)
  return data as CompanyModule
}
export async function fetchChequePermissions(company_id:string):Promise<ChequePermission[]> {
  const {data,error}=await supabase.from('company_user_permissions').select('permission').eq('company_id',company_id); if(error) throw error; return (data||[]).map(row=>row.permission as ChequePermission)
}
export async function fetchChequeBanks(company_id:string):Promise<ChequeBank[]> { const {data,error}=await supabase.from('cheque_banks').select('*').eq('company_id',company_id).order('bank_name'); if(error) throw error; return (data||[]) as ChequeBank[] }
export async function fetchCheques(company_id:string):Promise<Cheque[]> { const {data,error}=await supabase.from('cheques').select('*').eq('company_id',company_id).order('due_date_bs_key'); if(error) throw error; return (data||[]) as Cheque[] }
export async function fetchChequeEvents(company_id:string,cheque_id?:string):Promise<ChequeEvent[]> { let query=supabase.from('cheque_events').select('*').eq('company_id',company_id).order('created_at',{ascending:false}); if(cheque_id) query=query.eq('cheque_id',cheque_id); const {data,error}=await query; if(error) throw error; return (data||[]) as ChequeEvent[] }
export async function createChequeBank(value:Omit<ChequeBank,'id'|'created_at'|'updated_at'>) { const {data:{user}}=await supabase.auth.getUser(); const {data,error}=await supabase.from('cheque_banks').insert({...value,created_by:user?.id,updated_by:user?.id}).select().single(); if(error) throw error; await logChequeEvent(value.company_id,'bank_created',undefined,data.id,{},data); return data as ChequeBank }
export async function updateChequeBank(id:string,company_id:string,updates:Partial<ChequeBank>,old:ChequeBank) { const {data,error}=await supabase.from('cheque_banks').update({...updates,updated_at:new Date().toISOString()}).eq('id',id).eq('company_id',company_id).select().single(); if(error) throw error; await logChequeEvent(company_id,updates.is_active===false?'bank_archived':'bank_updated',undefined,id,old,data); return data as ChequeBank }
export async function createCheque(value:Omit<Cheque,'id'|'created_at'|'updated_at'|'status'>) { const {data:{user}}=await supabase.auth.getUser(); const {data,error}=await supabase.from('cheques').insert({...value,status:'pending',created_by:user?.id,updated_by:user?.id}).select().single(); if(error) throw error; await logChequeEvent(value.company_id,'cheque_created',data.id,undefined,{},data); return data as Cheque }
export async function updateCheque(id:string,company_id:string,updates:Partial<Cheque>,old:Cheque) { const {data,error}=await supabase.from('cheques').update(updates).eq('id',id).eq('company_id',company_id).select().single(); if(error) throw error; await logChequeEvent(company_id,updates.status?`cheque_${updates.status}`:'cheque_updated',id,undefined,old,data); return data as Cheque }
export async function logChequeEvent(company_id:string,action:string,cheque_id?:string,bank_id?:string,old_values:unknown={},new_values:unknown={}) { const {data:{user}}=await supabase.auth.getUser(); if(!user) return; const {error}=await supabase.from('cheque_events').insert({company_id,action,cheque_id,bank_id,old_values,new_values,actor_id:user.id}); if(error) throw error }

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function fetchAccounts(company_id: string): Promise<Account[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
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
  const { data, error } = await supabase.from('accounts').insert(account).select().single()
  if (error) throw error
  return data
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
  const { data, error } = await supabase.from('account_categories').select('*').eq('company_id', company_id).order('name')
  if (error) throw error
  return data || []
}

export async function insertAccountCategory(category: Omit<AccountCategory, 'id' | 'created_at'>): Promise<AccountCategory> {
  const { data, error } = await supabase.from('account_categories').upsert(category, { onConflict: 'company_id,name,account_type' }).select().single()
  if (error) throw error
  return data
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
    .select('*')
    .eq('company_id', company_id)
    .order('name')
  if (error) throw error
  return data || []
}

export async function insertParty(party: Omit<Party, 'id' | 'created_at' | 'account'>) {
  const { data, error } = await supabase.from('parties').insert(party).select().single()
  if (error) throw error
  return data as Party
}

export async function updateParty(id: string, updates: Partial<Party>) {
  const { error } = await supabase.from('parties').update(updates).eq('id', id)
  if (error) throw error
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function fetchItems(company_id: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('company_id', company_id)
    .order('name')
  if (error) throw error
  return data || []
}

export async function insertItem(item: Omit<Item, 'id' | 'created_at' | 'stock_qty' | 'avg_cost' | 'stock_value'>) {
  const { data, error } = await supabase.from('items').insert(item).select().single()
  if (error) throw error
  return data as Item
}

export async function updateItem(id: string, updates: Partial<Item>) {
  const { error } = await supabase.from('items').update(updates).eq('id', id)
  if (error) throw error
}

export async function fetchItemCategories(company_id: string): Promise<ItemCategory[]> {
  const { data, error } = await supabase.from('item_categories').select('*').eq('company_id', company_id).order('name')
  if (error) throw error
  return data || []
}

export async function insertItemCategory(category: Omit<ItemCategory, 'id' | 'created_at'>): Promise<ItemCategory> {
  const { data, error } = await supabase.from('item_categories').upsert(category, { onConflict: 'company_id,name' }).select().single()
  if (error) throw error
  return data
}

export async function updateItemCategory(id: string, updates: Partial<ItemCategory>) {
  const { error } = await supabase.from('item_categories').update(updates).eq('id', id)
  if (error) throw error
}

export async function logMasterChange(company_id: string, record_type: string, record_id: string, action: string, old_values: Record<string, unknown>, new_values: Record<string, unknown>) {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('master_change_logs').insert({ company_id, user_id: user?.id, record_type, record_id, action, old_values, new_values })
  if (error) throw error
}

export async function fetchMasterChangeLogs(company_id: string): Promise<MasterChangeLog[]> {
  const { data, error } = await supabase.from('master_change_logs').select('*').eq('company_id', company_id).order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  return data || []
}

// ─── Vouchers ─────────────────────────────────────────────────────────────────

export async function fetchVouchers(company_id: string): Promise<Voucher[]> {
  const { data: settlementData, error: settlementError } = await supabase
    .from('voucher_settlements')
    .select('*')
    .eq('company_id', company_id)
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
  const query = supabase
    .from('vouchers')
    .select(`
      *,
      lines:voucher_lines(*),
      stock_lines:stock_lines(*),
      invoice_items:invoice_items(*)
    `)
    .eq('company_id', company_id)

  const { data, error } = await query
    .order('date_bs_key', { ascending: false })
    .order('seq', { ascending: false })

  if (!error) {
    return (data || [])
      .map(v => attachSettlements(normalizeVoucherDates(v) as Voucher))
      .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq)
  }

  const { data: legacyData, error: legacyError } = await supabase
    .from('vouchers')
    .select(`
      *,
      lines:voucher_lines(*),
      stock_lines:stock_lines(*),
      invoice_items:invoice_items(*)
    `)
    .eq('company_id', company_id)
    .order('date', { ascending: false })
    .order('seq', { ascending: false })
  if (legacyError) throw legacyError
  return (legacyData || [])
    .map(v => attachSettlements(normalizeVoucherDates(v) as Voucher))
    .sort((a, b) => b.date_bs_key - a.date_bs_key || b.seq - a.seq)
}

export async function getNextSeq(company_id: string): Promise<number> {
  const { data } = await supabase
    .from('vouchers')
    .select('seq')
    .eq('company_id', company_id)
    .order('seq', { ascending: false })
    .limit(1)
    .single()
  return (data?.seq || 0) + 1
}

export async function getNextVoucherNo(
  company_id: string,
  type: VoucherType,
  prefix: string,
  resetByFiscalYear = false,
  fiscalYearStart?: string,
  voucherDateBs?: string,
): Promise<string> {
  let query = supabase
    .from('vouchers')
    .select('invoice_no')
    .eq('company_id', company_id)
    .eq('type', type)

  if (resetByFiscalYear && fiscalYearStart && voucherDateBs) {
    const fiscalMonthDay = adToBs(fiscalYearStart).slice(5)
    const voucherYear = Number(voucherDateBs.slice(0, 4))
    const fiscalYear = voucherDateBs.slice(5) >= fiscalMonthDay ? voucherYear : voucherYear - 1
    const periodStart = makeBsKey(`${fiscalYear}-${fiscalMonthDay}`)
    const nextPeriodStart = makeBsKey(`${fiscalYear + 1}-${fiscalMonthDay}`)
    query = query.gte('date_bs_key', periodStart).lt('date_bs_key', nextPeriodStart)
  }

  const { data, error } = await query
  if (error) throw error

  const highestNumber = (data || []).reduce((highest, voucher) => {
    const match = String(voucher.invoice_no || '').match(/(\d+)$/)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  return `${prefix}${String(highestNumber + 1).padStart(4, '0')}`
}

interface InsertVoucherPayload {
  voucher: Omit<Voucher, 'id' | 'created_at' | 'lines' | 'stock_lines' | 'invoice_items' | 'settlements' | 'party'>
  lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]
  stock_lines?: Omit<StockLine, 'id' | 'voucher_id'>[]
  invoice_items?: InvoiceItem[]
  settlements?: VoucherSettlementInput[]
}

interface UpdateVoucherPayload {
  id: string
  voucher: Partial<Omit<Voucher, 'id' | 'created_at' | 'lines' | 'stock_lines' | 'invoice_items' | 'settlements' | 'party'>>
  lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]
  stock_lines?: Omit<StockLine, 'id' | 'voucher_id'>[]
  invoice_items?: InvoiceItem[]
  settlements?: VoucherSettlementInput[]
}

export type VoucherSettlementInput = Pick<VoucherSettlement, 'invoice_voucher_id' | 'party_account_id' | 'amount'>

function invoiceItemInsertRow(item: InvoiceItem, voucherId: string) {
  return {
    voucher_id: voucherId,
    item_id: item.item_id,
    qty: item.qty,
    rate: item.rate,
    source_invoice_item_id: item.source_invoice_item_id,
    item_name: item.item_name,
    unit: item.unit,
    entry_unit: item.entry_unit,
    conversion_factor: item.conversion_factor,
    base_qty: item.base_qty,
    discount_amount: item.discount_amount,
    taxable_amount: item.taxable_amount,
    vat_amount: item.vat_amount,
    cost_rate: item.cost_rate,
  }
}

export async function replaceVoucherSettlements(companyId: string, settlementVoucherId: string, rows: VoucherSettlementInput[]): Promise<VoucherSettlement[]> {
  const { error: deleteError } = await supabase.from('voucher_settlements').delete().eq('settlement_voucher_id', settlementVoucherId)
  if (deleteError) throw deleteError
  if (!rows.length) return []
  const { data, error } = await supabase.from('voucher_settlements').insert(rows.map(row => ({
    company_id: companyId,
    settlement_voucher_id: settlementVoucherId,
    invoice_voucher_id: row.invoice_voucher_id,
    party_account_id: row.party_account_id,
    amount: row.amount,
  }))).select()
  if (error) throw error
  return (data || []) as VoucherSettlement[]
}

export async function insertVoucher({ voucher, lines, stock_lines, invoice_items, settlements }: InsertVoucherPayload): Promise<Voucher> {
  const { data: v, error: ve } = await supabase
    .from('vouchers')
    .insert(voucher)
    .select()
    .single()
  if (ve) throw ve

  try {
  let newLines: VoucherLine[] = []
  if (lines.length) {
    const { data, error: le } = await supabase
      .from('voucher_lines')
      .insert(lines.map(l => ({ ...l, voucher_id: v.id })))
      .select()
    if (le) throw le
    newLines = data || []
  }

  let newStockLines: StockLine[] = []
  if (stock_lines?.length) {
    const { data, error: se } = await supabase
      .from('stock_lines')
      .insert(stock_lines.map(s => ({ ...s, voucher_id: v.id })))
      .select()
    if (se) throw se
    newStockLines = data || []
  }

  let newInvoiceItems: InvoiceItem[] = []
  if (invoice_items?.length) {
    const { data, error: ie } = await supabase
      .from('invoice_items')
      .insert(invoice_items.map(item => invoiceItemInsertRow(item, v.id)))
      .select()
    if (ie) throw ie
    newInvoiceItems = data || []
  }

  const newSettlements = settlements?.length
    ? await replaceVoucherSettlements(v.company_id, v.id, settlements)
    : []

  return {
    ...normalizeVoucherDates(v),
    lines: newLines,
    stock_lines: newStockLines,
    invoice_items: newInvoiceItems,
    settlements: newSettlements,
  } as Voucher
  } catch (error) {
    // Child rows cascade from the voucher. Best-effort cleanup prevents a
    // partially posted header when a later request fails.
    const { error: cleanupError } = await supabase.from('vouchers').delete().eq('id', v.id)
    if (cleanupError) console.error('Failed to clean up partial voucher', cleanupError)
    throw error
  }
}

export async function updateVoucher({ id, voucher, lines, stock_lines, invoice_items, settlements }: UpdateVoucherPayload): Promise<Voucher> {
  const { data: v, error: ve } = await supabase
    .from('vouchers')
    .update(voucher)
    .eq('id', id)
    .select()
    .single()
  if (ve) throw ve

  const childTables = ['voucher_lines', 'stock_lines', 'invoice_items'] as const
  for (const table of childTables) {
    const { error } = await supabase.from(table).delete().eq('voucher_id', id)
    if (error) throw error
  }
  const { error: settlementDeleteError } = await supabase.from('voucher_settlements').delete().eq('settlement_voucher_id', id)
  if (settlementDeleteError) throw settlementDeleteError

  let newLines: VoucherLine[] = []
  if (lines.length) {
    const { data, error: le } = await supabase
      .from('voucher_lines')
      .insert(lines.map(l => ({ ...l, voucher_id: id })))
      .select()
    if (le) throw le
    newLines = data || []
  }

  let newStockLines: StockLine[] = []
  if (stock_lines?.length) {
    const { data, error: se } = await supabase
      .from('stock_lines')
      .insert(stock_lines.map(s => ({ ...s, voucher_id: id })))
      .select()
    if (se) throw se
    newStockLines = data || []
  }

  let newInvoiceItems: InvoiceItem[] = []
  if (invoice_items?.length) {
    const { data, error: ie } = await supabase
      .from('invoice_items')
      .insert(invoice_items.map(item => invoiceItemInsertRow(item, id)))
      .select()
    if (ie) throw ie
    newInvoiceItems = data || []
  }

  const newSettlements = settlements?.length
    ? await replaceVoucherSettlements(v.company_id, id, settlements)
    : []

  return {
    ...normalizeVoucherDates(v),
    lines: newLines,
    stock_lines: newStockLines,
    invoice_items: newInvoiceItems,
    settlements: newSettlements,
  } as Voucher
}

export async function cancelVoucher(id: string) {
  const { error } = await supabase
    .from('vouchers')
    .update({ cancelled: true })
    .eq('id', id)
  if (error) throw error
}
