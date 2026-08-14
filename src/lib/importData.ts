import * as XLSX from 'xlsx'
import type { Account, AccountCategory, Company, Item, ItemCategory, Party, StockCondition, Voucher } from '@/types'
import { parseBsDate } from '@/lib/nepaliDate'
import { masterNameKey } from '@/lib/nameFormat'

export type ImportModule =
  | 'account-groups'
  | 'ledgers'
  | 'parties'
  | 'item-categories'
  | 'items'
  | 'journal-drafts'
  | 'receipt-drafts'
  | 'payment-drafts'
  | 'purchase-drafts'
  | 'sales-drafts'
  | 'stock-adjustment-drafts'

export interface ImportTemplateColumn {
  key: string
  label: string
  required?: boolean
  help?: string
}

export interface ImportTemplateSchema {
  module: ImportModule
  title: string
  description: string
  priority: number
  columns: ImportTemplateColumn[]
  sampleRows: Record<string, string | number | boolean>[]
}

export interface ImportRowIssue {
  row: number
  field?: string
  message: string
}

export interface ImportRowWarning extends ImportRowIssue {}

export interface ImportPreview {
  module: ImportModule
  totalRows: number
  validRows: number
  skippedRows: number
  voucherCount: number
  errors: ImportRowIssue[]
  warnings: ImportRowWarning[]
  rows: Record<string, unknown>[]
}

export interface ImportExecutionContext {
  company: Company
  accounts: Account[]
  accountCategories: AccountCategory[]
  parties: Party[]
  items: Item[]
  itemCategories: ItemCategory[]
  addAccountCategory: (data: { name: string; account_type: Account['type']; parent_category_id?: string | null }) => Promise<void>
  addAccount: (data: { name: string; type: Account['type']; group: string; category_id?: string; opening_balance?: number; address?: string | null; contact_no?: string | null; pan_no?: string | null; credit_days?: number | null; bank_account_no?: string | null; bank_branch?: string | null }) => Promise<Account>
  addParty: (data: { name: string; type: 'customer' | 'supplier'; phone?: string; pan_vat?: string; address?: string; default_credit_days?: number; opening_balance?: number }) => Promise<Party>
  addItemCategory: (data: { name: string; parent_category_id?: string | null }) => Promise<ItemCategory>
  addItem: (data: { name: string; unit: string; alternate_unit?: string | null; alternate_conversion?: number | null; sell_rate?: number; opening_qty?: number; opening_rate?: number; reorder_level?: number | null; category_id?: string; sku?: string; barcode?: string; vat_applicable?: boolean; is_service?: boolean }) => Promise<Item>
  saveDraftVoucher: (params: { type: Voucher['type']; date_bs: string; narration?: string; party_account_id?: string | null; is_cash?: boolean; total?: number; draft_payload: Record<string, unknown> }) => Promise<Voucher>
}

export interface ImportRunResult {
  created: number
  skipped: number
  vouchers: number
}

const accountTypes: Account['type'][] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense']
const partyTypes: Party['type'][] = ['customer', 'supplier']
const stockConditions: StockCondition[] = ['saleable', 'damaged', 'expired']

const c = (key: string, label: string, required = false, help?: string): ImportTemplateColumn => ({ key, label, required, help })

export const IMPORT_TEMPLATES: ImportTemplateSchema[] = [
  {
    module: 'account-groups',
    title: 'Account Groups',
    description: 'Create custom account groups below existing parent groups.',
    priority: 1,
    columns: [c('name', 'Group Name', true), c('account_type', 'Account Type', true), c('parent_group', 'Parent Group', true)],
    sampleRows: [{ name: 'Staff Advances', account_type: 'Asset', parent_group: 'Loans and Advances' }],
  },
  {
    module: 'ledgers',
    title: 'Ledgers / Accounts',
    description: 'Create non-party ledger accounts. Party ledgers can also be created through Parties.',
    priority: 2,
    columns: [
      c('name', 'Ledger Name', true), c('account_type', 'Account Type', true), c('group', 'Group', true),
      c('opening_balance', 'Opening Balance'), c('address', 'Address'), c('contact_no', 'Contact No.'),
      c('pan_no', 'PAN No.'), c('credit_days', 'Credit Days'), c('bank_account_no', 'Bank Account No.'), c('bank_branch', 'Bank Branch'),
    ],
    sampleRows: [{ name: 'ABC Bank', account_type: 'Asset', group: 'Bank Accounts', opening_balance: 0, bank_account_no: '1234567890', bank_branch: 'Kathmandu' }],
  },
  {
    module: 'parties',
    title: 'Parties',
    description: 'Create customers and suppliers with linked party ledgers.',
    priority: 3,
    columns: [
      c('name', 'Party Name', true), c('party_type', 'Party Type', true), c('phone', 'Phone'), c('pan_vat', 'PAN/VAT'),
      c('address', 'Address'), c('default_credit_days', 'Default Credit Days'), c('opening_balance', 'Opening Balance'),
    ],
    sampleRows: [{ name: 'Krishan Traders', party_type: 'customer', phone: '9800000000', pan_vat: '123456789', address: 'Kathmandu', default_credit_days: 0, opening_balance: 0 }],
  },
  {
    module: 'item-categories',
    title: 'Item Categories',
    description: 'Create item categories before importing items.',
    priority: 4,
    columns: [c('name', 'Category Name', true), c('parent_category', 'Parent Category')],
    sampleRows: [{ name: 'Beverages', parent_category: 'General' }],
  },
  {
    module: 'items',
    title: 'Items and Services',
    description: 'Create stock items and service items.',
    priority: 5,
    columns: [
      c('name', 'Item Name', true), c('is_service', 'Is Service'), c('category', 'Category'), c('unit', 'Main Unit'),
      c('alternate_unit', 'Alternate Unit'), c('alternate_conversion', 'Alternate Conversion'), c('sell_rate', 'Sell Rate'),
      c('opening_qty', 'Opening Qty'), c('opening_rate', 'Opening Rate'), c('reorder_level', 'Reorder Level'),
      c('sku', 'SKU'), c('barcode', 'Barcode'), c('vat_applicable', 'VAT Applicable'),
    ],
    sampleRows: [
      { name: 'COKE (cs / pcs)', is_service: 'No', category: 'General', unit: 'cs', alternate_unit: 'pcs', alternate_conversion: 6, sell_rate: 180, opening_qty: 0, opening_rate: 0, reorder_level: 0, vat_applicable: 'Yes' },
      { name: 'Delivery Service', is_service: 'Yes', category: 'General', unit: 'Service', sell_rate: 500, vat_applicable: 'Yes' },
    ],
  },
  {
    module: 'journal-drafts',
    title: 'Journal Draft Vouchers',
    description: 'Import balanced journal voucher lines as drafts.',
    priority: 7,
    columns: [c('external_voucher_no', 'External Voucher No.', true), c('date_bs', 'Date (B.S.)', true), c('ledger', 'Ledger', true), c('debit', 'Debit'), c('credit', 'Credit'), c('narration', 'Narration')],
    sampleRows: [
      { external_voucher_no: 'JV-OLD-001', date_bs: '2083-04-01', ledger: 'Rent Expenses', debit: 1000, credit: 0, narration: 'Opening migration' },
      { external_voucher_no: 'JV-OLD-001', date_bs: '2083-04-01', ledger: 'Cash', debit: 0, credit: 1000, narration: 'Opening migration' },
    ],
  },
  {
    module: 'receipt-drafts',
    title: 'Receipt Draft Vouchers',
    description: 'Import received amounts as receipt drafts.',
    priority: 8,
    columns: [c('external_voucher_no', 'External Voucher No.', true), c('date_bs', 'Date (B.S.)', true), c('deposit_to', 'Deposit To', true), c('received_from', 'Received From Ledger', true), c('amount', 'Amount', true), c('narration', 'Narration')],
    sampleRows: [{ external_voucher_no: 'RCT-OLD-001', date_bs: '2083-04-01', deposit_to: 'Cash', received_from: 'Krishan Traders', amount: 15000, narration: 'Old receipt import' }],
  },
  {
    module: 'payment-drafts',
    title: 'Payment Draft Vouchers',
    description: 'Import paid amounts as payment drafts.',
    priority: 9,
    columns: [c('external_voucher_no', 'External Voucher No.', true), c('date_bs', 'Date (B.S.)', true), c('paid_from', 'Paid From', true), c('paid_to', 'Paid To Ledger', true), c('amount', 'Amount', true), c('narration', 'Narration')],
    sampleRows: [{ external_voucher_no: 'PAY-OLD-001', date_bs: '2083-04-01', paid_from: 'Cash', paid_to: 'Supplier A', amount: 10000, narration: 'Old payment import' }],
  },
  {
    module: 'purchase-drafts',
    title: 'Purchase Draft Vouchers',
    description: 'Import purchase bill lines as draft vouchers.',
    priority: 10,
    columns: invoiceColumns('Supplier', true),
    sampleRows: [{ external_voucher_no: 'PB-OLD-001', date_bs: '2083-04-01', party: 'Supplier A', is_cash: 'No', credit_days: 0, supplier_invoice_no: 'S-1001', item: 'COKE (cs / pcs)', qty: 10, unit: 'pcs', rate: 160, vat_rate: 13, discount_flat: 0, narration: 'Old purchase import' }],
  },
  {
    module: 'sales-drafts',
    title: 'Sales Draft Vouchers',
    description: 'Import sales invoice lines as draft vouchers.',
    priority: 11,
    columns: invoiceColumns('Customer', false),
    sampleRows: [{ external_voucher_no: 'INV-OLD-001', date_bs: '2083-04-01', party: 'Krishan Traders', is_cash: 'No', credit_days: 0, item: 'COKE (cs / pcs)', qty: 10, unit: 'pcs', rate: 180, vat_rate: 13, discount_flat: 0, narration: 'Old sales import' }],
  },
  {
    module: 'stock-adjustment-drafts',
    title: 'Stock Adjustment Drafts',
    description: 'Import stock quantity corrections as draft vouchers.',
    priority: 12,
    columns: [c('external_voucher_no', 'External Voucher No.', true), c('date_bs', 'Date (B.S.)', true), c('item', 'Item', true), c('qty_delta', 'Qty Delta', true), c('rate', 'Rate'), c('stock_condition', 'Stock Condition'), c('narration', 'Narration')],
    sampleRows: [{ external_voucher_no: 'STK-OLD-001', date_bs: '2083-04-01', item: 'COKE (cs / pcs)', qty_delta: 5, rate: 160, stock_condition: 'saleable', narration: 'Opening stock correction' }],
  },
]

function invoiceColumns(partyLabel: string, includeSupplierInvoiceNo: boolean) {
  return [
    c('external_voucher_no', 'External Voucher No.', true), c('date_bs', 'Date (B.S.)', true), c('party', partyLabel),
    c('is_cash', 'Is Cash'), c('credit_days', 'Credit Days'), ...(includeSupplierInvoiceNo ? [c('supplier_invoice_no', 'Supplier Invoice No.')] : []),
    c('item', 'Item', true), c('qty', 'Qty', true), c('unit', 'Unit'), c('rate', 'Rate', true),
    c('vat_rate', 'VAT Rate'), c('discount_flat', 'Discount Flat'), c('narration', 'Narration'),
  ]
}

export function importModuleOptions() {
  return IMPORT_TEMPLATES.map(template => ({ value: template.module, label: `${template.priority}. ${template.title}` }))
}

export function templateFor(module: ImportModule) {
  const template = IMPORT_TEMPLATES.find(entry => entry.module === module)
  if (!template) throw new Error('Import template not found')
  return template
}

export function downloadImportTemplate(module: ImportModule, context: Pick<ImportExecutionContext, 'accounts' | 'accountCategories' | 'parties' | 'items' | 'itemCategories'>) {
  const template = templateFor(module)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['KhataERP Import Template'],
    [template.title],
    [template.description],
    ['Fill only the Data sheet. Do not rename headers. Unknown extra columns are ignored with a warning.'],
    ['Transactions are imported as Draft vouchers and do not affect reports until completed.'],
  ]), 'Instructions')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(template.sampleRows, { header: template.columns.map(column => column.key) }), 'Data')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Column', 'Required', 'Help'],
    ...template.columns.map(column => [column.key, column.required ? 'Yes' : 'No', column.help || column.label]),
  ]), 'Columns')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(referenceRows(context)), 'References')
  XLSX.writeFile(workbook, `khataerp-${module}-template.xlsx`)
}

function referenceRows(context: Pick<ImportExecutionContext, 'accounts' | 'accountCategories' | 'parties' | 'items' | 'itemCategories'>) {
  return [
    ['Type', 'Name', 'Detail'],
    ...accountTypes.map(type => ['Account Type', type, '']),
    ...partyTypes.map(type => ['Party Type', type, '']),
    ...stockConditions.map(condition => ['Stock Condition', condition, '']),
    ...context.accountCategories.filter(row => !row.is_archived).map(row => ['Account Group', row.name, row.account_type]),
    ...context.accounts.filter(row => !row.is_archived).map(row => ['Ledger', row.name, row.type]),
    ...context.parties.filter(row => !row.is_archived).map(row => ['Party', row.name, row.type]),
    ...context.itemCategories.filter(row => !row.is_archived).map(row => ['Item Category', row.name, '']),
    ...context.items.filter(row => !row.is_archived).map(row => ['Item', row.name, row.is_service ? 'Service' : row.unit]),
  ]
}

export async function previewImportWorkbook(file: File, module: ImportModule, context: ImportExecutionContext): Promise<ImportPreview> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return emptyPreview(module, [{ row: 0, message: 'Select a .xlsx Excel file.' }])
  }
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    return emptyPreview(module, [{ row: 0, message: 'Import files must be between 1 byte and 10 MB.' }])
  }
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheet = workbook.Sheets.Data || workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return emptyPreview(module, [{ row: 0, message: 'The workbook does not contain a Data sheet.' }])
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false }).map(normalizeRow).filter(row => Object.values(row).some(value => String(value ?? '').trim()))
  return validateRows(module, rows, context)
}

function emptyPreview(module: ImportModule, errors: ImportRowIssue[]): ImportPreview {
  return { module, totalRows: 0, validRows: 0, skippedRows: 0, voucherCount: 0, errors, warnings: [], rows: [] }
}

function normalizeRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]))
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[()./]+/g, '').replace(/_+/g, '_')
}

export function validateRows(module: ImportModule, rows: Record<string, unknown>[], context: ImportExecutionContext): ImportPreview {
  const template = templateFor(module)
  const knownKeys = new Set(template.columns.map(column => column.key))
  const errors: ImportRowIssue[] = []
  const warnings: ImportRowWarning[] = []
  rows.forEach((row, index) => {
    const rowNo = index + 2
    template.columns.filter(column => column.required).forEach(column => {
      if (!str(row[column.key])) errors.push({ row: rowNo, field: column.key, message: `${column.label} is required.` })
    })
    if (knownKeys.has('date_bs') && str(row.date_bs) && !parseBsDate(str(row.date_bs))) errors.push({ row: rowNo, field: 'date_bs', message: 'Date must be a valid B.S. date in YYYY-MM-DD format.' })
    Object.keys(row).forEach(key => {
      if (!knownKeys.has(key)) warnings.push({ row: rowNo, field: key, message: `Unknown column "${key}" will be ignored.` })
    })
  })

  if (module === 'account-groups') validateAccountGroups(rows, context, errors, warnings)
  if (module === 'ledgers') validateLedgers(rows, context, errors, warnings)
  if (module === 'parties') validateParties(rows, context, errors, warnings)
  if (module === 'item-categories') validateItemCategories(rows, context, errors, warnings)
  if (module === 'items') validateItems(rows, context, errors, warnings)
  if (module === 'journal-drafts') validateJournalDrafts(rows, context, errors)
  if (module === 'receipt-drafts' || module === 'payment-drafts') validateMoneyDrafts(rows, context, errors, module)
  if (module === 'sales-drafts' || module === 'purchase-drafts') validateInvoiceDrafts(rows, context, errors, module)
  if (module === 'stock-adjustment-drafts') validateStockAdjustmentDrafts(rows, context, errors)

  return {
    module,
    totalRows: rows.length,
    validRows: errors.length ? 0 : rows.length,
    skippedRows: warnings.filter(warning => /already exists|will be skipped/i.test(warning.message)).length,
    voucherCount: module.endsWith('-drafts') ? voucherGroups(rows).length : 0,
    errors,
    warnings,
    rows,
  }
}

function validateAccountGroups(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[], warnings: ImportRowWarning[]) {
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const rowNo = index + 2
    const name = str(row.name)
    const type = str(row.account_type) as Account['type']
    const parent = context.accountCategories.find(category => same(category.name, str(row.parent_group)))
    if (name && seen.has(key(name))) errors.push({ row: rowNo, field: 'name', message: 'Duplicate account group in this file.' })
    seen.add(key(name))
    if (type && !accountTypes.includes(type)) errors.push({ row: rowNo, field: 'account_type', message: 'Account Type must be Asset, Liability, Equity, Income, or Expense.' })
    if (str(row.parent_group) && !parent) errors.push({ row: rowNo, field: 'parent_group', message: 'Parent group was not found.' })
    if (parent && parent.account_type !== type) errors.push({ row: rowNo, field: 'parent_group', message: 'Parent group account type does not match.' })
    if (context.accountCategories.some(category => same(category.name, name) && category.account_type === type)) warnings.push({ row: rowNo, field: 'name', message: 'Account group already exists and will be skipped.' })
  })
}

function validateLedgers(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[], warnings: ImportRowWarning[]) {
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const rowNo = index + 2
    const name = str(row.name)
    const type = str(row.account_type) as Account['type']
    const category = context.accountCategories.find(entry => same(entry.name, str(row.group)))
    if (name && seen.has(key(name))) errors.push({ row: rowNo, field: 'name', message: 'Duplicate ledger in this file.' })
    seen.add(key(name))
    if (type && !accountTypes.includes(type)) errors.push({ row: rowNo, field: 'account_type', message: 'Invalid Account Type.' })
    if (!category) errors.push({ row: rowNo, field: 'group', message: 'Ledger group was not found.' })
    if (category && category.account_type !== type) errors.push({ row: rowNo, field: 'group', message: 'Ledger group account type does not match.' })
    if (context.accounts.some(account => same(account.name, name))) warnings.push({ row: rowNo, field: 'name', message: 'Ledger already exists and will be skipped.' })
    validateNumber(row.opening_balance, rowNo, 'opening_balance', errors, false)
    validateWholeNumber(row.credit_days, rowNo, 'credit_days', errors, false)
  })
}

function validateParties(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[], warnings: ImportRowWarning[]) {
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const rowNo = index + 2
    const name = str(row.name)
    const type = str(row.party_type).toLowerCase() as Party['type']
    if (name && seen.has(key(name))) errors.push({ row: rowNo, field: 'name', message: 'Duplicate party in this file.' })
    seen.add(key(name))
    if (type && !partyTypes.includes(type)) errors.push({ row: rowNo, field: 'party_type', message: 'Party Type must be customer or supplier.' })
    if (context.parties.some(party => same(party.name, name)) || context.accounts.some(account => same(account.name, name))) warnings.push({ row: rowNo, field: 'name', message: 'Party or ledger already exists and will be skipped.' })
    validateNumber(row.opening_balance, rowNo, 'opening_balance', errors, false)
    validateWholeNumber(row.default_credit_days, rowNo, 'default_credit_days', errors, false)
  })
}

function validateItemCategories(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[], warnings: ImportRowWarning[]) {
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const rowNo = index + 2
    const name = str(row.name)
    if (name && seen.has(key(name))) errors.push({ row: rowNo, field: 'name', message: 'Duplicate item category in this file.' })
    seen.add(key(name))
    if (str(row.parent_category) && !context.itemCategories.some(category => same(category.name, str(row.parent_category)))) errors.push({ row: rowNo, field: 'parent_category', message: 'Parent item category was not found.' })
    if (context.itemCategories.some(category => same(category.name, name))) warnings.push({ row: rowNo, field: 'name', message: 'Item category already exists and will be skipped.' })
  })
}

function validateItems(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[], warnings: ImportRowWarning[]) {
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const rowNo = index + 2
    const name = str(row.name)
    const service = bool(row.is_service)
    if (name && seen.has(key(name))) errors.push({ row: rowNo, field: 'name', message: 'Duplicate item in this file.' })
    seen.add(key(name))
    if (!service && !str(row.unit)) errors.push({ row: rowNo, field: 'unit', message: 'Main Unit is required for stock items.' })
    if (str(row.category) && !context.itemCategories.some(category => same(category.name, str(row.category)))) errors.push({ row: rowNo, field: 'category', message: 'Item category was not found.' })
    if (context.items.some(item => same(item.name, name))) warnings.push({ row: rowNo, field: 'name', message: 'Item already exists and will be skipped.' })
    validateNumber(row.sell_rate, rowNo, 'sell_rate', errors, false, true)
    validateNumber(row.opening_qty, rowNo, 'opening_qty', errors, false, true)
    validateNumber(row.opening_rate, rowNo, 'opening_rate', errors, false, true)
    validateNumber(row.reorder_level, rowNo, 'reorder_level', errors, false, true)
    if (str(row.alternate_unit)) validateNumber(row.alternate_conversion, rowNo, 'alternate_conversion', errors, true)
  })
}

function validateJournalDrafts(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[]) {
  for (const group of voucherGroups(rows)) {
    let debit = 0
    let credit = 0
    group.rows.forEach(entry => {
      const rowNo = Number(entry.__row)
      if (!context.accounts.some(account => same(account.name, str(entry.ledger)))) errors.push({ row: rowNo, field: 'ledger', message: 'Ledger was not found.' })
      debit += num(entry.debit)
      credit += num(entry.credit)
      if (num(entry.debit) > 0 && num(entry.credit) > 0) errors.push({ row: rowNo, message: 'A journal line cannot have both debit and credit.' })
    })
    if (group.rows.length < 2) errors.push({ row: Number(group.rows[0]?.__row || 0), message: 'Journal voucher requires at least two lines.' })
    if (Math.abs(debit - credit) > 0.005) errors.push({ row: Number(group.rows[0]?.__row || 0), message: 'Journal voucher debit and credit totals must match.' })
  }
}

function validateMoneyDrafts(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[], module: ImportModule) {
  for (const group of voucherGroups(rows)) {
    group.rows.forEach(entry => {
      const rowNo = Number(entry.__row)
      const money = module === 'receipt-drafts' ? str(entry.deposit_to) : str(entry.paid_from)
      const ledger = module === 'receipt-drafts' ? str(entry.received_from) : str(entry.paid_to)
      if (!context.accounts.some(account => same(account.name, money))) errors.push({ row: rowNo, message: 'Cash/bank ledger was not found.' })
      if (!context.accounts.some(account => same(account.name, ledger))) errors.push({ row: rowNo, message: 'Allocation ledger was not found.' })
      validateNumber(entry.amount, rowNo, 'amount', errors, true)
    })
  }
}

function validateInvoiceDrafts(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[], module: ImportModule) {
  const expectedPartyType: Party['type'] = module === 'sales-drafts' ? 'customer' : 'supplier'
  for (const group of voucherGroups(rows)) {
    group.rows.forEach(entry => {
      const rowNo = Number(entry.__row)
      const cash = bool(entry.is_cash)
      if (!cash && !context.parties.some(party => party.type === expectedPartyType && same(party.name, str(entry.party)))) errors.push({ row: rowNo, field: 'party', message: `Matching ${expectedPartyType} was not found.` })
      const item = context.items.find(rowItem => same(rowItem.name, str(entry.item)))
      if (!item) errors.push({ row: rowNo, field: 'item', message: 'Item was not found.' })
      if (item && !item.is_service && str(entry.unit) && !same(entry.unit, item.unit) && !same(entry.unit, item.alternate_unit || '')) errors.push({ row: rowNo, field: 'unit', message: 'Unit must match item main or alternate unit.' })
      validateNumber(entry.qty, rowNo, 'qty', errors, false)
      validateNumber(entry.rate, rowNo, 'rate', errors, false)
      validateNumber(entry.vat_rate, rowNo, 'vat_rate', errors, false)
      validateNumber(entry.discount_flat, rowNo, 'discount_flat', errors, false)
      validateWholeNumber(entry.credit_days, rowNo, 'credit_days', errors, false)
    })
  }
}

function validateStockAdjustmentDrafts(rows: Record<string, unknown>[], context: ImportExecutionContext, errors: ImportRowIssue[]) {
  for (const group of voucherGroups(rows)) {
    if (group.rows.length > 1) errors.push({ row: Number(group.rows[0]?.__row || 0), message: 'Stock adjustment imports support one item per draft voucher.' })
    group.rows.forEach(entry => {
      const rowNo = Number(entry.__row)
      const item = context.items.find(rowItem => same(rowItem.name, str(entry.item)))
      if (!item) errors.push({ row: rowNo, field: 'item', message: 'Item was not found.' })
      if (item?.is_service) errors.push({ row: rowNo, field: 'item', message: 'Service items cannot be used in stock adjustment drafts.' })
      if (str(entry.stock_condition) && !stockConditions.includes(str(entry.stock_condition).toLowerCase() as StockCondition)) errors.push({ row: rowNo, field: 'stock_condition', message: 'Stock Condition must be saleable, damaged, or expired.' })
      validateNumber(entry.qty_delta, rowNo, 'qty_delta', errors, true)
      validateNumber(entry.rate, rowNo, 'rate', errors, false)
    })
  }
}

export async function executeImport(preview: ImportPreview, context: ImportExecutionContext): Promise<ImportRunResult> {
  if (preview.errors.length) throw new Error('Fix import errors before importing.')
  let created = 0
  let skipped = 0
  if (preview.module === 'account-groups') {
    for (const row of preview.rows) {
      if (context.accountCategories.some(category => same(category.name, str(row.name)) && category.account_type === str(row.account_type))) { skipped += 1; continue }
      const parent = context.accountCategories.find(category => same(category.name, str(row.parent_group)))
      await context.addAccountCategory({ name: str(row.name), account_type: str(row.account_type) as Account['type'], parent_category_id: parent?.id || null })
      created += 1
    }
  } else if (preview.module === 'ledgers') {
    for (const row of preview.rows) {
      if (context.accounts.some(account => same(account.name, str(row.name)))) { skipped += 1; continue }
      const category = context.accountCategories.find(entry => same(entry.name, str(row.group)))
      await context.addAccount({ name: str(row.name), type: str(row.account_type) as Account['type'], group: category?.name || str(row.group), category_id: category?.id, opening_balance: num(row.opening_balance), address: nullable(row.address), contact_no: nullable(row.contact_no), pan_no: nullable(row.pan_no), credit_days: nullableNumber(row.credit_days), bank_account_no: nullable(row.bank_account_no), bank_branch: nullable(row.bank_branch) })
      created += 1
    }
  } else if (preview.module === 'parties') {
    for (const row of preview.rows) {
      if (context.parties.some(party => same(party.name, str(row.name))) || context.accounts.some(account => same(account.name, str(row.name)))) { skipped += 1; continue }
      await context.addParty({ name: str(row.name), type: str(row.party_type).toLowerCase() as Party['type'], phone: str(row.phone), pan_vat: str(row.pan_vat), address: str(row.address), default_credit_days: num(row.default_credit_days), opening_balance: num(row.opening_balance) })
      created += 1
    }
  } else if (preview.module === 'item-categories') {
    for (const row of preview.rows) {
      if (context.itemCategories.some(category => same(category.name, str(row.name)))) { skipped += 1; continue }
      const parent = context.itemCategories.find(category => same(category.name, str(row.parent_category)))
      await context.addItemCategory({ name: str(row.name), parent_category_id: parent?.id || null })
      created += 1
    }
  } else if (preview.module === 'items') {
    for (const row of preview.rows) {
      if (context.items.some(item => same(item.name, str(row.name)))) { skipped += 1; continue }
      const service = bool(row.is_service)
      const category = context.itemCategories.find(entry => same(entry.name, str(row.category)))
      await context.addItem({ name: str(row.name), is_service: service, unit: service ? 'Service' : str(row.unit), alternate_unit: service ? null : nullable(row.alternate_unit), alternate_conversion: service ? null : nullableNumber(row.alternate_conversion), sell_rate: num(row.sell_rate), opening_qty: service ? 0 : num(row.opening_qty), opening_rate: service ? 0 : num(row.opening_rate), reorder_level: service ? null : nullableNumber(row.reorder_level), category_id: category?.id, sku: str(row.sku), barcode: str(row.barcode), vat_applicable: row.vat_applicable === '' ? true : bool(row.vat_applicable) })
      created += 1
    }
  } else {
    for (const group of voucherGroups(preview.rows)) {
      await saveDraftGroup(preview.module, group.rows, context)
      created += group.rows.length
    }
  }
  return { created, skipped, vouchers: preview.module.endsWith('-drafts') ? voucherGroups(preview.rows).length : 0 }
}

async function saveDraftGroup(module: ImportModule, rows: Record<string, unknown>[], context: ImportExecutionContext) {
  const first = rows[0]
  const dateBs = str(first.date_bs)
  const narration = str(first.narration)
  if (module === 'journal-drafts') {
    const jLines = rows.map(row => ({ account_id: accountId(context, str(row.ledger)), debit: num(row.debit), credit: num(row.credit) })).filter(row => row.account_id && (row.debit > 0 || row.credit > 0))
    await context.saveDraftVoucher({ type: 'Journal', date_bs: dateBs, narration, total: jLines.reduce((sum, row) => sum + row.debit, 0), draft_payload: { dateBs, journalInvoiceNo: '', jLines, narration } })
    return
  }
  if (module === 'receipt-drafts' || module === 'payment-drafts') {
    const moneyAccountId = accountId(context, module === 'receipt-drafts' ? str(first.deposit_to) : str(first.paid_from))
    const allocations = rows.map(row => ({ account_id: accountId(context, module === 'receipt-drafts' ? str(row.received_from) : str(row.paid_to)), amount: String(num(row.amount)), invoice_allocations: [] }))
    await context.saveDraftVoucher({ type: module === 'receipt-drafts' ? 'Receipt' : 'Payment', date_bs: dateBs, narration, party_account_id: allocations[0]?.account_id || null, is_cash: same(module === 'receipt-drafts' ? first.deposit_to : first.paid_from, 'Cash'), total: allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0), draft_payload: { dateBs, allocations, moneyAccountId, narration } })
    return
  }
  if (module === 'sales-drafts' || module === 'purchase-drafts') {
    const isSales = module === 'sales-drafts'
    const isCash = bool(first.is_cash)
    const party = context.parties.find(entry => entry.type === (isSales ? 'customer' : 'supplier') && same(entry.name, str(first.party)))
    const lines = rows.map(row => {
      const item = context.items.find(entry => same(entry.name, str(row.item)))
      const unit = str(row.unit) || item?.unit || 'Service'
      const alternate = item?.alternate_unit && same(unit, item.alternate_unit)
      return { item_id: item?.id || '', qty: num(row.qty), rate: num(row.rate), unit_mode: alternate ? 'alternate' : 'main', entry_unit: unit, conversion_factor: alternate ? item?.alternate_conversion || 1 : 1 }
    })
    const subtotal = lines.reduce((sum, row) => sum + row.qty * row.rate, 0)
    const discount = num(first.discount_flat)
    const vatRate = first.vat_rate === '' ? 13 : num(first.vat_rate)
    const total = Math.round((subtotal - discount + ((subtotal - discount) * vatRate / 100) + Number.EPSILON) * 1_000_000) / 1_000_000
    await context.saveDraftVoucher({ type: isSales ? 'Sales' : 'Purchase', date_bs: dateBs, narration, party_account_id: isCash ? null : party?.account_id || null, is_cash: isCash, total, draft_payload: { dateBs, isCash, partyAccountId: isCash ? '' : party?.account_id || '', creditDays: num(first.credit_days), supplierInvoiceNo: str(first.supplier_invoice_no), lines, vatRate, discount, discountMode: 'flat', narration } })
    return
  }
  if (module === 'stock-adjustment-drafts') {
    const item = context.items.find(entry => same(entry.name, str(first.item)))
    const qtyDelta = num(first.qty_delta)
    await context.saveDraftVoucher({ type: 'Stock Adjustment', date_bs: dateBs, narration, total: Math.abs(qtyDelta * num(first.rate)), draft_payload: { dateBs, mode: 'adjustment', itemId: item?.id || '', stockCondition: (str(first.stock_condition).toLowerCase() || 'saleable') as StockCondition, unitMode: 'main', qtyDelta: String(qtyDelta), rate: String(num(first.rate)), narration } })
  }
}

function voucherGroups(rows: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>[]>()
  rows.forEach((row, index) => {
    row.__row = index + 2
    const id = str(row.external_voucher_no) || `row-${index + 2}`
    groups.set(id, [...(groups.get(id) || []), row])
  })
  return Array.from(groups.entries()).map(([id, groupRows]) => ({ id, rows: groupRows }))
}

function accountId(context: ImportExecutionContext, name: string) {
  return context.accounts.find(account => same(account.name, name))?.id || ''
}

function str(value: unknown) {
  return String(value ?? '').trim()
}

function num(value: unknown) {
  const text = str(value).replace(/,/g, '')
  if (!text) return 0
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullable(value: unknown) {
  const text = str(value)
  return text ? text : null
}

function nullableNumber(value: unknown) {
  const text = str(value)
  return text ? num(text) : null
}

function bool(value: unknown) {
  const text = str(value).toLowerCase()
  return ['yes', 'true', '1', 'y', 'service'].includes(text)
}

function key(value: unknown) {
  return masterNameKey(str(value))
}

function same(a: unknown, b: unknown) {
  return key(a) === key(b)
}

function validateNumber(value: unknown, row: number, field: string, errors: ImportRowIssue[], positive: boolean, allowNegative = false) {
  const text = str(value)
  if (!text) return
  const parsed = Number(text.replace(/,/g, ''))
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    errors.push({ row, field, message: `${field} must be a number.` })
    return
  }
  if (positive && parsed <= 0) errors.push({ row, field, message: `${field} must be greater than zero.` })
  if (!positive && !allowNegative && parsed < 0) errors.push({ row, field, message: `${field} cannot be negative.` })
}

function validateWholeNumber(value: unknown, row: number, field: string, errors: ImportRowIssue[], required: boolean) {
  const text = str(value)
  if (!text && !required) return
  const parsed = Number(text.replace(/,/g, ''))
  if (!Number.isInteger(parsed) || parsed < 0) errors.push({ row, field, message: `${field} must be a whole number of 0 or more.` })
}
