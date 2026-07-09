import { createClient } from '@supabase/supabase-js'
import type { Account, Party, Item, Voucher, VoucherLine, StockLine, Company } from '@/types'
import { DEFAULT_FISCAL_YEAR_START_AD, normalizeVoucherDates } from '@/lib/nepaliDate'

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

export async function getOrCreateCompany(user_id: string): Promise<Company> {
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
    reset_numbering_fiscal_year: false,
    print_format: 'A5',
    fiscal_year_start: DEFAULT_FISCAL_YEAR_START_AD,
  }

  const { data: newCompany, error } = await supabase
    .from('companies')
    .insert(company)
    .select()
    .single()
  if (error) throw error
  return newCompany
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
  const [companiesRes, accountsRes, partiesRes, itemsRes, vouchersRes, eventsRes] = await Promise.all([
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
  const { error } = await supabase.from('accounts').insert(accounts)
  if (error) throw error
}

export async function insertAccount(account: Omit<Account, 'balance' | 'created_at'>) {
  const { data, error } = await supabase.from('accounts').insert(account).select().single()
  if (error) throw error
  return data
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

// ─── Vouchers ─────────────────────────────────────────────────────────────────

export async function fetchVouchers(company_id: string): Promise<Voucher[]> {
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
      .map(v => normalizeVoucherDates(v) as Voucher)
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
    .map(v => normalizeVoucherDates(v) as Voucher)
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

export async function getNextVoucherNo(company_id: string, type: 'Sales' | 'Purchase' | 'Receipt' | 'Payment', prefix: string, resetByFiscalYear = false, fiscalYearStart?: string): Promise<string> {
  let query = supabase
    .from('vouchers')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('type', type)
  if (resetByFiscalYear && fiscalYearStart) query = query.gte('date_ad', fiscalYearStart)
  const { count } = await query
  return `${prefix}${String((count || 0) + 1).padStart(4, '0')}`
}

interface InsertVoucherPayload {
  voucher: Omit<Voucher, 'id' | 'created_at' | 'lines' | 'stock_lines' | 'invoice_items' | 'party'>
  lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]
  stock_lines?: Omit<StockLine, 'id' | 'voucher_id'>[]
  invoice_items?: { item_id: string; qty: number; rate: number }[]
}

interface UpdateVoucherPayload {
  id: string
  voucher: Partial<Omit<Voucher, 'id' | 'created_at' | 'lines' | 'stock_lines' | 'invoice_items' | 'party'>>
  lines: Omit<VoucherLine, 'id' | 'voucher_id'>[]
  stock_lines?: Omit<StockLine, 'id' | 'voucher_id'>[]
  invoice_items?: { item_id: string; qty: number; rate: number }[]
}

export async function insertVoucher({ voucher, lines, stock_lines, invoice_items }: InsertVoucherPayload): Promise<Voucher> {
  const { data: v, error: ve } = await supabase
    .from('vouchers')
    .insert(voucher)
    .select()
    .single()
  if (ve) throw ve

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

  let newInvoiceItems: { item_id: string; qty: number; rate: number }[] = []
  if (invoice_items?.length) {
    const { data, error: ie } = await supabase
      .from('invoice_items')
      .insert(invoice_items.map(i => ({ ...i, voucher_id: v.id })))
      .select()
    if (ie) throw ie
    newInvoiceItems = data || []
  }

  return {
    ...normalizeVoucherDates(v),
    lines: newLines,
    stock_lines: newStockLines,
    invoice_items: newInvoiceItems,
  } as Voucher
}

export async function updateVoucher({ id, voucher, lines, stock_lines, invoice_items }: UpdateVoucherPayload): Promise<Voucher> {
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

  let newInvoiceItems: { item_id: string; qty: number; rate: number }[] = []
  if (invoice_items?.length) {
    const { data, error: ie } = await supabase
      .from('invoice_items')
      .insert(invoice_items.map(i => ({ ...i, voucher_id: id })))
      .select()
    if (ie) throw ie
    newInvoiceItems = data || []
  }

  return {
    ...normalizeVoucherDates(v),
    lines: newLines,
    stock_lines: newStockLines,
    invoice_items: newInvoiceItems,
  } as Voucher
}

export async function cancelVoucher(id: string) {
  const { error } = await supabase
    .from('vouchers')
    .update({ cancelled: true })
    .eq('id', id)
  if (error) throw error
}
