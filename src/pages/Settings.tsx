import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { logAppEvent, supabase, supabaseProjectHost } from '@/lib/supabase'
import { adToBs, bsToAd, DEFAULT_FISCAL_YEAR_START_BS, parseBsDate } from '@/lib/nepaliDate'
import { todayISO } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'

export function SettingsPage() {
  const { company, saveCompany, accounts, vouchers, parties, items, loadAll, userId, error: loadError } = useAppStore()
  const [name, setName] = useState(company?.name ?? '')
  const [address, setAddress] = useState(company?.address ?? '')
  const [panVat, setPanVat] = useState(company?.pan_vat ?? '')
  const [phone, setPhone] = useState(company?.phone ?? '')
  const [vatEnabled, setVatEnabled] = useState(company?.vat_enabled ?? true)
  const [fiscalYearStartBs, setFiscalYearStartBs] = useState(company?.fiscal_year_start ? adToBs(company.fiscal_year_start) : DEFAULT_FISCAL_YEAR_START_BS)
  const [salesPrefix, setSalesPrefix] = useState(company?.sales_prefix ?? 'INV-')
  const [purchasePrefix, setPurchasePrefix] = useState(company?.purchase_prefix ?? 'PB-')
  const [receiptPrefix, setReceiptPrefix] = useState(company?.receipt_prefix ?? 'RCPT-')
  const [paymentPrefix, setPaymentPrefix] = useState(company?.payment_prefix ?? 'PAY-')
  const [salesReturnPrefix, setSalesReturnPrefix] = useState(company?.sales_return_prefix ?? 'SR-')
  const [purchaseReturnPrefix, setPurchaseReturnPrefix] = useState(company?.purchase_return_prefix ?? 'PR-')
  const [resetNumbering, setResetNumbering] = useState(company?.reset_numbering_fiscal_year ?? false)
  const [printFormat, setPrintFormat] = useState(company?.print_format ?? 'A5')
  const [invoiceTerms, setInvoiceTerms] = useState(company?.invoice_terms ?? '')
  const [paymentQrText, setPaymentQrText] = useState(company?.payment_qr_text ?? '')
  const [logoUrl, setLogoUrl] = useState(company?.logo_url ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [restoreMessage, setRestoreMessage] = useState('')
  const fiscalYearStartAd = parseBsDate(fiscalYearStartBs) ? bsToAd(fiscalYearStartBs) : ''

  useEffect(() => {
    setName(company?.name ?? '')
    setAddress(company?.address ?? '')
    setPanVat(company?.pan_vat ?? '')
    setPhone(company?.phone ?? '')
    setVatEnabled(company?.vat_enabled ?? true)
    setFiscalYearStartBs(company?.fiscal_year_start ? adToBs(company.fiscal_year_start) : DEFAULT_FISCAL_YEAR_START_BS)
    setSalesPrefix(company?.sales_prefix ?? 'INV-')
    setPurchasePrefix(company?.purchase_prefix ?? 'PB-')
    setReceiptPrefix(company?.receipt_prefix ?? 'RCPT-')
    setPaymentPrefix(company?.payment_prefix ?? 'PAY-')
    setSalesReturnPrefix(company?.sales_return_prefix ?? 'SR-')
    setPurchaseReturnPrefix(company?.purchase_return_prefix ?? 'PR-')
    setResetNumbering(company?.reset_numbering_fiscal_year ?? false)
    setPrintFormat(company?.print_format ?? 'A5')
    setInvoiceTerms(company?.invoice_terms ?? '')
    setPaymentQrText(company?.payment_qr_text ?? '')
    setLogoUrl(company?.logo_url ?? '')
  }, [company])

  const handleSave = async () => {
    setSaveError('')
    setRestoreMessage('')
    if (!fiscalYearStartAd) {
      setSaveError('Enter fiscal year start in YYYY-MM-DD BS format.')
      return
    }
    setSaving(true)
    try {
      await saveCompany({
        name: name.trim() || 'My Company',
        address: address.trim(),
        pan_vat: panVat.trim(),
        phone: phone.trim(),
        vat_enabled: vatEnabled,
        fiscal_year_start: fiscalYearStartAd,
        sales_prefix: salesPrefix.trim() || 'INV-',
        purchase_prefix: purchasePrefix.trim() || 'PB-',
        receipt_prefix: receiptPrefix.trim() || 'RCPT-',
        payment_prefix: paymentPrefix.trim() || 'PAY-',
        sales_return_prefix: salesReturnPrefix.trim() || 'SR-',
        purchase_return_prefix: purchaseReturnPrefix.trim() || 'PR-',
        reset_numbering_fiscal_year: resetNumbering,
        print_format: printFormat,
        invoice_terms: invoiceTerms.trim(),
        payment_qr_text: paymentQrText.trim(),
        logo_url: logoUrl.trim(),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    const data = { company, accounts, vouchers, parties, items, exported_at: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `khata-backup-${todayISO()}.json`
    a.click()
    URL.revokeObjectURL(url)
    logAppEvent('export_backup', company?.id, { vouchers: vouchers.length, parties: parties.length, items: items.length })
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
    setRestoreMessage('Reading backup...')
    try {
      const text = await file.text()
      const backup = JSON.parse(text)
      if (!backup || typeof backup !== 'object') throw new Error('Invalid backup file.')

      setRestoreMessage('Restoring company data...')
      if (backup.company) {
        const { id, user_id, created_at, ...companyUpdates } = backup.company
        void id; void user_id; void created_at
        await saveCompany(companyUpdates)
      }

      const normalizedAccounts = Array.isArray(backup.accounts)
        ? backup.accounts.map((a: Record<string, unknown>) => {
            const { balance, created_at, ...rest } = a
            void balance; void created_at
            return { ...rest, company_id: company.id }
          })
        : []
      if (normalizedAccounts.length) {
        const { error } = await supabase.from('accounts').upsert(normalizedAccounts)
        if (error) throw error
      }

      const normalizedItems = Array.isArray(backup.items)
        ? backup.items.map((i: Record<string, unknown>) => {
            const { stock_qty, avg_cost, stock_value, created_at, ...rest } = i
            void stock_qty; void avg_cost; void stock_value; void created_at
            return { ...rest, company_id: company.id }
          })
        : []
      if (normalizedItems.length) {
        const { error } = await supabase.from('items').upsert(normalizedItems)
        if (error) throw error
      }

      const normalizedParties = Array.isArray(backup.parties)
        ? backup.parties.map((p: Record<string, unknown>) => {
            const { account, created_at, ...rest } = p
            void account; void created_at
            return { ...rest, company_id: company.id }
          })
        : []
      if (normalizedParties.length) {
        const { error } = await supabase.from('parties').upsert(normalizedParties)
        if (error) throw error
      }

      if (Array.isArray(backup.vouchers)) {
        for (const voucher of backup.vouchers as Record<string, unknown>[]) {
          const { lines, stock_lines, invoice_items, party, created_at, ...voucherRow } = voucher
          void party; void created_at
          const { error: voucherError } = await supabase.from('vouchers').upsert({ ...voucherRow, company_id: company.id })
          if (voucherError) throw voucherError
          const voucherId = String(voucherRow.id)
          await supabase.from('voucher_lines').delete().eq('voucher_id', voucherId)
          await supabase.from('stock_lines').delete().eq('voucher_id', voucherId)
          await supabase.from('invoice_items').delete().eq('voucher_id', voucherId)
          if (Array.isArray(lines) && lines.length) {
            const { error } = await supabase.from('voucher_lines').insert(lines.map((l: Record<string, unknown>) => ({ ...l, voucher_id: voucherId })))
            if (error) throw error
          }
          if (Array.isArray(stock_lines) && stock_lines.length) {
            const { error } = await supabase.from('stock_lines').insert(stock_lines.map((l: Record<string, unknown>) => ({ ...l, voucher_id: voucherId })))
            if (error) throw error
          }
          if (Array.isArray(invoice_items) && invoice_items.length) {
            const { error } = await supabase.from('invoice_items').insert(invoice_items.map((l: Record<string, unknown>) => ({ ...l, voucher_id: voucherId })))
            if (error) throw error
          }
        }
      }

      await loadAll(userId)
      logAppEvent('restore_backup', company.id, { vouchers: Array.isArray(backup.vouchers) ? backup.vouchers.length : 0 })
      setRestoreMessage('Backup restored.')
    } catch (e: unknown) {
      setRestoreMessage((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Company details and data management" />
      <PageContent className="max-w-xl space-y-5">
        <Card>
          <CardHeader><CardTitle className="text-base">Account Diagnostic</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>Supabase project: <span className="font-mono text-foreground">{supabaseProjectHost || 'Not configured'}</span></p>
            <p>Logged-in user id: <span className="font-mono text-foreground">{userId || 'Not loaded'}</span></p>
            <p>Loaded company id: <span className="font-mono text-foreground">{company?.id || 'Not loaded'}</span></p>
            <p>Loaded company user id: <span className="font-mono text-foreground">{company?.user_id || 'Not loaded'}</span></p>
            <p>Loaded company name: <span className="font-semibold text-foreground">{company?.name || 'Not loaded'}</span></p>
            <p>Owner email: <span className="font-mono text-foreground">{company?.owner_email || 'Not set'}</span></p>
            {loadError && <p className="text-destructive">Load error: <span className="font-mono">{loadError}</span></p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Company Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Company Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="My Trading Co." />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} placeholder="Kathmandu, Nepal" />
            </div>
            <div className="space-y-1.5">
              <Label>PAN / VAT Registration No.</Label>
              <Input value={panVat} onChange={e => setPanVat(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Optional" />
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
              <Label>Fiscal Year Start (BS)</Label>
              <NepaliDateInput value={fiscalYearStartBs} onChange={setFiscalYearStartBs} />
              <p className="text-xs text-muted-foreground">
                Stored as AD internally: {fiscalYearStartAd || 'Enter a valid BS date'}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Sales Prefix</Label>
                <Input value={salesPrefix} onChange={e => setSalesPrefix(e.target.value)} placeholder="INV-" />
              </div>
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
            </div>
            <label htmlFor="reset-numbering" className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer">
              <input id="reset-numbering" type="checkbox" checked={resetNumbering} onChange={e => setResetNumbering(e.target.checked)} className="mt-1" />
              <span>
                <span className="block text-sm font-medium">Reset numbering every fiscal year</span>
                <span className="block text-xs text-muted-foreground">New voucher numbers start from 0001 on or after the fiscal year start date.</span>
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Default Print Format</Label>
                <select value={printFormat} onChange={e => setPrintFormat(e.target.value as 'A5' | 'A4')} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="A5">A5</option>
                  <option value="A4">A4</option>
                </select>
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
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
            </Button>
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </CardContent>
        </Card>

        <Card>
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
              Export backup (JSON)
            </Button>
            <Button variant="outline" onClick={handleClosingSnapshot}>
              <Download className="h-4 w-4 mr-2" />
              Export fiscal closing snapshot
            </Button>
            <div className="space-y-1.5">
              <Label>Restore backup</Label>
              <Input type="file" accept="application/json,.json" onChange={e => handleRestore(e.target.files?.[0])} />
              {restoreMessage && <p className="text-xs text-muted-foreground">{restoreMessage}</p>}
            </div>
          </CardContent>
        </Card>
      </PageContent>
    </div>
  )
}
