import { useEffect, useMemo, useState } from 'react'
import { Building2, Database, Download, FileSpreadsheet, ReceiptText, Upload, Users } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { logAppEvent, supabase, supabaseProjectHost } from '@/lib/supabase'
import { downloadImportTemplate, executeImport, importModuleOptions, previewImportWorkbook, templateFor, type ImportModule, type ImportPreview } from '@/lib/importData'
import { adToBs, bsToAd, DEFAULT_FISCAL_YEAR_START_BS, makeBsKey, parseBsDate } from '@/lib/nepaliDate'
import { todayISO } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import type { CompanyModule, InventoryValuationMethod, InvoiceItem, Voucher } from '@/types'
import { backupFileValidationError, isSafePublicImageUrl, publicErrorMessage } from '@/lib/security'
import { fiscalYearStartBs as currentFiscalYearStartBs } from '@/lib/reports'
import { formatMasterName } from '@/lib/nameFormat'
import { IDENTITY_LIMITS, identityDatabaseError, normalizePanInput, normalizePhoneInput, validateAddress, validateName, validatePan, validatePhone } from '@/lib/identityValidation'
import { buildPortableCompanyBackup, serializePortableBackup, validatePortableCompanyBackup, type PortableCompanyBackup } from '@/lib/portableBackup'

type RestoreProgress = {
  active: boolean
  startedAt: number
  completed: number
  total: number
  step: string
  detail: string
  counts: { label: string; value: number }[]
}

type SettingsSection = 'company' | 'vouchers' | 'data' | 'admins'

const portableCompanyFields = [
  'name', 'address', 'pan_vat', 'phone', 'vat_enabled', 'inventory_valuation_method',
  'sales_prefix', 'purchase_prefix', 'receipt_prefix', 'payment_prefix', 'sales_return_prefix',
  'purchase_return_prefix', 'journal_numbering_mode', 'reset_numbering_fiscal_year',
  'allow_admin_chronological_bypass', 'enforce_sales_invoice_chronology', 'print_format', 'show_company_details_on_sales_invoice', 'invoice_terms', 'payment_qr_text', 'logo_url', 'fiscal_year_start',
  'fiscal_year_configured',
] as const

function cleanCompanyBackup(company: unknown) {
  if (!company || typeof company !== 'object') return null
  const source = company as Record<string, unknown>
  return Object.fromEntries(portableCompanyFields.filter(field => field in source).map(field => [field, source[field]]))
}

function withoutMeta<T extends Record<string, unknown>>(row: T, omit: string[] = []) {
  const blocked = new Set(['created_at', 'updated_at', 'company', 'account', 'party', 'stock_qty', 'avg_cost', 'stock_value', ...omit])
  return Object.fromEntries(Object.entries(row).filter(([key]) => !blocked.has(key)))
}

function mapDeepIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') return idMap.get(value) || value
  if (Array.isArray(value)) return value.map(entry => mapDeepIds(entry, idMap))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, mapDeepIds(entry, idMap)]))
  return value
}

function samePortableName(a: unknown, b: unknown) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

function portableNameKey(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function portableScopedKey(...parts: unknown[]) {
  return parts.map(portableNameKey).join('::')
}

function portableNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function portablePositiveNumber(value: unknown, fallback: number) {
  const parsed = portableNumber(value, fallback)
  return parsed > 0 ? parsed : fallback
}

function portableRound(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function allocatePortableAmount(total: number, weight: number, used: number, isLast: boolean) {
  return isLast ? portableRound(total - used) : portableRound(total * weight)
}

function portableInvoiceItemsForRestore(voucher: Voucher, originalVoucher?: Voucher): InvoiceItem[] {
  if (voucher.invoice_items?.length) return voucher.invoice_items.map(item => ({
    ...item,
    amount: portableRound(portableNumber(item.amount, portableNumber(item.qty, 0) * portableNumber(item.rate, 0))),
  }))
  if (!['Sales', 'Purchase', 'Sales Return', 'Purchase Return'].includes(voucher.type) || !voucher.stock_lines?.length) return []

  const stockLines = voucher.stock_lines.filter(line => line.item_id)
  const originalItems = originalVoucher ? portableInvoiceItemsForRestore(originalVoucher) : []
  const quantityTotal = stockLines.reduce((sum, line) => sum + Math.abs(portableNumber(line.qty, 0)), 0)
  const sourceGrossTotal = stockLines.reduce((sum, line) => {
    const qty = Math.abs(portableNumber(line.qty, 0))
    const source = originalItems.find(item => item.item_id === line.item_id)
    return sum + qty * portableNumber(source?.rate, portableNumber(line.rate, 0))
  }, 0)
  const grossTotal = portableRound(sourceGrossTotal || portableNumber(voucher.subtotal, portableNumber(voucher.total, 0) - portableNumber(voucher.vat_amount, 0) + portableNumber(voucher.discount, 0)))
  const discountTotal = portableRound(portableNumber(voucher.discount, 0))
  const vatTotal = portableRound(portableNumber(voucher.vat_amount, 0))
  let usedGross = 0
  let usedDiscount = 0
  let usedVat = 0

  return stockLines.map((line, index) => {
    const qty = Math.abs(portableNumber(line.qty, 0))
    const source = originalItems.find(item => item.item_id === line.item_id)
    const isLast = index === stockLines.length - 1
    const weight = quantityTotal > 0 ? qty / quantityTotal : 1 / stockLines.length
    const gross = source ? portableRound(qty * portableNumber(source.rate, portableNumber(line.rate, 0))) : allocatePortableAmount(grossTotal, weight, usedGross, isLast)
    usedGross = portableRound(usedGross + gross)
    const discount = allocatePortableAmount(discountTotal, weight, usedDiscount, isLast)
    usedDiscount = portableRound(usedDiscount + discount)
    const taxable = portableRound(gross - discount)
    const vat = allocatePortableAmount(vatTotal, weight, usedVat, isLast)
    usedVat = portableRound(usedVat + vat)
    return {
      item_id: line.item_id,
      qty,
      rate: source ? portableNumber(source.rate, qty ? gross / qty : gross) : (qty ? gross / qty : gross),
      amount: gross,
      source_invoice_item_id: source?.id,
      entry_unit: line.item?.unit,
      unit: line.item?.unit,
      conversion_factor: 1,
      base_qty: qty,
      discount_amount: discount,
      taxable_amount: taxable,
      vat_amount: vat,
      cost_rate: portableNumber(line.rate, 0),
    }
  })
}

function portableVoucherSortValue(voucher: Voucher) {
  return [
    String(voucher.date_bs_key || 0).padStart(8, '0'),
    String(voucher.seq || 0).padStart(12, '0'),
    voucher.invoice_no || voucher.draft_no || voucher.id,
  ].join(':')
}

function lockedFiscalStartFromVouchers(companyFiscalStartBs: string, vouchers: Voucher[]) {
  if (!vouchers.length) return companyFiscalStartBs
  const monthDay = companyFiscalStartBs.slice(5)
  const earliestVoucher = [...vouchers]
    .filter(voucher => voucher.date_bs)
    .sort((left, right) => (left.date_bs_key || makeBsKey(left.date_bs)) - (right.date_bs_key || makeBsKey(right.date_bs)))[0]
  if (!earliestVoucher?.date_bs) return companyFiscalStartBs
  const voucherYear = Number(earliestVoucher.date_bs.slice(0, 4))
  const startYear = earliestVoucher.date_bs.slice(5) >= monthDay ? voucherYear : voucherYear - 1
  return `${startYear}-${monthDay}`
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return 'calculating...'
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function restorePercent(progress: RestoreProgress) {
  if (progress.total <= 0) return 0
  return Math.min(100, Math.round((progress.completed / progress.total) * 100))
}

function RestoreProgressBox({ progress }: { progress: RestoreProgress }) {
  const percent = restorePercent(progress)
  const elapsed = Date.now() - progress.startedAt
  const remaining = progress.completed > 0 ? (elapsed / progress.completed) * Math.max(0, progress.total - progress.completed) : 0
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
      <div className="flex gap-3">
        <div className="h-44 w-3 overflow-hidden rounded-full bg-background">
          <div className="w-full rounded-full bg-primary transition-all" style={{ height: `${percent}%`, marginTop: `${100 - percent}%` }} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Restoring portable backup</p>
              <p className="text-xs text-muted-foreground">{progress.step}</p>
            </div>
            <span className="num font-serif text-2xl font-bold text-primary">{percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div><span className="block text-muted-foreground">Progress</span><span className="font-semibold">{progress.completed} / {progress.total}</span></div>
            <div><span className="block text-muted-foreground">Elapsed</span><span className="font-semibold">{formatDuration(elapsed)}</span></div>
            <div><span className="block text-muted-foreground">Time left</span><span className="font-semibold">{progress.completed > 0 ? formatDuration(remaining) : 'calculating...'}</span></div>
          </div>
          {progress.detail && <p className="text-xs text-muted-foreground">{progress.detail}</p>}
          <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
            {progress.counts.map(row => <div key={row.label} className="flex justify-between gap-2"><span>{row.label}</span><span className="num font-semibold text-foreground">{row.value}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const {
    company, saveCompany, accounts, rawAccounts, accountCategories, vouchers, parties, items, itemCategories, companyModules, chequeBanks, cheques, loadAll, userId, error: loadError,
    addCompanyAdmin, addAccountCategory, addAccount, addParty, addItemCategory, addItem, saveDraftVoucher,
  } = useAppStore()
  const storedFiscalYearStartBs = company?.fiscal_year_start ? adToBs(company.fiscal_year_start) : DEFAULT_FISCAL_YEAR_START_BS
  const effectiveFiscalYearStartBs = vouchers.length ? lockedFiscalStartFromVouchers(storedFiscalYearStartBs, vouchers) : storedFiscalYearStartBs
  const [name, setName] = useState(company?.name ?? '')
  const [address, setAddress] = useState(company?.address ?? '')
  const [panVat, setPanVat] = useState(company?.pan_vat ?? '')
  const [phone, setPhone] = useState(company?.phone ?? '')
  const [vatEnabled, setVatEnabled] = useState(company?.vat_enabled ?? true)
  const [valuationMethod, setValuationMethod] = useState<InventoryValuationMethod>(company?.inventory_valuation_method || 'weighted_average')
  const [fiscalYearStartBs, setFiscalYearStartBs] = useState(effectiveFiscalYearStartBs)
  const [financialYear, setFinancialYear] = useState(effectiveFiscalYearStartBs.slice(0, 4))
  const [salesPrefix, setSalesPrefix] = useState(company?.sales_prefix ?? 'INV-')
  const [purchasePrefix, setPurchasePrefix] = useState(company?.purchase_prefix ?? 'PB-')
  const [receiptPrefix, setReceiptPrefix] = useState(company?.receipt_prefix ?? 'RCPT-')
  const [paymentPrefix, setPaymentPrefix] = useState(company?.payment_prefix ?? 'PAY-')
  const [salesReturnPrefix, setSalesReturnPrefix] = useState(company?.sales_return_prefix ?? 'SR-')
  const [purchaseReturnPrefix, setPurchaseReturnPrefix] = useState(company?.purchase_return_prefix ?? 'PR-')
  const [journalNumberingMode, setJournalNumberingMode] = useState<'auto' | 'manual'>(company?.journal_numbering_mode ?? 'auto')
  const [allowAdminChronologicalBypass, setAllowAdminChronologicalBypass] = useState(company?.allow_admin_chronological_bypass ?? false)
  const [enforceSalesInvoiceChronology, setEnforceSalesInvoiceChronology] = useState(company?.enforce_sales_invoice_chronology ?? false)
  const [printFormat, setPrintFormat] = useState(company?.print_format ?? 'A5')
  const [showCompanyDetailsOnSalesInvoice, setShowCompanyDetailsOnSalesInvoice] = useState(company?.show_company_details_on_sales_invoice ?? true)
  const [invoiceTerms, setInvoiceTerms] = useState(company?.invoice_terms ?? '')
  const [paymentQrText, setPaymentQrText] = useState(company?.payment_qr_text ?? '')
  const [logoUrl, setLogoUrl] = useState(company?.logo_url ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [restoreMessage, setRestoreMessage] = useState('')
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberSaving, setMemberSaving] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [importModule, setImportModule] = useState<ImportModule>('account-groups')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [importError, setImportError] = useState('')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('company')
  const fiscalYearStartAd = parseBsDate(fiscalYearStartBs) ? bsToAd(fiscalYearStartBs) : ''
  const fiscalYearLocked = vouchers.length > 0
  const currentFiscalYear = Number(currentFiscalYearStartBs(company).slice(0, 4))
  const selectedStartYear = Number(financialYear) || currentFiscalYear
  const financialYearOptions = Array.from({ length: currentFiscalYear - Math.min(currentFiscalYear - 50, selectedStartYear) + 1 }, (_, index) => currentFiscalYear - index).map(year => ({
    value: String(year),
    label: `${String(year).slice(-2)}/${String(year + 1).slice(-2)}`,
  }))
  const selectedImportTemplate = templateFor(importModule)
  const importContext = useMemo(() => ({
    company: company!,
    accounts: rawAccounts.length ? rawAccounts : accounts,
    accountCategories,
    parties,
    items,
    itemCategories,
    addAccountCategory,
    addAccount,
    addParty,
    addItemCategory,
    addItem,
    saveDraftVoucher,
  }), [company, rawAccounts, accounts, accountCategories, parties, items, itemCategories, addAccountCategory, addAccount, addParty, addItemCategory, addItem, saveDraftVoucher])

  useEffect(() => {
    setName(company?.name ?? '')
    setAddress(company?.address ?? '')
    setPanVat(company?.pan_vat ?? '')
    setPhone(company?.phone ?? '')
    setVatEnabled(company?.vat_enabled ?? true)
    setValuationMethod(company?.inventory_valuation_method || 'weighted_average')
    setFiscalYearStartBs(effectiveFiscalYearStartBs)
    setFinancialYear(effectiveFiscalYearStartBs.slice(0, 4))
    setSalesPrefix(company?.sales_prefix ?? 'INV-')
    setPurchasePrefix(company?.purchase_prefix ?? 'PB-')
    setReceiptPrefix(company?.receipt_prefix ?? 'RCPT-')
    setPaymentPrefix(company?.payment_prefix ?? 'PAY-')
    setSalesReturnPrefix(company?.sales_return_prefix ?? 'SR-')
    setPurchaseReturnPrefix(company?.purchase_return_prefix ?? 'PR-')
    setJournalNumberingMode(company?.journal_numbering_mode ?? 'auto')
    setAllowAdminChronologicalBypass(company?.allow_admin_chronological_bypass ?? false)
    setEnforceSalesInvoiceChronology(company?.enforce_sales_invoice_chronology ?? false)
    setPrintFormat(company?.print_format ?? 'A5')
    setShowCompanyDetailsOnSalesInvoice(company?.show_company_details_on_sales_invoice ?? true)
    setInvoiceTerms(company?.invoice_terms ?? '')
    setPaymentQrText(company?.payment_qr_text ?? '')
    setLogoUrl(company?.logo_url ?? '')
  }, [company, effectiveFiscalYearStartBs])

  const handleSave = async () => {
    setSaveError('')
    setRestoreMessage('')
    if (!fiscalYearStartAd) {
      setSaveError('Enter fiscal year start in YYYY-MM-DD BS format.')
      return
    }
    if (fiscalYearStartBs.slice(0, 4) !== financialYear) {
      setSaveError('Financial Year and Financial Year Start Date must begin in the same B.S. year.')
      return
    }
    if (!isSafePublicImageUrl(logoUrl.trim())) {
      setSaveError('Company logo must be a valid HTTPS image URL without embedded credentials.')
      return
    }
    if (valuationMethod !== (company?.inventory_valuation_method || 'weighted_average') && !window.confirm('Changing the inventory valuation method will recalculate all historical stock values and may change Profit & Loss and Balance Sheet totals. Continue?')) return
    const formattedName = formatMasterName(name) || 'My Company'
    setName(formattedName)
    const identityError = validateName(formattedName, 'Company name') || validateAddress(address) || validatePan(panVat) || validatePhone(phone)
    if (identityError) { setSaveError(identityError); return }
    setSaving(true)
    try {
      await saveCompany({
        name: formattedName,
        address: address.trim(),
        pan_vat: panVat.trim(),
        phone: phone.trim(),
        vat_enabled: vatEnabled,
        inventory_valuation_method: valuationMethod,
        fiscal_year_start: fiscalYearStartAd,
        fiscal_year_configured: true,
        sales_prefix: salesPrefix.trim() || 'INV-',
        purchase_prefix: purchasePrefix.trim() || 'PB-',
        receipt_prefix: receiptPrefix.trim() || 'RCPT-',
        payment_prefix: paymentPrefix.trim() || 'PAY-',
        sales_return_prefix: salesReturnPrefix.trim() || 'SR-',
        purchase_return_prefix: purchaseReturnPrefix.trim() || 'PR-',
        journal_numbering_mode: journalNumberingMode,
        reset_numbering_fiscal_year: true,
        allow_admin_chronological_bypass: allowAdminChronologicalBypass,
        enforce_sales_invoice_chronology: enforceSalesInvoiceChronology,
        print_format: printFormat,
        show_company_details_on_sales_invoice: showCompanyDetailsOnSalesInvoice,
        invoice_terms: invoiceTerms.trim(),
        payment_qr_text: paymentQrText.trim(),
        logo_url: logoUrl.trim(),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setSaveError(identityDatabaseError(e) || publicErrorMessage(e, 'saving settings'))
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    const data = buildPortableCompanyBackup({
      company,
      accountCategories,
      itemCategories,
      accounts: rawAccounts.length ? rawAccounts : accounts,
      parties,
      items,
      vouchers,
      companyModules,
      chequeBanks,
      cheques,
    })
    const blob = new Blob([serializePortableBackup(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `khata-portable-company-backup-${todayISO()}.json`
    a.click()
    URL.revokeObjectURL(url)
    logAppEvent('export_portable_company_backup', company?.id, { vouchers: vouchers.length, parties: parties.length, items: items.length })
  }

  const handleClosingSnapshot = () => {
    const data = {
      company,
      fiscal_year_start: company?.fiscal_year_start,
      closed_at: new Date().toISOString(),
      account_balances: accounts.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        group: a.group,
        balance: a.balance,
      })),
      stock_balances: useAppStore.getState().stock,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `khata-closing-snapshot-${todayISO()}.json`
    a.click()
    URL.revokeObjectURL(url)
    logAppEvent('export_closing_snapshot', company?.id, { accounts: accounts.length })
  }

  const handleRestore = async (file: File | undefined) => {
    if (!file || !userId || !company) return
    const fileError = backupFileValidationError(file)
    if (fileError) {
      setRestoreProgress(null)
      setRestoreMessage(fileError)
      return
    }
    const restoreStartedAt = Date.now()
    let completedStages = 0
    let totalStages = 1
    let restoreCounts: RestoreProgress['counts'] = []
    const showRestoreProgress = (step: string, detail = '', completed = completedStages) => {
      setRestoreProgress({
        active: true,
        startedAt: restoreStartedAt,
        completed,
        total: totalStages,
        step,
        detail,
        counts: restoreCounts,
      })
    }
    const finishRestoreStage = (step: string, detail = '') => {
      completedStages = Math.min(totalStages, completedStages + 1)
      showRestoreProgress(step, detail, completedStages)
    }
    setRestoreMessage('')
    showRestoreProgress('Reading backup file', 'Checking the JSON backup before importing.')
    try {
      const text = await file.text()
      const backup = JSON.parse(text) as PortableCompanyBackup
      validatePortableCompanyBackup(backup)

      const targetHasData = vouchers.length > 0
      if (targetHasData) throw new Error('Portable company restore cannot be imported into a company that already has vouchers. Create a new company first, then restore this backup there.')
      if (!window.confirm('Restore this portable backup into the active company? Existing company settings may be updated. Continue?')) {
        setRestoreProgress(null)
        return
      }

      const sourceAccountCategories = Array.isArray(backup.accountCategories) ? backup.accountCategories : Array.isArray(backup.account_categories) ? backup.account_categories : []
      const sourceItemCategories = Array.isArray(backup.itemCategories) ? backup.itemCategories : Array.isArray(backup.item_categories) ? backup.item_categories : []
      const sourceAccounts = Array.isArray(backup.accounts) ? backup.accounts : []
      const sourceParties = Array.isArray(backup.parties) ? backup.parties : []
      const sourceItems = Array.isArray(backup.items) ? backup.items : []
      const sourceVouchers = Array.isArray(backup.vouchers) ? backup.vouchers : []
      const sourceCompanyModules = Array.isArray(backup.companyModules) ? backup.companyModules as (CompanyModule & { module_key?: string })[] : []
      const sourceChequeBanks = Array.isArray(backup.chequeBanks) ? backup.chequeBanks : []
      const sourceCheques = Array.isArray(backup.cheques) ? backup.cheques : []
      const orderedSourceVouchers = [...sourceVouchers].sort((a, b) => portableVoucherSortValue(a).localeCompare(portableVoucherSortValue(b)))
      const sourceVoucherById = new Map(sourceVouchers.map(voucher => [voucher.id, voucher]))
      const sourceVoucherLineCount = orderedSourceVouchers.reduce((sum, voucher) => sum + (voucher.lines?.length || 0), 0)
      const sourceStockLineCount = orderedSourceVouchers.reduce((sum, voucher) => sum + (voucher.stock_lines?.length || 0), 0)
      const sourceInvoiceItemCount = orderedSourceVouchers.reduce((sum, voucher) => sum + portableInvoiceItemsForRestore(voucher, voucher.original_voucher_id ? sourceVoucherById.get(voucher.original_voucher_id) : undefined).length, 0)
      restoreCounts = [
        { label: 'Account groups', value: sourceAccountCategories.length },
        { label: 'Item groups', value: sourceItemCategories.length },
        { label: 'Ledgers', value: sourceAccounts.length },
        { label: 'Parties', value: sourceParties.length },
        { label: 'Items', value: sourceItems.length },
        { label: 'Vouchers', value: sourceVouchers.length },
        { label: 'Voucher lines', value: sourceVoucherLineCount },
        { label: 'Stock lines', value: sourceStockLineCount },
        { label: 'Invoice items', value: sourceInvoiceItemCount },
        { label: 'Settlements', value: orderedSourceVouchers.reduce((sum, voucher) => sum + (voucher.settlements?.length || 0), 0) },
        { label: 'Cheque banks', value: sourceChequeBanks.length },
        { label: 'Cheques', value: sourceCheques.length },
      ]
      totalStages = 19
      finishRestoreStage('Backup read', 'Preparing fresh IDs for the active company.')
      showRestoreProgress('Updating company settings', 'Applying fiscal-year and company settings before importing vouchers.')
      const companyUpdates = cleanCompanyBackup(backup.company)
      if (companyUpdates) await saveCompany({ ...companyUpdates, inventory_valuation_method: companyUpdates.inventory_valuation_method || 'weighted_average' })
      finishRestoreStage('Company settings updated', companyUpdates ? 'Company settings were updated from the backup.' : 'No company settings were changed.')
      const targetAccounts = rawAccounts.length ? rawAccounts : accounts
      const idMap = new Map<string, string>()
      const accountCategoryIdByKey = new Map(accountCategories.map(category => [portableScopedKey(category.account_type, category.name), category.id]))
      const itemCategoryIdByKey = new Map(itemCategories.map(category => [portableNameKey(category.name), category.id]))
      const accountIdByKey = new Map(targetAccounts.map(account => [portableScopedKey(account.type, account.name), account.id]))
      const itemIdByKey = new Map(items.map(item => [portableNameKey(item.name), item.id]))
      const partyIdByKey = new Map(parties.map(party => [portableScopedKey(party.type, party.name), party.id]))

      showRestoreProgress('Mapping existing system records', 'Reusing matching default ledgers and groups where possible.')
      for (const category of sourceAccountCategories) {
        const targetId = accountCategoryIdByKey.get(portableScopedKey(category.account_type, category.name))
        if (targetId) idMap.set(category.id, targetId)
      }
      for (const category of sourceItemCategories.filter(category => !category.is_archived)) {
        const targetId = itemCategoryIdByKey.get(portableNameKey(category.name))
        if (targetId) idMap.set(category.id, targetId)
      }
      for (const account of sourceAccounts) {
        const targetId = accountIdByKey.get(portableScopedKey(account.type, account.name))
        if (targetId) idMap.set(account.id, targetId)
      }
      for (const item of sourceItems) {
        const targetId = itemIdByKey.get(portableNameKey(item.name))
        if (targetId) idMap.set(item.id, targetId)
      }
      for (const party of sourceParties) {
        const targetId = partyIdByKey.get(portableScopedKey(party.type, party.name))
        if (targetId) idMap.set(party.id, targetId)
      }
      finishRestoreStage('Existing records mapped', `${idMap.size} reference(s) are ready for import.`)

      showRestoreProgress('Importing account groups', 'Creating missing account group hierarchy.')
      const accountCategoryRows: Record<string, unknown>[] = []
      const pendingAccountCategories = sourceAccountCategories.filter(category => !category.is_system && !idMap.has(category.id))
      while (pendingAccountCategories.length) {
        const readyIndex = pendingAccountCategories.findIndex(category => !category.parent_category_id || idMap.has(category.parent_category_id))
        if (readyIndex < 0) throw new Error('Could not resolve account group hierarchy in the backup.')
        const category = pendingAccountCategories.splice(readyIndex, 1)[0]
        const categoryKey = portableScopedKey(category.account_type, category.name)
        const existingCategoryId = accountCategoryIdByKey.get(categoryKey)
        if (existingCategoryId) {
          idMap.set(category.id, existingCategoryId)
          continue
        }
        const nextId = crypto.randomUUID()
        idMap.set(category.id, nextId)
        accountCategoryIdByKey.set(categoryKey, nextId)
        accountCategoryRows.push({ ...withoutMeta(category as unknown as Record<string, unknown>), id: nextId, company_id: company.id, parent_category_id: category.parent_category_id ? idMap.get(category.parent_category_id) || null : null })
      }
      if (accountCategoryRows.length) {
        const { error } = await supabase.from('account_categories').insert(accountCategoryRows)
        if (error) throw error
      }
      finishRestoreStage('Account groups imported', `${accountCategoryRows.length} new account group(s) created.`)

      showRestoreProgress('Importing item groups', 'Creating missing item category hierarchy.')
      const itemCategoryRows: Record<string, unknown>[] = []
      const pendingItemCategories = sourceItemCategories.filter(category => !idMap.has(category.id))
      while (pendingItemCategories.length) {
        const readyIndex = pendingItemCategories.findIndex(category => !category.parent_category_id || idMap.has(category.parent_category_id))
        if (readyIndex < 0) throw new Error('Could not resolve item category hierarchy in the backup.')
        const category = pendingItemCategories.splice(readyIndex, 1)[0]
        const categoryKey = portableNameKey(category.name)
        const existingCategoryId = itemCategoryIdByKey.get(categoryKey)
        if (existingCategoryId) {
          idMap.set(category.id, existingCategoryId)
          continue
        }
        const nextId = crypto.randomUUID()
        idMap.set(category.id, nextId)
        itemCategoryIdByKey.set(categoryKey, nextId)
        itemCategoryRows.push({ ...withoutMeta(category as unknown as Record<string, unknown>), id: nextId, company_id: company.id, parent_category_id: category.parent_category_id ? idMap.get(category.parent_category_id) || null : null })
      }
      if (itemCategoryRows.length) {
        const { error } = await supabase.from('item_categories').insert(itemCategoryRows)
        if (error) throw error
      }
      finishRestoreStage('Item groups imported', `${itemCategoryRows.length} new item group(s) created.`)

      showRestoreProgress('Importing ledgers', 'Creating non-system accounts with remapped groups.')
      const accountRows = sourceAccounts.filter(account => !account.is_system && !idMap.has(account.id)).flatMap(account => {
        const accountKey = portableScopedKey(account.type, account.name)
        const existingAccountId = accountIdByKey.get(accountKey)
        if (existingAccountId) {
          idMap.set(account.id, existingAccountId)
          return []
        }
        const nextId = crypto.randomUUID()
        idMap.set(account.id, nextId)
        accountIdByKey.set(accountKey, nextId)
        return [{ ...withoutMeta(account as unknown as Record<string, unknown>, ['balance']), id: nextId, company_id: company.id, category_id: account.category_id ? idMap.get(account.category_id) || null : null }]
      })
      if (accountRows.length) {
        const { error } = await supabase.from('accounts').insert(accountRows)
        if (error) throw error
      }
      finishRestoreStage('Ledgers imported', `${accountRows.length} new ledger(s) created.`)

      showRestoreProgress('Importing items', 'Creating stock and service items with fresh IDs.')
      const itemRows = sourceItems.filter(item => !idMap.has(item.id)).flatMap(item => {
        const itemKey = portableNameKey(item.name)
        const existingItemId = itemIdByKey.get(itemKey)
        if (existingItemId) {
          idMap.set(item.id, existingItemId)
          return []
        }
        const nextId = crypto.randomUUID()
        idMap.set(item.id, nextId)
        itemIdByKey.set(itemKey, nextId)
        return [{ ...withoutMeta(item as unknown as Record<string, unknown>), id: nextId, company_id: company.id, category_id: item.category_id ? idMap.get(item.category_id) || null : null }]
      })
      if (itemRows.length) {
        const { error } = await supabase.from('items').insert(itemRows)
        if (error) throw error
      }
      finishRestoreStage('Items imported', `${itemRows.length} new item(s) created.`)

      showRestoreProgress('Importing parties', 'Creating customers and suppliers with remapped ledgers.')
      const partyRows = sourceParties.filter(party => !idMap.has(party.id)).flatMap(party => {
        const partyKey = portableScopedKey(party.type, party.name)
        const existingPartyId = partyIdByKey.get(partyKey)
        if (existingPartyId) {
          idMap.set(party.id, existingPartyId)
          return []
        }
        const nextId = crypto.randomUUID()
        idMap.set(party.id, nextId)
        partyIdByKey.set(partyKey, nextId)
        return [{ ...withoutMeta(party as unknown as Record<string, unknown>, ['account']), id: nextId, company_id: company.id, account_id: idMap.get(party.account_id) || party.account_id }]
      })
      if (partyRows.length) {
        const { error } = await supabase.from('parties').insert(partyRows)
        if (error) throw error
      }
      finishRestoreStage('Parties imported', `${partyRows.length} new party record(s) created.`)

      showRestoreProgress('Importing voucher headers', 'Saving vouchers safely before attaching lines.')
      const voucherRows = orderedSourceVouchers.map(voucher => {
        const nextId = crypto.randomUUID()
        idMap.set(voucher.id, nextId)
        return {
          ...withoutMeta(voucher as unknown as Record<string, unknown>, ['lines', 'stock_lines', 'invoice_items', 'settlements', 'party']),
          id: nextId,
          company_id: company.id,
          original_voucher_id: null,
          settlement_account_id: voucher.settlement_account_id ? idMap.get(voucher.settlement_account_id) || null : null,
          contra_destination_account_id: voucher.contra_destination_account_id ? idMap.get(voucher.contra_destination_account_id) || null : null,
          party_account_id: voucher.party_account_id ? idMap.get(voucher.party_account_id) || null : null,
          created_by: null,
          updated_by: null,
          completed_by: null,
          completed_at: null,
          status: 'Draft',
          draft_payload: mapDeepIds(voucher.draft_payload || null, idMap),
        }
      })
      if (voucherRows.length) {
        const { error } = await supabase.from('vouchers').insert(voucherRows)
        if (error) throw error
      }
      finishRestoreStage('Voucher headers imported', `${voucherRows.length} voucher header(s) created.`)

      showRestoreProgress('Linking related vouchers', 'Restoring return and source voucher references.')
      const voucherUpdates = orderedSourceVouchers
        .filter(voucher => voucher.original_voucher_id && idMap.has(voucher.original_voucher_id))
        .map(voucher => supabase.from('vouchers').update({ original_voucher_id: idMap.get(voucher.original_voucher_id!) }).eq('id', idMap.get(voucher.id)!))
      for (const update of voucherUpdates) {
        const { error } = await update
        if (error) throw error
      }
      finishRestoreStage('Voucher links restored', `${voucherUpdates.length} voucher link(s) updated.`)

      showRestoreProgress('Importing ledger lines', 'Attaching debit and credit rows to vouchers.')
      const voucherLineRows = orderedSourceVouchers.flatMap(voucher => (voucher.lines || []).map(line => ({ ...withoutMeta(line as unknown as Record<string, unknown>), id: crypto.randomUUID(), voucher_id: idMap.get(voucher.id), account_id: idMap.get(line.account_id) || line.account_id })))
      if (voucherLineRows.length) {
        const { error } = await supabase.from('voucher_lines').insert(voucherLineRows)
        if (error) throw error
      }
      finishRestoreStage('Ledger lines imported', `${voucherLineRows.length} voucher line(s) created.`)

      showRestoreProgress('Importing stock lines', 'Restoring inventory movement rows for stock items.')
      const stockLineRows = orderedSourceVouchers.flatMap(voucher => (voucher.stock_lines || []).map(line => ({ ...withoutMeta(line as unknown as Record<string, unknown>), id: crypto.randomUUID(), voucher_id: idMap.get(voucher.id), item_id: idMap.get(line.item_id) || line.item_id })))
      if (stockLineRows.length) {
        const { error } = await supabase.from('stock_lines').insert(stockLineRows)
        if (error) throw error
      }
      finishRestoreStage('Stock lines imported', `${stockLineRows.length} stock line(s) created.`)

      showRestoreProgress('Importing invoice items', 'Restoring invoice item details and source links.')
      const invoiceItemIdMap = new Map<string, string>()
      const invoiceItemPlans = orderedSourceVouchers.flatMap(voucher => portableInvoiceItemsForRestore(voucher, voucher.original_voucher_id ? sourceVoucherById.get(voucher.original_voucher_id) : undefined).map((item, lineIndex) => {
        const nextId = crypto.randomUUID()
        if (item.id) invoiceItemIdMap.set(item.id, nextId)
        const conversionFactor = portablePositiveNumber(item.conversion_factor, 1)
        const qty = portableNumber(item.qty, 0)
        const baseQty = qty / conversionFactor
        const row = {
          ...withoutMeta(item as unknown as Record<string, unknown>),
          id: nextId,
          voucher_id: idMap.get(voucher.id),
          item_id: idMap.get(item.item_id) || item.item_id,
          qty,
          amount: portableRound(portableNumber(item.amount, qty * portableNumber(item.rate, 0))),
          conversion_factor: conversionFactor,
          base_qty: baseQty,
          source_invoice_item_id: null,
        }
        return { voucher, item, lineIndex, row }
      }))
      const invoiceItemRows = invoiceItemPlans.map(plan => plan.row)
      if (invoiceItemRows.length) {
        const { error } = await supabase.from('invoice_items').insert(invoiceItemRows)
        if (error) throw error
      }
      for (const plan of invoiceItemPlans) {
        if (!['Sales Return', 'Purchase Return'].includes(plan.voucher.type) || !plan.voucher.original_voucher_id) continue
        const originalVoucher = sourceVoucherById.get(plan.voucher.original_voucher_id)
        const sourcePlan = invoiceItemPlans.find(source =>
          source.voucher.id === originalVoucher?.id &&
          source.row.item_id === plan.row.item_id &&
          Math.abs(portableNumber(source.row.rate, 0) - portableNumber(plan.row.rate, 0)) <= 0.000001
        )
        const sourceIdFromBackup = plan.item.source_invoice_item_id ? invoiceItemIdMap.get(plan.item.source_invoice_item_id) : null
        const sourceInvoiceItemId = sourcePlan?.row.id || sourceIdFromBackup
        if (sourceInvoiceItemId) {
          const { error } = await supabase.from('invoice_items').update({ source_invoice_item_id: sourceInvoiceItemId }).eq('id', plan.row.id as string)
          if (error) throw error
        }
      }
      finishRestoreStage('Invoice items imported', `${invoiceItemRows.length} invoice item(s) created.`)

      showRestoreProgress('Importing settlements', 'Restoring Receipt and Payment invoice allocations.')
      const settlementRows = orderedSourceVouchers.flatMap(voucher => (voucher.settlements || []).map(settlement => ({
        ...withoutMeta(settlement as unknown as Record<string, unknown>),
        id: crypto.randomUUID(), company_id: company.id,
        settlement_voucher_id: idMap.get(settlement.settlement_voucher_id) || idMap.get(voucher.id),
        invoice_voucher_id: idMap.get(settlement.invoice_voucher_id) || settlement.invoice_voucher_id,
        party_account_id: idMap.get(settlement.party_account_id) || settlement.party_account_id,
      })))
      if (settlementRows.length) { const { error } = await supabase.from('voucher_settlements').insert(settlementRows); if (error) throw error }
      finishRestoreStage('Settlements imported', `${settlementRows.length} allocation(s) restored.`)

      showRestoreProgress('Restoring modules', 'Applying portable company module configuration.')
      const { data: targetModules, error: moduleFetchError } = await supabase.from('modules').select('id,key')
      if (moduleFetchError) throw moduleFetchError
      const moduleIdByKey = new Map((targetModules || []).map(module => [module.key as string, module.id as string]))
      let restoredModules = 0
      for (const sourceModule of sourceCompanyModules) {
        const moduleId = sourceModule.module_key ? moduleIdByKey.get(sourceModule.module_key) : sourceModule.module_id
        if (!moduleId) continue
        const row = withoutMeta(sourceModule as unknown as Record<string, unknown>, ['module', 'module_key', 'internal_notes', 'enabled_by'])
        delete row.id
        const { error } = await supabase.from('company_modules').upsert({ ...row, company_id: company.id, module_id: moduleId, enabled_by: null }, { onConflict: 'company_id,module_id' })
        if (error) throw error
        restoredModules += 1
      }
      finishRestoreStage('Modules restored', `${restoredModules} module configuration(s) applied.`)

      showRestoreProgress('Restoring cheque banks', 'Reusing seeded banks and restoring company bank metadata.')
      const { data: targetChequeBanks, error: bankFetchError } = await supabase.from('cheque_banks').select('id,bank_name').eq('company_id', company.id)
      if (bankFetchError && sourceChequeBanks.length) throw bankFetchError
      const bankIdByName = new Map((targetChequeBanks || []).map(bank => [String(bank.bank_name).trim().toLocaleLowerCase(), String(bank.id)]))
      for (const sourceBank of sourceChequeBanks) {
        const key = sourceBank.bank_name.trim().toLocaleLowerCase()
        let targetId = bankIdByName.get(key)
        const bankRow = { ...withoutMeta(sourceBank as unknown as Record<string, unknown>, ['created_by', 'updated_by']), company_id: company.id, ledger_account_id: sourceBank.ledger_account_id ? idMap.get(sourceBank.ledger_account_id) || null : null, created_by: null, updated_by: null }
        if (targetId) {
          delete bankRow.id
          const { error } = await supabase.from('cheque_banks').update(bankRow).eq('id', targetId); if (error) throw error
        } else {
          targetId = crypto.randomUUID(); bankRow.id = targetId
          const { error } = await supabase.from('cheque_banks').insert(bankRow); if (error) throw error
          bankIdByName.set(key, targetId)
        }
        idMap.set(sourceBank.id, targetId)
      }
      finishRestoreStage('Cheque banks restored', `${sourceChequeBanks.length} bank record(s) mapped.`)

      showRestoreProgress('Restoring cheques', 'Restoring incoming and outgoing cheque records and voucher links.')
      const chequeRows = sourceCheques.map(sourceCheque => ({
        ...withoutMeta(sourceCheque as unknown as Record<string, unknown>, ['created_by', 'updated_by']),
        id: crypto.randomUUID(), company_id: company.id,
        bank_id: sourceCheque.bank_id ? idMap.get(sourceCheque.bank_id) || null : null,
        source_account_id: sourceCheque.source_account_id ? idMap.get(sourceCheque.source_account_id) || null : null,
        party_ledger_id: idMap.get(sourceCheque.party_ledger_id) || sourceCheque.party_ledger_id,
        linked_voucher_id: sourceCheque.linked_voucher_id ? idMap.get(sourceCheque.linked_voucher_id) || null : null,
        cleared_to_account_id: sourceCheque.cleared_to_account_id ? idMap.get(sourceCheque.cleared_to_account_id) || null : null,
        created_by: null, updated_by: null,
      }))
      if (chequeRows.length) { const { error } = await supabase.from('cheques').insert(chequeRows); if (error) throw error }
      finishRestoreStage('Cheques restored', `${chequeRows.length} cheque(s) imported. Audit events are recreated by the cheque subsystem.`)

      showRestoreProgress('Restoring voucher status', 'Completing imported vouchers in date and serial order.')
      for (const voucher of orderedSourceVouchers.filter(voucher => voucher.status !== 'Draft')) {
        const { error } = await supabase
          .from('vouchers')
          .update({ status: voucher.status || 'Completed', completed_at: voucher.completed_at || new Date().toISOString() })
          .eq('id', idMap.get(voucher.id)!)
        if (error) {
          throw new Error(`Could not restore completed status for ${voucher.type} ${voucher.invoice_no || voucher.draft_no || voucher.id}: ${error.message}`)
        }
      }
      finishRestoreStage('Voucher statuses restored', 'Completed vouchers were restored in serial order.')

      showRestoreProgress('Reloading company data', 'Refreshing the active company after import.')
      await loadAll(userId)
      finishRestoreStage('Restore complete', 'Imported data is now loaded in this company.')
      logAppEvent('restore_portable_company_backup', company.id, { vouchers: sourceVouchers.length, parties: sourceParties.length, items: sourceItems.length })
      setRestoreMessage('Portable company backup restored with fresh IDs for this company.')
      window.setTimeout(() => setRestoreProgress(null), 3000)
    } catch (e: unknown) {
      setRestoreProgress(current => current ? { ...current, active: false, step: 'Restore failed', detail: 'Fix the reported issue and try again.' } : null)
      setRestoreMessage(publicErrorMessage(e, 'restoring backup'))
    }
  }

  const handleAddCompanyAdmin = async () => {
    setMemberError('')
    const email = memberEmail.trim()
    if (!email) {
      setMemberError('Enter an existing user email address.')
      return
    }
    setMemberSaving(true)
    try {
      await addCompanyAdmin(email)
      setMemberEmail('')
    } catch (error: unknown) {
      setMemberError(publicErrorMessage(error, 'adding company admin'))
    } finally {
      setMemberSaving(false)
    }
  }

  const handleDownloadImportTemplate = () => {
    if (!company) return
    downloadImportTemplate(importModule, importContext)
    logAppEvent('download_import_template', company.id, { module: importModule })
  }

  const handleImportFile = async (file: File | undefined) => {
    setImportPreview(null)
    setImportMessage('')
    setImportError('')
    setImportFileName(file?.name || '')
    if (!file || !company) return
    try {
      const preview = await previewImportWorkbook(file, importModule, importContext)
      setImportPreview(preview)
      logAppEvent('preview_import_data', company.id, { module: importModule, rows: preview.totalRows, errors: preview.errors.length, warnings: preview.warnings.length })
    } catch (error: unknown) {
      setImportError(publicErrorMessage(error, 'previewing import file'))
    }
  }

  const handleRunImport = async () => {
    if (!company || !userId || !importPreview || importPreview.errors.length) return
    setImporting(true)
    setImportError('')
    setImportMessage('')
    try {
      const result = await executeImport(importPreview, importContext)
      await loadAll(userId)
      logAppEvent('import_data_completed', company.id, { module: importModule, created: result.created, skipped: result.skipped, vouchers: result.vouchers })
      setImportMessage(result.vouchers
        ? `Imported ${result.vouchers} draft voucher(s). Review them from Draft Vouchers before completing.`
        : `Imported ${result.created} row(s). ${result.skipped ? `${result.skipped} duplicate row(s) skipped.` : ''}`)
      setImportPreview(null)
      setImportFileName('')
    } catch (error: unknown) {
      setImportError(publicErrorMessage(error, 'importing data'))
    } finally {
      setImporting(false)
    }
  }

  const handleDownloadImportIssues = () => {
    if (!importPreview) return
    const rows = [
      ['Type', 'Row', 'Field', 'Message'],
      ...importPreview.errors.map(issue => ['Error', issue.row, issue.field || '', issue.message]),
      ...importPreview.warnings.map(issue => ['Warning', issue.row, issue.field || '', issue.message]),
    ]
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `khata-import-${importModule}-issues.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader title="Settings" description="Company details and data management" />
      <PageContent className="max-w-none">
        <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="navigation" aria-label="Settings sections">
          {([
            ['company', 'Company Details', Building2],
            ['vouchers', 'Voucher Config', ReceiptText],
            ['data', 'Data', Database],
            ['admins', 'Company Admin', Users],
          ] as const).map(([value, label, Icon]) => (
            <Button key={value} type="button" variant={settingsSection === value ? 'default' : 'outline'} className="justify-start" onClick={() => setSettingsSection(value)} aria-current={settingsSection === value ? 'page' : undefined}>
              <Icon className="mr-2 h-4 w-4" />{label}
            </Button>
          ))}
        </div>
        <div className="mx-auto max-w-5xl space-y-5">
        <Card className={settingsSection === 'admins' ? '' : 'hidden'}>
          <CardHeader><CardTitle className="text-base">Account Diagnostic</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>Supabase project: <span className="font-mono text-foreground">{supabaseProjectHost || 'Not configured'}</span></p>
            <p>Authentication: <span className="font-semibold text-foreground">{userId ? 'Signed in' : 'Not loaded'}</span></p>
            <p>Company data: <span className="font-semibold text-foreground">{company ? 'Loaded' : 'Not loaded'}</span></p>
            {loadError && <p className="text-destructive">Load error: <span className="font-mono">{loadError}</span></p>}
          </CardContent>
        </Card>

        <Card className={settingsSection === 'company' || settingsSection === 'vouchers' ? '' : 'hidden'}>
          <CardHeader><CardTitle className="text-base">{settingsSection === 'company' ? 'Company Details' : 'Voucher Configuration'}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className={settingsSection === 'company' ? 'space-y-4' : 'hidden'}>
            <div className="space-y-1.5">
              <Label>Company Name</Label>
              <Input value={name} maxLength={IDENTITY_LIMITS.name} onChange={e => setName(e.target.value)} onBlur={() => setName(current => formatMasterName(current))} placeholder="My Trading Co." />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Textarea value={address} maxLength={IDENTITY_LIMITS.address} onChange={e => setAddress(e.target.value)} rows={2} placeholder="Kathmandu, Nepal" />
            </div>
            <div className="space-y-1.5">
              <Label>PAN / VAT Registration No.</Label>
              <Input value={panVat} inputMode="numeric" maxLength={9} onChange={e => setPanVat(normalizePanInput(e.target.value))} placeholder="Optional, 9 digits" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input type="tel" inputMode="numeric" maxLength={10} value={phone} onChange={e => setPhone(normalizePhoneInput(e.target.value))} placeholder="Optional, 10 digits" />
            </div>
            <label htmlFor="settings-vat-enabled" className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer">
              <input
                id="settings-vat-enabled"
                type="checkbox"
                checked={vatEnabled}
                onChange={e => setVatEnabled(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">VAT Mode</span>
                <span className="block text-xs text-muted-foreground">
                  {vatEnabled ? 'Invoices include VAT and VAT reports are available.' : 'Internal bookkeeping mode hides VAT fields and reports.'}
                </span>
              </span>
            </label>
            <div className="space-y-1.5">
              <Label>Financial Year</Label>
              <SearchableSelect value={financialYear} disabled={fiscalYearLocked} onValueChange={value => {
                setFinancialYear(value)
                setFiscalYearStartBs(`${value}-${fiscalYearStartBs.slice(5)}`)
              }} options={financialYearOptions} searchPlaceholder="Search financial year…" />
            </div>
            <div className="space-y-1.5">
              <Label>Financial Year Start Date (BS)</Label>
              <NepaliDateInput value={fiscalYearStartBs} onChange={value => {
                setFiscalYearStartBs(value)
                if (/^\d{4}-/.test(value)) setFinancialYear(value.slice(0, 4))
              }} disabled={fiscalYearLocked} />
              <p className="text-xs text-muted-foreground">
                {fiscalYearLocked
                  ? 'Locked because the company has posted transactions.'
                  : `Stored as AD internally: ${fiscalYearStartAd || 'Enter a valid BS date'}`}
              </p>
              {fiscalYearLocked && effectiveFiscalYearStartBs !== storedFiscalYearStartBs && (
                <p className="text-xs text-amber-700">
                  Corrected from earliest transaction: stored {storedFiscalYearStartBs}, effective {effectiveFiscalYearStartBs}. Click Save Changes to update the company record.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Inventory Valuation Method</Label>
              <SearchableSelect value={valuationMethod} onValueChange={value => setValuationMethod(value as InventoryValuationMethod)} options={[{ value: 'weighted_average', label: 'Perpetual Weighted Average' }, { value: 'fifo', label: 'FIFO (First In, First Out)' }, { value: 'lifo', label: 'LIFO (Last In, First Out)' }]} />
              <p className="text-xs text-muted-foreground">Controls stock value, issue cost, P&amp;L, and Balance Sheet calculations.</p>
            </div>
            </div>
            <div className={settingsSection === 'vouchers' ? 'space-y-4' : 'hidden'}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Sales Prefix</Label>
                <Input value={salesPrefix} onChange={e => setSalesPrefix(e.target.value)} placeholder="INV-" />
              </div>
              <label htmlFor="sales-chronology" className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer sm:col-span-2">
                <input
                  id="sales-chronology"
                  type="checkbox"
                  checked={enforceSalesInvoiceChronology}
                  onChange={event => setEnforceSalesInvoiceChronology(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Enforce Chronological Invoice Dates</span>
                  <span className="block text-xs text-muted-foreground">Sales invoices in automatic numbering mode must follow invoice-number date order. Other vouchers are not affected.</span>
                </span>
              </label>
              <div className="space-y-1.5">
                <Label>Purchase Prefix</Label>
                <Input value={purchasePrefix} onChange={e => setPurchasePrefix(e.target.value)} placeholder="PB-" />
              </div>
              <div className="space-y-1.5">
                <Label>Receipt Prefix</Label>
                <Input value={receiptPrefix} onChange={e => setReceiptPrefix(e.target.value)} placeholder="RCPT-" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Prefix</Label>
                <Input value={paymentPrefix} onChange={e => setPaymentPrefix(e.target.value)} placeholder="PAY-" />
              </div>
              <div className="space-y-1.5">
                <Label>Sales Return Prefix</Label>
                <Input value={salesReturnPrefix} onChange={e => setSalesReturnPrefix(e.target.value)} placeholder="SR-" />
              </div>
              <div className="space-y-1.5">
                <Label>Purchase Return Prefix</Label>
                <Input value={purchaseReturnPrefix} onChange={e => setPurchaseReturnPrefix(e.target.value)} placeholder="PR-" />
              </div>
              <div className="space-y-1.5">
                <Label>Journal Voucher Number</Label>
                <SearchableSelect value={journalNumberingMode} onValueChange={value => setJournalNumberingMode(value as 'auto' | 'manual')} options={[{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }]} />
                <p className="text-xs text-muted-foreground">Manual mode requires the voucher number to be entered in each Journal Entry.</p>
              </div>
            </div>
            <label htmlFor="show-sales-invoice-company-details" className="flex items-start gap-3 rounded-md border border-border p-3">
              <input id="show-sales-invoice-company-details" type="checkbox" checked={showCompanyDetailsOnSalesInvoice} onChange={event => setShowCompanyDetailsOnSalesInvoice(event.target.checked)} className="mt-1" />
              <span>
                <span className="block text-sm font-medium">Show company details on Sales invoice</span>
                <span className="block text-xs text-muted-foreground">Include the logo, company name, address, phone, and PAN/VAT on printed Sales invoices.</span>
              </span>
            </label>
            <label htmlFor="reset-numbering" className="flex items-start gap-3 rounded-md border border-border p-3">
              <input id="reset-numbering" type="checkbox" checked disabled readOnly className="mt-1" />
              <span>
                <span className="block text-sm font-medium">Reset numbering every fiscal year</span>
                <span className="block text-xs text-muted-foreground">Required. New voucher numbers start from 0001 on or after the fiscal year start date.</span>
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Default Print Format</Label>
                <SearchableSelect value={printFormat} onValueChange={value => setPrintFormat(value as 'A5' | 'A4')} options={[{ value: 'A5', label: 'A5' }, { value: 'A4', label: 'A4' }]} />
              </div>
              <div className="space-y-1.5">
                <Label>Logo URL</Label>
                <Input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Invoice Terms</Label>
              <Textarea value={invoiceTerms} onChange={e => setInvoiceTerms(e.target.value)} rows={2} placeholder="Goods once sold are not returnable." />
            </div>
            <div className="space-y-1.5">
              <Label>Payment QR / Note</Label>
              <Textarea value={paymentQrText} onChange={e => setPaymentQrText(e.target.value)} rows={2} placeholder="eSewa/Khalti/bank QR note or payment instructions" />
            </div>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
            </Button>
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </CardContent>
        </Card>

        <Card className={settingsSection === 'admins' ? '' : 'hidden'}>
          <CardHeader><CardTitle className="text-base">Company Admins</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Add an existing KhataERP user to this company as an Admin.</p>
            <div className="space-y-1.5">
              <Label>User Email</Label>
              <Input type="email" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} placeholder="admin@example.com" />
            </div>
            <Button variant="outline" onClick={handleAddCompanyAdmin} disabled={memberSaving}>
              {memberSaving ? 'Adding...' : 'Add Admin'}
            </Button>
            {memberError && <p className="text-sm text-destructive">{memberError}</p>}
          </CardContent>
        </Card>

        <Card className={settingsSection === 'data' ? '' : 'hidden'}>
          <CardHeader><CardTitle className="text-base">Data</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {vouchers.length} voucher(s) · {parties.length} part{parties.length !== 1 ? 'ies' : 'y'} · {items.length} item(s)
            </p>
            <p className="text-sm text-muted-foreground">
              All data is stored in Supabase and synced in real-time across devices and users.
            </p>
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export portable company backup (JSON)
            </Button>
            <Button variant="outline" onClick={handleClosingSnapshot}>
              <Download className="h-4 w-4 mr-2" />
              Export fiscal closing snapshot
            </Button>
            <div className="space-y-1.5">
              <Label>Restore portable backup into this company</Label>
              <Input type="file" accept="application/json,.json" disabled={!!restoreProgress?.active} onChange={e => handleRestore(e.target.files?.[0])} />
              <p className="text-xs text-muted-foreground">Use a clean target company. System ledgers/groups are reused and imported records receive fresh IDs.</p>
              {restoreProgress && <RestoreProgressBox progress={restoreProgress} />}
              {restoreMessage && <p className="text-xs text-muted-foreground">{restoreMessage}</p>}
            </div>
          </CardContent>
        </Card>

        <Card className={settingsSection === 'data' ? '' : 'hidden'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" />
              Import Of Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-sm font-semibold">Recommended import flow</p>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                {importModuleOptions().map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { setImportModule(option.value as ImportModule); setImportPreview(null); setImportFileName(''); setImportMessage(''); setImportError('') }}
                    className={`rounded-md px-2 py-1 text-left transition-colors ${importModule === option.value ? 'bg-primary text-primary-foreground' : 'hover:bg-background'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Import Type</Label>
              <SearchableSelect value={importModule} onValueChange={value => { setImportModule(value as ImportModule); setImportPreview(null); setImportFileName(''); setImportMessage(''); setImportError('') }} options={importModuleOptions()} />
              <p className="text-xs text-muted-foreground">{selectedImportTemplate.description}</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" onClick={handleDownloadImportTemplate} disabled={!company}>
                <Download className="mr-2 h-4 w-4" />
                Download sample Excel
              </Button>
              <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground">
                <Upload className="mr-2 h-4 w-4" />
                Upload filled Excel
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={event => handleImportFile(event.target.files?.[0])}
                />
              </label>
            </div>

            {importFileName && <p className="text-xs text-muted-foreground">Selected file: <span className="font-medium text-foreground">{importFileName}</span></p>}

            {importPreview && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="grid gap-2 text-sm sm:grid-cols-4">
                  <div><span className="block text-xs text-muted-foreground">Rows</span><span className="font-semibold">{importPreview.totalRows}</span></div>
                  <div><span className="block text-xs text-muted-foreground">Valid</span><span className="font-semibold">{importPreview.validRows}</span></div>
                  <div><span className="block text-xs text-muted-foreground">Errors</span><span className={importPreview.errors.length ? 'font-semibold text-destructive' : 'font-semibold'}>{importPreview.errors.length}</span></div>
                  <div><span className="block text-xs text-muted-foreground">Warnings</span><span className="font-semibold">{importPreview.warnings.length}</span></div>
                </div>
                {importPreview.voucherCount > 0 && <p className="text-xs text-muted-foreground">Will create {importPreview.voucherCount} draft voucher(s). Imported vouchers will not affect ledgers, stock, reports, or dashboard until completed.</p>}
                {(importPreview.errors.length > 0 || importPreview.warnings.length > 0) && (
                  <div className="max-h-44 overflow-auto rounded-md bg-muted/30 p-2 text-xs">
                    {[...importPreview.errors.slice(0, 10), ...importPreview.warnings.slice(0, 10)].map((issue, index) => (
                      <p key={`${issue.row}-${issue.field}-${index}`} className={index < importPreview.errors.length ? 'text-destructive' : 'text-muted-foreground'}>
                        Row {issue.row}{issue.field ? ` (${issue.field})` : ''}: {issue.message}
                      </p>
                    ))}
                    {importPreview.errors.length + importPreview.warnings.length > 20 && <p className="text-muted-foreground">Download the issue report to view all messages.</p>}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleRunImport} disabled={importing || importPreview.errors.length > 0 || importPreview.totalRows === 0}>
                    {importing ? 'Importing...' : 'Import'}
                  </Button>
                  {(importPreview.errors.length > 0 || importPreview.warnings.length > 0) && <Button variant="outline" onClick={handleDownloadImportIssues}>Download issue report</Button>}
                </div>
              </div>
            )}

            {importMessage && <p className="text-sm text-forest">{importMessage}</p>}
            {importError && <p className="text-sm text-destructive">{importError}</p>}
          </CardContent>
        </Card>

        </div>
      </PageContent>
    </div>
  )
}
