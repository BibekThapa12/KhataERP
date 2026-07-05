import { createClient } from '@supabase/supabase-js'
import type { Account, Party, Item, Voucher, VoucherLine, StockLine, Company } from '@/types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const getSession = () => supabase.auth.getSession()
export const signIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password })
export const signUp = (email: string, password: string) =>
  supabase.auth.signUp({ email, password })
export const signOut = () => supabase.auth.signOut()

// ─── Company ──────────────────────────────────────────────────────────────────

export async function getOrCreateCompany(user_id: string): Promise<Company> {
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('user_id', user_id)
    .single()
  if (data) return data
  const { data: newCompany, error } = await supabase
    .from('companies')
    .insert({ user_id, name: 'My Trading Co.', fiscal_year_start: '2026-04-01' })
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
  const { data, error } = await supabase
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
  if (error) throw error
  return data || []
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

export async function insertVoucher({ voucher, lines, stock_lines, invoice_items }: InsertVoucherPayload): Promise<Voucher> {
  const { data: v, error: ve } = await supabase
    .from('vouchers')
    .insert(voucher)
    .select()
    .single()
  if (ve) throw ve

  const { error: le } = await supabase
    .from('voucher_lines')
    .insert(lines.map(l => ({ ...l, voucher_id: v.id })))
  if (le) throw le

  if (stock_lines?.length) {
    const { error: se } = await supabase
      .from('stock_lines')
      .insert(stock_lines.map(s => ({ ...s, voucher_id: v.id })))
    if (se) throw se
  }

  if (invoice_items?.length) {
    const { error: ie } = await supabase
      .from('invoice_items')
      .insert(invoice_items.map(i => ({ ...i, voucher_id: v.id })))
    if (ie) throw ie
  }

  return v
}

export async function cancelVoucher(id: string) {
  const { error } = await supabase
    .from('vouchers')
    .update({ cancelled: true })
    .eq('id', id)
  if (error) throw error
}
