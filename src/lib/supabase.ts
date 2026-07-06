import { createClient } from '@supabase/supabase-js'
import type { Account, Party, Item, Voucher, VoucherLine, StockLine, Company } from '@/types'
import { normalizeVoucherDates } from '@/lib/nepaliDate'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const getSession = () => supabase.auth.getSession()
export const signIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password })

export interface CompanySignupDetails {
  name: string
  address: string
  pan_vat: string
  phone: string
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
      },
    },
  })
export const signOut = () => supabase.auth.signOut()

// ─── Company ──────────────────────────────────────────────────────────────────

export async function getOrCreateCompany(user_id: string): Promise<Company> {
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('user_id', user_id)
    .single()
  if (data) return data

  const { data: userData } = await supabase.auth.getUser()
  const metadata = userData.user?.user_metadata ?? {}
  const company = {
    user_id,
    name: String(metadata.company_name || 'My Trading Co.').trim() || 'My Trading Co.',
    address: String(metadata.company_address || '').trim(),
    pan_vat: String(metadata.company_pan_vat || '').trim(),
    phone: String(metadata.company_phone || '').trim(),
    fiscal_year_start: '2026-04-01',
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
  const { error } = await supabase.from('companies').update(updates).eq('id', id)
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

export async function getNextInvoiceNo(company_id: string, type: 'Sales' | 'Purchase'): Promise<string> {
  const prefix = type === 'Sales' ? 'INV-' : 'PB-'
  const { count } = await supabase
    .from('vouchers')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('type', type)
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

  const { data: newLines, error: le } = await supabase
    .from('voucher_lines')
    .insert(lines.map(l => ({ ...l, voucher_id: v.id })))
    .select()
  if (le) throw le

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
    lines: newLines || [],
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

  const { data: newLines, error: le } = await supabase
    .from('voucher_lines')
    .insert(lines.map(l => ({ ...l, voucher_id: id })))
    .select()
  if (le) throw le

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
    lines: newLines || [],
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
