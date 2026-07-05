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
import type { Item } from '@/types'
import type { VoucherLine } from '@/types'

// ─── Item Form ────────────────────────────────────────────────────────────────

interface ItemFormProps {
  open: boolean
  onClose: () => void
  onCreated?: (item: Item) => void
}

export function ItemForm({ open, onClose, onCreated }: ItemFormProps) {
  const addItem = useAppStore(s => s.addItem)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('pcs')
  const [sellRate, setSellRate] = useState(0)
  const [openingQty, setOpeningQty] = useState(0)
  const [openingRate, setOpeningRate] = useState(0)
  const [reorderLevel, setReorderLevel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) { setName(''); setUnit('pcs'); setSellRate(0); setOpeningQty(0); setOpeningRate(0); setReorderLevel(''); setError('') }
  }, [open])

  const handleSave = async () => {
    if (!name.trim()) { setError('Enter an item name.'); return }
    setSaving(true)
    try {
      const item = await addItem({ name: name.trim(), unit: unit.trim() || 'pcs', sell_rate: sellRate, opening_qty: openingQty, opening_rate: openingRate, reorder_level: reorderLevel ? Number(reorderLevel) : undefined })
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
}

export function ReceiptPaymentForm({ type, open, onClose }: ReceiptPaymentFormProps) {
  const { parties, saveReceipt, savePayment, accounts } = useAppStore()
  const isReceipt = type === 'Receipt'
  const partyType = isReceipt ? 'customer' : 'supplier'
  const partyList = parties.filter(p => p.type === partyType)

  const [dateBs, setDateBs] = useState(todayBs())
  const [partyAccountId, setPartyAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'cash' | 'bank'>('cash')
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) { setDateBs(todayBs()); setPartyAccountId(''); setAmount(''); setMode('cash'); setNarration(''); setError('') }
  }, [open])

  const handleSave = async () => {
    if (!partyAccountId) { setError(`Select a ${partyType}.`); return }
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount.'); return }
    setSaving(true)
    try {
      if (isReceipt) await saveReceipt({ party_account_id: partyAccountId, amount: amt, deposit_to: mode, narration, date_bs: dateBs })
      else await savePayment({ party_account_id: partyAccountId, amount: amt, paid_from: mode, narration, date_bs: dateBs })
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New {type}</DialogTitle></DialogHeader>
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
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : `Save ${type}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Journal Form ─────────────────────────────────────────────────────────────

interface JournalFormProps { open: boolean; onClose: () => void }

interface JLine { account_id: string; debit: number; credit: number }

export function JournalForm({ open, onClose }: JournalFormProps) {
  const { accounts, saveJournal } = useAppStore()
  const nonPartyAccounts = accounts.filter(a => !a.is_party)

  const [dateBs, setDateBs] = useState(todayBs())
  const [jLines, setJLines] = useState<JLine[]>([
    { account_id: '', debit: 0, credit: 0 },
    { account_id: '', debit: 0, credit: 0 },
  ])
  const [narration, setNarration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setDateBs(todayBs())
      setJLines([{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }])
      setNarration('')
      setError('')
    }
  }, [open])

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
      await saveJournal({ lines: validLines as Omit<VoucherLine, 'id' | 'voucher_id'>[], narration, date_bs: dateBs })
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
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
          <Button onClick={handleSave} disabled={saving || !balanced}>{saving ? 'Saving…' : 'Save Journal Entry'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
