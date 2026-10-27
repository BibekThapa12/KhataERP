import { useEffect, useMemo, useState } from 'react'
import { Barcode, Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { duplicateSerialNumbers, normalizedSerialKey, parseSerialNumberPaste } from '@/lib/serialAssignment'

interface OpeningSerialAssignmentProps {
  itemName: string
  quantity: number
  unit: string
  value: string[]
  onChange: (serials: string[]) => void
}

export function OpeningSerialAssignment({ itemName, quantity, unit, value, onChange }: OpeningSerialAssignmentProps) {
  const requiredCount = Number.isInteger(quantity) && quantity > 0 ? quantity : 0
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState<string[]>(value)
  const [pasteValue, setPasteValue] = useState('')
  const normalized = useMemo(() => working.map(normalizedSerialKey), [working])
  const duplicates = useMemo(() => duplicateSerialNumbers(working), [working])
  const assignedCount = value.filter(serial => serial.trim()).length
  const workingCount = working.filter(serial => serial.trim()).length
  const complete = requiredCount > 0 && assignedCount === requiredCount && duplicateSerialNumbers(value).size === 0
  const valid = requiredCount > 0 && workingCount === requiredCount && duplicates.size === 0

  useEffect(() => {
    if (!open) return
    setWorking(value)
    setPasteValue('')
  }, [open, value])

  const replaceSerial = (index: number, serial: string) => {
    setWorking(current => {
      const next = [...current]
      next[index] = serial
      return next
    })
  }

  const applyPaste = () => {
    const pasted = parseSerialNumberPaste(pasteValue)
    if (!pasted.length) return
    setWorking(current => {
      const next = Array.from({ length: Math.max(requiredCount, current.length) }, (_, index) => current[index] || '')
      let pasteIndex = 0
      for (let index = 0; index < next.length && pasteIndex < pasted.length; index += 1) {
        if (!next[index].trim()) next[index] = pasted[pasteIndex++]
      }
      return [...next, ...pasted.slice(pasteIndex)]
    })
    setPasteValue('')
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Opening serial number 1"]')?.focus())
  }

  const assign = () => {
    if (!valid) return
    onChange(working.slice(0, requiredCount).map(serial => serial.trim()))
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!requiredCount}
        onClick={() => setOpen(true)}
        aria-label={`Assign opening serial numbers for ${itemName || 'new item'}`}
        className={`h-9 min-w-[6.75rem] gap-1.5 px-2.5 shadow-none ${complete ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-50' : 'border-amber-300 bg-amber-50/60 text-amber-900 hover:bg-amber-50'}`}
      >
        {complete ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        <span className="text-[11px] font-semibold tabular-nums">{assignedCount} / {requiredCount || 0}</span>
        <span className="sr-only">opening serials assigned</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[40rem] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-[17px]"><Barcode className="h-4 w-4 text-primary" />Opening serial numbers</DialogTitle>
            <DialogDescription className="pt-1 text-xs">
              Assign one serial number to each of the {requiredCount} opening units ({unit || 'main unit'}) for <span className="font-medium text-foreground">{itemName || 'this item'}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 border-b border-border bg-muted/25 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="opening-serial-paste" className="text-xs font-medium">Paste serials in bulk</label>
              <Textarea id="opening-serial-paste" value={pasteValue} onChange={event => setPasteValue(event.target.value)} placeholder="Paste one serial per line or from a spreadsheet column" className="min-h-16 resize-y bg-white text-xs" />
            </div>
            <Button type="button" variant="outline" onClick={applyPaste} disabled={!parseSerialNumberPaste(pasteValue).length}>Apply list</Button>
          </div>

          <div className="max-h-[min(25rem,52dvh)] space-y-2 overflow-y-auto px-5 py-4">
            {Array.from({ length: Math.max(requiredCount, working.length) }, (_, index) => {
              const key = normalized[index]
              const repeated = !!key && duplicates.has(key)
              const excess = index >= requiredCount
              return (
                <div key={index} className={`grid grid-cols-[1.75rem_minmax(0,1fr)_2rem] items-center gap-2 rounded-md ${repeated || excess ? 'bg-destructive/5' : ''}`}>
                  <span className="text-center text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                  <Input
                    data-dialog-autofocus={index === 0 ? '' : undefined}
                    value={working[index] || ''}
                    onChange={event => replaceSerial(index, event.target.value)}
                    aria-label={`Opening serial number ${index + 1}`}
                    placeholder="Enter or scan serial number…"
                    autoComplete="off"
                    className={`h-9 font-mono text-xs ${repeated ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                  />
                  <Button type="button" variant="ghost" size="icon" disabled={!working[index]} onClick={() => replaceSerial(index, '')} aria-label={`Clear opening serial number ${index + 1}`} className="h-8 w-8 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></Button>
                  {(repeated || excess) && <p className="col-start-2 col-span-2 -mt-1 text-[11px] text-destructive">{excess ? 'Remove this excess serial after reducing the opening quantity.' : 'This serial number is repeated in the opening stock.'}</p>}
                </div>
              )
            })}
          </div>

          <DialogFooter className="border-t border-border bg-[#fafbfc] px-5 py-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={assign} disabled={!valid}>Assign {requiredCount} serial{requiredCount === 1 ? '' : 's'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
