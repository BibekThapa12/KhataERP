import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Party } from '@/types'
import { partyTerminology } from '@/lib/partyTerminology'
import { publicErrorMessage } from '@/lib/security'

interface PartyFormProps {
  open: boolean
  onClose: () => void
  defaultType?: 'customer' | 'supplier'
  onCreated?: (party: Party) => void
}

export function PartyForm({ open, onClose, defaultType, onCreated }: PartyFormProps) {
  const addParty = useAppStore(s => s.addParty)
  const [name, setName] = useState('')
  const [type, setType] = useState<'customer' | 'supplier'>(defaultType ?? 'customer')
  const [phone, setPhone] = useState('')
  const [panVat, setPanVat] = useState('')
  const [address, setAddress] = useState('')
  const [defaultCreditDays, setDefaultCreditDays] = useState(0)
  const [openingBalance, setOpeningBalance] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const terminology = partyTerminology(type)

  useEffect(() => {
    if (!open) { setName(''); setPhone(''); setPanVat(''); setAddress(''); setDefaultCreditDays(0); setOpeningBalance(0); setError('') }
    if (defaultType) setType(defaultType)
  }, [open, defaultType])

  const handleSave = async () => {
    if (!name.trim()) { setError('Enter a name.'); return }
    if (!Number.isInteger(defaultCreditDays) || defaultCreditDays < 0) { setError('Default Credit Days must be a whole number of 0 or more.'); return }
    setSaving(true)
    try {
      const party = await addParty({ name: name.trim(), type, phone: phone.trim(), pan_vat: panVat.trim(), address: address.trim(), default_credit_days: defaultCreditDays, opening_balance: openingBalance })
      onCreated?.(party)
      onClose()
    } catch (e: unknown) {
      setError(publicErrorMessage(e, 'saving party'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Party</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ram Traders" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <SearchableSelect value={type} onValueChange={v => setType(v as 'customer' | 'supplier')} disabled={!!defaultType} options={[{ value: 'customer', label: partyTerminology('customer').plural, searchText: partyTerminology('customer').searchAliases }, { value: 'supplier', label: partyTerminology('supplier').plural, searchText: partyTerminology('supplier').searchAliases }]} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="98XXXXXXXX" />
            </div>
            <div className="space-y-1.5">
              <Label>PAN / VAT No.</Label>
              <Input value={panVat} onChange={e => setPanVat(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} placeholder="Kathmandu, Nepal" />
          </div>
          <div className="space-y-1.5">
            <Label>Default Credit Days</Label>
            <Input type="number" min="0" step="1" value={defaultCreditDays} onChange={e => setDefaultCreditDays(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">Automatically used on new credit invoices for this party.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Opening Balance (Rs)</Label>
            <Input type="number" step="any" value={openingBalance || ''} onChange={e => setOpeningBalance(Number(e.target.value))} placeholder="0" />
            <p className="text-xs text-muted-foreground">
              {terminology.singular}: {type === 'customer' ? 'amount they currently owe you.' : 'amount you currently owe them.'}
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Party'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
