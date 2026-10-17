import { useEffect, useMemo, useState } from 'react'
import { Barcode, Check } from 'lucide-react'
import { fetchInventorySerialCandidates } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { InventorySerialCandidate } from '@/types'

export type SerialEntryMode = 'purchase' | 'sale' | 'sales_return' | 'purchase_return'

function normalizeSerials(value: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of value) {
    const serial = raw.trim()
    const key = serial.toLocaleUpperCase()
    if (!serial || seen.has(key)) continue
    seen.add(key)
    result.push(serial)
  }
  return result
}

function parseSerialText(value: string) {
  return normalizeSerials(value.split(/[\n,;\t]+/))
}

interface SerialNumberEditorProps {
  companyId: string
  itemId: string
  itemName: string
  quantity: number
  mode: SerialEntryMode
  value?: string[]
  onChange: (serials: string[]) => void
  sourceVoucherId?: string | null
  excludeVoucherId?: string | null
  disabled?: boolean
}

export function SerialNumberEditor({ companyId, itemId, itemName, quantity, mode, value = [], onChange, sourceVoucherId, excludeVoucherId, disabled }: SerialNumberEditorProps) {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState<string[]>(value)
  const [manualText, setManualText] = useState(value.join('\n'))
  const [candidates, setCandidates] = useState<InventorySerialCandidate[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const required = Number.isInteger(quantity) && quantity > 0 ? quantity : 0
  const manual = mode === 'purchase'

  useEffect(() => {
    if (!open) return
    setWorking(value)
    setManualText(value.join('\n'))
    setQuery('')
    setError('')
    if (manual) return
    setLoading(true)
    fetchInventorySerialCandidates({ companyId, itemId, mode, sourceVoucherId, excludeVoucherId })
      .then(setCandidates)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load serial numbers.'))
      .finally(() => setLoading(false))
  }, [open, value, manual, companyId, itemId, mode, sourceVoucherId, excludeVoucherId])

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return term ? candidates.filter(candidate => candidate.serial_number.toLocaleLowerCase().includes(term)) : candidates
  }, [candidates, query])
  const selectedKeys = useMemo(() => new Set(working.map(serial => serial.toLocaleUpperCase())), [working])
  const count = value.length
  const valid = required > 0 && count === required

  const commit = () => {
    const next = manual ? parseSerialText(manualText) : normalizeSerials(working)
    if (next.length !== required) {
      setError(`Assign exactly ${required} serial ${required === 1 ? 'number' : 'numbers'} for this quantity.`)
      return
    }
    onChange(next)
    setOpen(false)
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={disabled || !itemId || required === 0} onClick={() => setOpen(true)} className={valid ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}>
        <Barcode className="mr-1.5 h-3.5 w-3.5" />
        {valid ? `${count} serial${count === 1 ? '' : 's'} assigned` : `Assign serials ${count}/${required || 0}`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{manual ? 'Capture' : 'Select'} serial numbers</DialogTitle>
            <DialogDescription>{itemName} · exactly {required} required. Serial numbers are matched case-insensitively.</DialogDescription>
          </DialogHeader>
          {manual ? (
            <div className="space-y-2">
              <label htmlFor="serial-number-list" className="text-sm font-medium">Scan or paste one serial per line</label>
              <textarea id="serial-number-list" data-dialog-autofocus rows={10} value={manualText} onChange={event => { setManualText(event.target.value); setError('') }} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" placeholder={'IMEI / serial 1\nIMEI / serial 2'} />
              <p className="text-xs text-muted-foreground">New lines, commas, tabs, and semicolons are accepted. Duplicate entries are removed.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Input data-dialog-autofocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Find serial number…" />
              <div className="max-h-64 overflow-y-auto rounded-md border p-1">
                {loading ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading serial numbers…</p> : filtered.length ? filtered.map(candidate => {
                  const selected = selectedKeys.has(candidate.serial_number.toLocaleUpperCase())
                  return <button key={candidate.id} type="button" onClick={() => setWorking(current => selected ? current.filter(serial => serial.toLocaleUpperCase() !== candidate.serial_number.toLocaleUpperCase()) : current.length < required ? [...current, candidate.serial_number] : current)} className={`flex min-h-9 w-full items-center justify-between rounded px-2.5 text-left font-mono text-sm ${selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}><span className="truncate">{candidate.serial_number}</span>{selected && <Check className="h-4 w-4 shrink-0" />}</button>
                }) : <p className="px-3 py-6 text-center text-sm text-muted-foreground">{query ? 'No matching serial numbers.' : 'No eligible serial numbers are available.'}</p>}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={commit}>Use serials</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
