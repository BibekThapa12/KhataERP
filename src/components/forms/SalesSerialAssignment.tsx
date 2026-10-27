import { useEffect, useMemo, useState } from 'react'
import { Barcode, Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { fetchInventorySerialCandidates } from '@/lib/supabase'
import { normalizedSerialKey, serializedQuantityRequirement } from '@/lib/serialAssignment'
import type { InventorySerialCandidate } from '@/types'

interface InvoiceSerialAssignmentProps {
  mode: 'sale' | 'purchase' | 'sales_return' | 'purchase_return'
  companyId: string
  itemId: string
  itemName: string
  quantity: number
  conversionFactor: number
  entryUnit: string
  value?: string[]
  excludedSerials?: string[]
  sourceVoucherId?: string | null
  excludeVoucherId?: string | null
  disabled?: boolean
  disabledReason?: string
  onChange: (serials: string[]) => void
}

const EMPTY_SERIALS: string[] = []

export function InvoiceSerialAssignment({
  mode,
  companyId,
  itemId,
  itemName,
  quantity,
  conversionFactor,
  entryUnit,
  value = EMPTY_SERIALS,
  excludedSerials = EMPTY_SERIALS,
  sourceVoucherId,
  excludeVoucherId,
  disabled = false,
  disabledReason,
  onChange,
}: InvoiceSerialAssignmentProps) {
  const usesCandidates = mode !== 'purchase'
  const isReturn = mode === 'sales_return' || mode === 'purchase_return'
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState<string[]>(value)
  const [candidates, setCandidates] = useState<InventorySerialCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requirement = serializedQuantityRequirement(quantity, conversionFactor)
  const committedCount = value.filter(serial => serial.trim()).length
  const excludedKeys = useMemo(() => new Set(excludedSerials.map(normalizedSerialKey)), [excludedSerials])
  const candidateByKey = useMemo(() => new Map(candidates.map(candidate => [normalizedSerialKey(candidate.serial_number), candidate])), [candidates])

  useEffect(() => {
    if (!open) return
    setWorking(value)
    setCandidates([])
    setError('')
    if (!usesCandidates) {
      setLoading(false)
      return
    }
    setLoading(true)
    fetchInventorySerialCandidates({ companyId, itemId, mode, sourceVoucherId, excludeVoucherId })
      .then(setCandidates)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load available serial numbers.'))
      .finally(() => setLoading(false))
  }, [companyId, excludeVoucherId, itemId, mode, open, sourceVoucherId, usesCandidates, value])

  const workingKeys = working.map(normalizedSerialKey)
  const distinctWorking = new Set(workingKeys.filter(Boolean))
  const invalidSelections = working.filter(serial => {
    const key = normalizedSerialKey(serial)
    const repeatedHere = workingKeys.filter(workingKey => workingKey === key).length > 1
    return !!key && (repeatedHere || excludedKeys.has(key) || (usesCandidates && !candidateByKey.has(key)))
  })
  const validAssignment = requirement.valid
    && working.length === requirement.requiredCount
    && working.every(serial => serial.trim())
    && distinctWorking.size === requirement.requiredCount
    && invalidSelections.length === 0
    && !loading
    && !error
  const fieldCount = Math.max(requirement.requiredCount, working.length)
  const committedKeys = value.map(normalizedSerialKey).filter(Boolean)
  const complete = requirement.valid
    && committedCount === requirement.requiredCount
    && new Set(committedKeys).size === requirement.requiredCount
    && committedKeys.every(key => !excludedKeys.has(key))

  const explanation = requirement.valid
    ? `${quantity} ${entryUnit || 'unit'} equals ${requirement.requiredCount} serialized ${requirement.requiredCount === 1 ? 'unit' : 'units'}.`
    : requirement.reason === 'fractional_quantity'
      ? `${quantity || 0} ${entryUnit || 'unit'} converts to ${requirement.baseQuantity} serialized units. Enter a quantity that produces a whole unit count.`
      : 'Enter a positive quantity before assigning serial numbers.'
  const candidateHint = isReturn && sourceVoucherId
    ? 'Choose from the source document'
    : mode === 'sales_return'
      ? 'Choose a sold serial'
      : mode === 'purchase_return'
        ? 'Choose an available purchased serial'
        : usesCandidates
          ? 'Each serial can be used once'
          : 'Scan or enter each new serial'

  const replaceSelection = (index: number, serial: string) => {
    setWorking(current => {
      const next = [...current]
      next[index] = serial
      return next
    })
    setError('')
  }

  const clearSelection = (index: number) => {
    setWorking(current => {
      const next = [...current]
      next.splice(index, 1)
      return next
    })
    setError('')
  }

  const optionsFor = (index: number) => {
    const ownKey = normalizedSerialKey(working[index] || '')
    const selectedElsewhere = new Set(workingKeys.filter((key, position) => position !== index && key))
    return candidates
      .filter(candidate => {
        const key = normalizedSerialKey(candidate.serial_number)
        return key === ownKey || (!selectedElsewhere.has(key) && !excludedKeys.has(key))
      })
      .map(candidate => ({ value: candidate.serial_number, label: candidate.serial_number }))
  }

  const assign = () => {
    if (!validAssignment) return
    onChange(working.map(serial => serial.trim()))
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !requirement.valid}
        aria-label={`Assign serial numbers for ${itemName}`}
        title={disabled ? disabledReason : requirement.valid ? `Assign serial numbers for ${itemName}` : explanation}
        onClick={() => setOpen(true)}
        className={`h-8 min-w-0 justify-center overflow-hidden shadow-none ${requirement.valid ? 'w-full gap-1.5 px-2' : 'w-8 px-0'} ${
          complete
            ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900'
            : requirement.valid
              ? 'border-amber-300 bg-amber-50/60 text-amber-900 hover:bg-amber-50 hover:text-amber-950'
              : 'border-amber-300 bg-white text-amber-700 disabled:opacity-70'
        }`}
      >
        {complete ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
        {requirement.valid && (
          <span className="min-w-0 truncate text-[11px] font-semibold tabular-nums">
            {committedCount} / {requirement.requiredCount}
            <span className="sr-only"> serials assigned</span>
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[38rem] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-[17px]">
              <Barcode className="h-4 w-4 text-primary" /> Assign serial numbers
            </DialogTitle>
            <DialogDescription className="pt-1 text-xs">
              <span className="font-medium text-foreground">{itemName}</span> · {explanation}
            </DialogDescription>
          </DialogHeader>

          <div className="border-b border-border bg-muted/30 px-5 py-2.5">
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="font-medium text-foreground">{working.filter(serial => serial.trim()).length} of {requirement.requiredCount} selected</span>
              <span className="text-muted-foreground">{candidateHint}</span>
            </div>
          </div>

          <div className="max-h-[min(25rem,55dvh)] space-y-2.5 overflow-y-auto px-5 py-4">
            {Array.from({ length: fieldCount }, (_, index) => {
              const isExcess = index >= requirement.requiredCount
              const selectedKey = normalizedSerialKey(working[index] || '')
              const repeatedHere = !!selectedKey && workingKeys.filter(key => key === selectedKey).length > 1
              const invalid = !!selectedKey && (repeatedHere || excludedKeys.has(selectedKey) || (usesCandidates && !candidateByKey.has(selectedKey)))
              return (
                <div key={index} className={`grid grid-cols-[1.75rem_minmax(0,1fr)_2rem] items-center gap-2 rounded-md ${isExcess || invalid ? 'bg-destructive/5' : ''}`}>
                  <span className="text-center text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                  {usesCandidates ? (
                    <SearchableSelect
                      mode="typeahead"
                      value={working[index] || ''}
                      onValueChange={serial => replaceSelection(index, serial)}
                      options={optionsFor(index)}
                      searchPlaceholder="Search available serial…"
                      loading={loading}
                      loadingText="Loading available serials…"
                      emptyText="No serials are available for this item."
                      noResultsText="No matching available serials."
                      disabled={loading || !!error || isExcess}
                      ariaLabel={`Serial number ${index + 1} for ${itemName}`}
                      autoFocus={index === 0}
                      contentClassName="z-[90]"
                      className={invalid ? '[&_input]:border-destructive' : undefined}
                    />
                  ) : (
                    <Input
                      data-dialog-autofocus={index === 0 ? '' : undefined}
                      value={working[index] || ''}
                      onChange={event => replaceSelection(index, event.target.value)}
                      disabled={isExcess}
                      aria-label={`Serial number ${index + 1} for ${itemName}`}
                      placeholder="Enter or scan serial number…"
                      autoComplete="off"
                      className={`h-9 font-mono text-xs ${invalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!working[index]}
                    onClick={() => clearSelection(index)}
                    aria-label={`Clear serial number ${index + 1}`}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  {(isExcess || invalid) && (
                    <p className="col-start-2 col-span-2 -mt-1 text-[11px] text-destructive">
                      {isExcess
                        ? 'Remove this excess selection after reducing the quantity.'
                        : repeatedHere || excludedKeys.has(selectedKey)
                          ? 'This serial is already assigned elsewhere on this invoice.'
                          : 'This serial is no longer available. Clear it and choose another.'}
                    </p>
                  )}
                </div>
              )
            })}
            {!fieldCount && <p className="py-8 text-center text-sm text-muted-foreground">{explanation}</p>}
            {usesCandidates && !loading && requirement.valid && candidates.filter(candidate => !excludedKeys.has(normalizedSerialKey(candidate.serial_number))).length < requirement.requiredCount && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Only {candidates.filter(candidate => !excludedKeys.has(normalizedSerialKey(candidate.serial_number))).length} eligible serials are currently available for {requirement.requiredCount} required units.
              </p>
            )}
            {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error} Close and reopen this window to retry.</p>}
          </div>

          <DialogFooter className="border-t border-border bg-[#fafbfc] px-5 py-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!validAssignment} onClick={assign}>
              Assign {requirement.requiredCount} {requirement.requiredCount === 1 ? 'serial' : 'serials'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
