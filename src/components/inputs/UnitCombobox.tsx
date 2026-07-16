import { useMemo, useState } from 'react'
import { ERP_ITEM_UNITS, isKnownItemUnit, isValidCustomItemUnit } from '@/lib/itemUnits'
import { SearchableSelect } from '@/components/inputs/SearchableSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/store/useAppStore'

const NO_ALTERNATIVE_UNIT = '__no_alternative_unit__'
const CREATE_CUSTOM_UNIT = '__create_custom_unit__'

interface UnitComboboxProps {
  value: string
  onValueChange: (value: string) => void
  optional?: boolean
  exclude?: string[]
  disabled?: boolean
  className?: string
  id?: string
}

export function UnitCombobox({ value, onValueChange, optional = false, exclude = [], disabled, className, id }: UnitComboboxProps) {
  const items = useAppStore(state => state.items)
  const [customOpen, setCustomOpen] = useState(false)
  const [customUnit, setCustomUnit] = useState('')
  const [customError, setCustomError] = useState('')
  const options = useMemo(() => {
    const excluded = new Set(exclude.filter(Boolean).map(unit => unit.trim().toLowerCase()))
    const standard = ERP_ITEM_UNITS
      .filter(unit => !excluded.has(unit.value.toLowerCase()))
      .map(unit => ({ value: unit.value, label: unit.label, group: unit.group, searchText: `${unit.value} ${unit.label} ${unit.aliases || ''}` }))
    const companyCustom = [...new Map(items
      .flatMap(item => [item.unit, item.alternate_unit || ''])
      .filter(unit => unit && !isKnownItemUnit(unit) && !excluded.has(unit.trim().toLowerCase()))
      .map(unit => [unit.trim().toLowerCase(), unit.trim()])).values()]
      .map(unit => ({ value: unit, label: unit, group: 'Company custom units', searchText: `${unit} custom company unit` }))
    const customValues = new Set(companyCustom.map(unit => unit.value.toLowerCase()))
    const legacy = value && !isKnownItemUnit(value) && !excluded.has(value.trim().toLowerCase()) && !customValues.has(value.trim().toLowerCase())
      ? [{ value, label: `${value} (Existing custom unit)`, group: 'Existing item', searchText: `${value} legacy custom` }]
      : []
    const custom = [{ value: CREATE_CUSTOM_UNIT, label: '+ Add custom unit…', group: 'Custom', searchText: 'custom other add new unit uom' }]
    return optional
      ? [{ value: NO_ALTERNATIVE_UNIT, label: 'No alternative unit', group: 'Optional' }, ...legacy, ...companyCustom, ...standard, ...custom]
      : [...legacy, ...companyCustom, ...standard, ...custom]
  }, [exclude, items, optional, value])

  const openCustom = () => {
    setCustomUnit('')
    setCustomError('')
    setCustomOpen(true)
  }

  const saveCustom = () => {
    const next = customUnit.trim().replace(/\s+/g, ' ')
    if (!isValidCustomItemUnit(next)) {
      setCustomError('Use 1–20 characters: letters, numbers, spaces, or symbols such as /, %, °, -, _, and .')
      return
    }
    if (exclude.some(unit => unit.trim().toLowerCase() === next.toLowerCase())) {
      setCustomError('Main and alternative units must be different.')
      return
    }
    onValueChange(next)
    setCustomOpen(false)
  }

  return <>
    <SearchableSelect
      id={id}
      value={optional && !value ? NO_ALTERNATIVE_UNIT : value}
      onValueChange={next => {
        if (next === CREATE_CUSTOM_UNIT) openCustom()
        else onValueChange(next === NO_ALTERNATIVE_UNIT ? '' : next)
      }}
      options={options}
      placeholder={optional ? 'No alternative unit' : 'Select unit'}
      searchPlaceholder="Search units…"
      emptyText="No matching units"
      disabled={disabled}
      className={className}
    />
    <Dialog open={customOpen} onOpenChange={setCustomOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Custom Unit</DialogTitle></DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor={`${id || 'unit'}-custom`}>Unit name or abbreviation</Label>
          <Input id={`${id || 'unit'}-custom`} value={customUnit} onChange={event => { setCustomUnit(event.target.value); setCustomError('') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveCustom() } }} placeholder="e.g. Tray, Sheet, Ropani" maxLength={20} autoFocus />
          <p className="text-[11px] text-muted-foreground">After the item is saved, this unit will appear under Company custom units for future items.</p>
          {customError && <p className="text-xs text-destructive">{customError}</p>}
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setCustomOpen(false)}>Cancel</Button><Button type="button" onClick={saveCustom}>Use Unit</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
