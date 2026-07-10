import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { fmtMoney } from '@/lib/utils'
import { todayBs } from '@/lib/nepaliDate'
import { round2 } from '@/lib/engine'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import { Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Item, Voucher } from '@/types'
import type { VoucherLine } from '@/types'

// ─── Item Form ────────────────────────────────────────────────────────────────

interface ItemFormProps {
  open: boolean
  onClose: () => void
  onCreated?: (item: Item) => void
}

export function ItemForm({ open, onClose, onCreated }: ItemFormProps) {
  const addItem = useAppStore(s => s.addItem)
  const itemCategories = useAppStore(s => s.itemCategories)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('pcs')
  const [sellRate, setSellRate] = useState(0)
  const [openingQty, setOpeningQty] = useState(0)
  const [openingRate, setOpeningRate] = useState(0)
  const [reorderLevel, setReorderLevel] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [vatApplicable, setVatApplicable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && !categoryId) setCategoryId(itemCategories.find(category => category.name === 'General' && !category.is_archived)?.id || itemCategories.find(category => !category.is_archived)?.id || '')
    if (!open) { setName(''); setUnit('pcs'); setSellRate(0); setOpeningQty(0); setOpeningRate(0); setReorderLevel(''); setCategoryId(''); setSku(''); setBarcode(''); setVatApplicable(true); setError('') }
  }, [open, categoryId, itemCategories])

  const handleSave = async () => {
    if (!name.trim()) { setError('Enter an item name.'); return }
    setSaving(true)
    try {
      const item = await addItem({ name: name.trim(), unit: unit.trim() || 'pcs', sell_rate: sellRate, opening_qty: openingQty, opening_rate: openingRate, reorder_level: reorderLevel ? Number(reorderLevel) : undefined, category_id: categoryId || undefined, sku: sku.trim(), barcode: barcode.trim(), vat_applicable: vatApplicable })
      onCreated?.(item)
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Item</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Item Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Rice 25kg Bag" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{itemCategories.filter(category => !category.is_archived).map(category => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="pcs, kg, box…" />
            </div>
            <div className="space-y-1.5">
              <Label>Default Sell Rate (Rs)</Label>
              <Input type="number" step="any" value={sellRate || ''} onChange={e => setSellRate(Number(e.target.value))} placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Opening Stock Qty</Label>
              <Input type="number" step="any" value={openingQty || ''} onChange={e => setOpeningQty(Number(e.target.value))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Opening Cost/Unit (Rs)</Label>
              <Input type="number" step="any" value={openingRate || ''} onChange={e => setOpeningRate(Number(e.target.value))} placeholder="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reorder Level (optional)</Label>
            <Input type="number" step="any" value={reorderLevel} onChange={e => setReorderLevel(e.target.value)} placeholder="Alert when stock falls below…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>SKU</Label><Input value={sku} onChange={e => setSku(e.target.value)} placeholder="Optional" /></div>
            <div className="space-y-1.5"><Label>Barcode</Label><Input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Optional" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vatApplicable} onChange={e => setVatApplicable(e.target.checked)} className="h-4 w-4 accent-primary" />VAT applicable</label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Item'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Receipt / Payment Form ───────────────────────────────────────────────────

interface ReceiptPaymentFormProps {
  type: 'Receipt' | 'Payment'
  open: boolean
  onClose: () => void
  voucher?: Voucher | null
}

export function ReceiptPaymentForm({ type, open, onClose, voucher }: ReceiptPaymentFormProps) {
  const { parties, saveReceipt, savePayment, updateReceipt, updatePayment } = useAppStore()
  const isReceipt = type === 'Receipt'
  const partyType = isReceipt ? 'customer' : 'supplier'
  const partyList = parties.filter(p => p.type === partyType && !p.is_archived)
  const isEditing = !!voucher

  const [dateBs, setDateBs] = useState(todayBs())
  const [partyAccountId, setPartyAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'cash' | 'bank'>('cash')
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && voucher) {
      setDateBs(voucher.date_bs)
      setPartyAccountId(voucher.party_account_id || '')
      setAmount(String(voucher.total || ''))
      setMode(voucher.is_cash ? 'cash' : 'bank')
      setNarration(voucher.narration || '')
      setError('')
    } else if (!open) {
      setDateBs(todayBs()); setPartyAccountId(''); setAmount(''); setMode('cash'); setNarration(''); setError('')
    }
  }, [open, voucher])

  const handleSave = async () => {
    if (!partyAccountId) { setError(`Select a ${partyType}.`); return }
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount.'); return }
    setSaving(true)
    try {
      if (isReceipt) {
        if (voucher) await updateReceipt(voucher.id, { party_account_id: partyAccountId, amount: amt, deposit_to: mode, narration, date_bs: dateBs })
        else await saveReceipt({ party_account_id: partyAccountId, amount: amt, deposit_to: mode, narration, date_bs: dateBs })
      } else {
        if (voucher) await updatePayment(voucher.id, { party_account_id: partyAccountId, amount: amt, paid_from: mode, narration, date_bs: dateBs })
        else await savePayment({ party_account_id: partyAccountId, amount: amt, paid_from: mode, narration, date_bs: dateBs })
      }
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isEditing ? 'Edit' : 'New'} {type}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <NepaliDateInput value={dateBs} onChange={setDateBs} />
          </div>
          <div className="space-y-1.5">
            <Label>{isReceipt ? 'Received from' : 'Paid to'}</Label>
            <Select value={partyAccountId} onValueChange={setPartyAccountId}>
              <SelectTrigger><SelectValue placeholder={`Select ${partyType}…`} /></SelectTrigger>
              <SelectContent>
                {partyList.map(p => <SelectItem key={p.account_id} value={p.account_id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (Rs)</Label>
              <Input type="number" step="any" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label>{isReceipt ? 'Deposit to' : 'Pay from'}</Label>
              <Select value={mode} onValueChange={v => setMode(v as 'cash' | 'bank')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Account</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Narration (optional)</Label>
            <Input value={narration} onChange={e => setNarration(e.target.value)} placeholder="Note…" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : `${isEditing ? 'Update' : 'Save'} ${type}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Journal Form ─────────────────────────────────────────────────────────────

interface JournalFormProps { open: boolean; onClose: () => void; voucher?: Voucher | null }

interface JLine { account_id: string; debit: number; credit: number }

export function JournalForm({ open, onClose, voucher }: JournalFormProps) {
  const { accounts, saveJournal, updateJournal } = useAppStore()
  const nonPartyAccounts = accounts.filter(a => !a.is_party && !a.is_archived)
  const isEditing = !!voucher

  const [dateBs, setDateBs] = useState(todayBs())
  const [jLines, setJLines] = useState<JLine[]>([
    { account_id: '', debit: 0, credit: 0 },
    { account_id: '', debit: 0, credit: 0 },
  ])
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && voucher) {
      setDateBs(voucher.date_bs)
      setJLines((voucher.lines || []).map(l => ({
        account_id: l.account_id,
        debit: l.debit || 0,
        credit: l.credit || 0,
      })))
      setNarration(voucher.narration || '')
      setError('')
    } else if (!open) {
      setDateBs(todayBs())
      setJLines([{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }])
      setNarration('')
      setError('')
    }
  }, [open, voucher])

  const totalDebit = round2(jLines.reduce((s, l) => s + (l.debit || 0), 0))
  const totalCredit = round2(jLines.reduce((s, l) => s + (l.credit || 0), 0))
  const diff = round2(totalDebit - totalCredit)
  const balanced = Math.abs(diff) < 0.005

  const updateLine = (idx: number, field: keyof JLine, value: string | number) => {
    const next = [...jLines]
    if (field === 'debit' && Number(value) > 0) next[idx] = { ...next[idx], debit: Number(value), credit: 0 }
    else if (field === 'credit' && Number(value) > 0) next[idx] = { ...next[idx], credit: Number(value), debit: 0 }
    else next[idx] = { ...next[idx], [field]: field === 'account_id' ? value : Number(value) }
    setJLines(next)
  }

  const handleSave = async () => {
    const validLines = jLines.filter(l => l.account_id && (l.debit > 0 || l.credit > 0))
    if (validLines.length < 2) { setError('Add at least two lines.'); return }
    if (!balanced) { setError(`Debits and credits differ by ${fmtMoney(Math.abs(diff))}.`); return }
    setSaving(true)
    try {
      const params = { lines: validLines as Omit<VoucherLine, 'id' | 'voucher_id'>[], narration, date_bs: dateBs }
      if (voucher) await updateJournal(voucher.id, params)
      else await saveJournal(params)
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEditing ? 'Edit' : 'New'} Journal Entry</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Use this for adjustments not covered by other voucher types: depreciation, write-offs, opening balances, etc.
        </p>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <NepaliDateInput value={dateBs} onChange={setDateBs} className="max-w-[180px]" />
          </div>

          {/* Lines header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Account</span><span>Debit</span><span>Credit</span><span></span>
          </div>
          {jLines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center">
              <Select value={line.account_id} onValueChange={v => updateLine(idx, 'account_id', v)}>
                <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent>
                  {nonPartyAccounts.sort((a,b) => a.name.localeCompare(b.name)).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="number" min="0" step="any" value={line.debit || ''} onChange={e => updateLine(idx, 'debit', e.target.value)} placeholder="0.00" className="text-right" />
              <Input type="number" min="0" step="any" value={line.credit || ''} onChange={e => updateLine(idx, 'credit', e.target.value)} placeholder="0.00" className="text-right" />
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => setJLines(jLines.filter((_, i) => i !== idx))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setJLines([...jLines, { account_id: '', debit: 0, credit: 0 }])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add line
          </Button>

          {/* Balance check */}
          <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Total Debit</span><span className="num debit-amt">{fmtMoney(totalDebit)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total Credit</span><span className="num credit-amt">{fmtMoney(totalCredit)}</span></div>
            <div className={`flex justify-between font-semibold border-t border-border pt-1 ${balanced ? 'text-forest' : 'text-destructive'}`}>
              <span>{balanced ? 'Balanced ✓' : 'Difference'}</span>
              <span className="num">{balanced ? fmtMoney(0) : fmtMoney(Math.abs(diff))}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Narration</Label>
            <Textarea value={narration} onChange={e => setNarration(e.target.value)} placeholder="What is this adjustment for?" rows={2} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !balanced}>{saving ? 'Saving...' : `${isEditing ? 'Update' : 'Save'} Journal Entry`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
