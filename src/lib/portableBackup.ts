import type { Account, AccountCategory, Cheque, ChequeBank, ChequeEvent, Company, CompanyModule, Item, ItemCategory, Party, Voucher } from '@/types'

export const PORTABLE_BACKUP_FORMAT = 'khataerp-portable-company-v1' as const

export interface PortableBackupCounts { [key: string]: number }

export interface PortableCompanyBackup {
  format: typeof PORTABLE_BACKUP_FORMAT
  format_version?: 1
  schema_version?: string
  original_company_id?: string
  company_name?: string
  exported_at: string
  exported_by?: string
  record_counts?: PortableBackupCounts
  company: Partial<Company> | Record<string, unknown> | null
  accountCategories: AccountCategory[]
  itemCategories: ItemCategory[]
  accounts: Account[]
  parties: Party[]
  items: Item[]
  vouchers: Voucher[]
  chequeBanks?: ChequeBank[]
  cheques?: Cheque[]
  chequeEvents?: ChequeEvent[]
  companyModules?: CompanyModule[]
  masterChangeLogs?: Record<string, unknown>[]
  appEvents?: Record<string, unknown>[]
  account_categories?: AccountCategory[]
  item_categories?: ItemCategory[]
}

export interface PortableBackupSnapshot extends Partial<PortableCompanyBackup> {
  company?: PortableCompanyBackup['company']
}

const portableSystemAccountKeys = new Set([
  'cash', 'bank', 'inventory', 'vat_payable', 'vat_receivable', 'sales', 'purchase',
  'sales_return', 'purchase_return', 'capital', 'retained_earnings',
  'discount_allowed', 'rent', 'salary', 'electricity', 'bank_charges',
])

export function portableSystemAccountKey(accountId: unknown): string | null {
  const value = String(accountId || '').trim()
  const candidate = value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value
  return portableSystemAccountKeys.has(candidate) ? candidate : null
}

/** Maps source ledgers without depending on the source company's ID. */
export function portableAccountIdMap(sourceAccounts: Pick<Account, 'id' | 'name' | 'type'>[], targetAccounts: Pick<Account, 'id' | 'name' | 'type'>[]) {
  const result = new Map<string, string>()
  const targetBySystemKey = new Map(targetAccounts.flatMap(account => {
    const key = portableSystemAccountKey(account.id)
    return key ? [[key, account.id] as const] : []
  }))
  const normalizedName = (value: unknown) => String(value || '').trim().toLocaleLowerCase()

  for (const source of sourceAccounts) {
    const systemKey = portableSystemAccountKey(source.id)
    const systemTarget = systemKey ? targetBySystemKey.get(systemKey) : undefined
    if (systemTarget) {
      result.set(source.id, systemTarget)
      continue
    }
    const exact = targetAccounts.find(target => target.type === source.type && normalizedName(target.name) === normalizedName(source.name))
    if (exact) {
      result.set(source.id, exact.id)
      continue
    }
    const sameName = targetAccounts.filter(target => normalizedName(target.name) === normalizedName(source.name))
    if (sameName.length === 1) result.set(source.id, sameName[0].id)
  }
  return result
}

const companyFields = new Set([
  'name', 'address', 'pan_vat', 'phone', 'vat_enabled', 'inventory_valuation_method',
  'sales_prefix', 'purchase_prefix', 'receipt_prefix', 'payment_prefix', 'sales_return_prefix',
  'purchase_return_prefix', 'journal_numbering_mode', 'reset_numbering_fiscal_year',
  'allow_admin_chronological_bypass', 'enforce_sales_invoice_chronology', 'print_format', 'show_company_details_on_sales_invoice',
  'invoice_terms', 'payment_qr_text', 'payment_qr_url', 'logo_url', 'fiscal_year_start', 'fiscal_year_configured',
  'plan_status', 'trial_ends_at', 'plan_expires_at',
])

const sensitiveKey = /(^|_)(password|secret|token|service_role|api_key|refresh_token|access_token|encryption_key)($|_)/i

export function cleanPortableCompany(company: unknown) {
  if (!company || typeof company !== 'object') return null
  return Object.fromEntries(Object.entries(company as Record<string, unknown>).filter(([key]) => companyFields.has(key)))
}

export function removeBackupSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeBackupSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !sensitiveKey.test(key))
    .map(([key, entry]) => [key, removeBackupSecrets(entry)]))
}

function rows<T>(value: T[] | undefined): T[] { return Array.isArray(value) ? value : [] }

export function portableBackupCounts(snapshot: PortableBackupSnapshot): PortableBackupCounts {
  const vouchers = rows(snapshot.vouchers)
  return {
    account_categories: rows(snapshot.accountCategories || snapshot.account_categories).length,
    item_categories: rows(snapshot.itemCategories || snapshot.item_categories).length,
    accounts: rows(snapshot.accounts).length,
    parties: rows(snapshot.parties).length,
    items: rows(snapshot.items).length,
    vouchers: vouchers.length,
    voucher_lines: vouchers.reduce((sum, voucher) => sum + (voucher.lines?.length || 0), 0),
    stock_lines: vouchers.reduce((sum, voucher) => sum + (voucher.stock_lines?.length || 0), 0),
    invoice_items: vouchers.reduce((sum, voucher) => sum + (voucher.invoice_items?.length || 0), 0),
    settlements: vouchers.reduce((sum, voucher) => sum + (voucher.settlements?.length || 0), 0),
    cheque_banks: rows(snapshot.chequeBanks).length,
    cheques: rows(snapshot.cheques).length,
    cheque_events: rows(snapshot.chequeEvents).length,
    company_modules: rows(snapshot.companyModules).length,
    master_change_logs: rows(snapshot.masterChangeLogs).length,
    app_events: rows(snapshot.appEvents).length,
  }
}

export function buildPortableCompanyBackup(snapshot: PortableBackupSnapshot, metadata: { exportedBy?: string; schemaVersion?: string } = {}): PortableCompanyBackup {
  const cleanSnapshot = removeBackupSecrets(snapshot) as PortableBackupSnapshot
  const company = cleanPortableCompany(cleanSnapshot.company)
  const result: PortableCompanyBackup = {
    format: PORTABLE_BACKUP_FORMAT,
    format_version: 1,
    schema_version: metadata.schemaVersion || 'current',
    original_company_id: typeof (snapshot.company as Company | undefined)?.id === 'string' ? (snapshot.company as Company).id : undefined,
    company_name: typeof company?.name === 'string' ? company.name : undefined,
    exported_at: new Date().toISOString(),
    exported_by: metadata.exportedBy,
    company,
    accountCategories: rows(cleanSnapshot.accountCategories || cleanSnapshot.account_categories),
    itemCategories: rows(cleanSnapshot.itemCategories || cleanSnapshot.item_categories),
    accounts: rows(cleanSnapshot.accounts), parties: rows(cleanSnapshot.parties), items: rows(cleanSnapshot.items), vouchers: rows(cleanSnapshot.vouchers),
    chequeBanks: rows(cleanSnapshot.chequeBanks), cheques: rows(cleanSnapshot.cheques), chequeEvents: rows(cleanSnapshot.chequeEvents),
    companyModules: rows(cleanSnapshot.companyModules), masterChangeLogs: rows(cleanSnapshot.masterChangeLogs), appEvents: rows(cleanSnapshot.appEvents),
  }
  result.record_counts = portableBackupCounts(result)
  return result
}

export function validatePortableCompanyBackup(value: unknown): asserts value is PortableCompanyBackup {
  if (!value || typeof value !== 'object') throw new Error('Invalid KhataERP backup file.')
  const backup = value as Partial<PortableCompanyBackup>
  if (backup.format && backup.format !== PORTABLE_BACKUP_FORMAT) throw new Error('Unsupported KhataERP backup format.')
  for (const key of ['accounts', 'parties', 'items', 'vouchers'] as const) if (backup[key] !== undefined && !Array.isArray(backup[key])) throw new Error(`Backup ${key} data is invalid.`)
  if (!backup.company || typeof backup.company !== 'object') throw new Error('Backup company settings are missing.')
}

export function serializePortableBackup(backup: PortableCompanyBackup) {
  validatePortableCompanyBackup(backup)
  return JSON.stringify(backup, null, 2)
}

const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
export function safeBackupFolderName(value: string, fallback: string) {
  const printable = Array.from(value.normalize('NFKC'), character => character.charCodeAt(0) < 32 ? ' ' : character).join('')
  let result = printable.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '')
  if (!result || windowsReserved.test(result)) result = `${fallback} Folder`
  return result.slice(0, 100).replace(/[. ]+$/g, '') || fallback
}

export function uniqueBackupNames(entries: { id: string; name: string }[], fallback: string) {
  const base = entries.map(entry => ({ ...entry, safe: safeBackupFolderName(entry.name, fallback) }))
  const counts = new Map<string, number>()
  for (const entry of base) counts.set(entry.safe.toLocaleLowerCase(), (counts.get(entry.safe.toLocaleLowerCase()) || 0) + 1)
  return new Map(base.map(entry => [entry.id, (counts.get(entry.safe.toLocaleLowerCase()) || 0) > 1 ? `${entry.safe} (${entry.id.slice(0, 8)})` : entry.safe]))
}
