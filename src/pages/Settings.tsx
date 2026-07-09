import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { todayISO } from '@/lib/utils'
import { PageHeader, PageContent } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function SettingsPage() {
  const { company, saveCompany, vouchers, parties, items } = useAppStore()
  const [name, setName] = useState(company?.name ?? '')
  const [address, setAddress] = useState(company?.address ?? '')
  const [panVat, setPanVat] = useState(company?.pan_vat ?? '')
  const [phone, setPhone] = useState(company?.phone ?? '')
  const [vatEnabled, setVatEnabled] = useState(company?.vat_enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(company?.name ?? '')
    setAddress(company?.address ?? '')
    setPanVat(company?.pan_vat ?? '')
    setPhone(company?.phone ?? '')
    setVatEnabled(company?.vat_enabled ?? true)
  }, [company])

  const handleSave = async () => {
    setSaving(true)
    await saveCompany({ name: name.trim() || 'My Company', address: address.trim(), pan_vat: panVat.trim(), phone: phone.trim(), vat_enabled: vatEnabled })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleExport = () => {
    const data = { company, vouchers, parties, items, exported_at: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `khata-backup-${todayISO()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader title="Settings" description="Company details and data management" />
      <PageContent className="max-w-xl space-y-5">
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
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
            </Button>
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
          </CardContent>
        </Card>
      </PageContent>
    </div>
  )
}
