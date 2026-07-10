import { firstOfCurrentBsMonth, todayBs } from '@/lib/nepaliDate'
import { fiscalYearStartBs } from '@/lib/reports'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import type { Company } from '@/types'

export type ReportRange = 'today' | 'month' | 'fiscal' | 'custom'

interface ReportDateFiltersProps {
  company: Company | null
  range: ReportRange
  from: string
  to: string
  onRangeChange: (range: ReportRange) => void
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}

export function ReportDateFilters({ company, range, from, to, onRangeChange, onFromChange, onToChange }: ReportDateFiltersProps) {
  const applyPreset = (preset: Exclude<ReportRange, 'custom'>) => {
    onRangeChange(preset)
    if (preset === 'today') {
      onFromChange(todayBs())
      onToChange(todayBs())
    } else if (preset === 'month') {
      onFromChange(firstOfCurrentBsMonth())
      onToChange(todayBs())
    } else {
      onFromChange(fiscalYearStartBs(company))
      onToChange(todayBs())
    }
  }

  return (
    <div className="report-filters flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant={range === 'today' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('today')}>Today</Button>
        <Button variant={range === 'month' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('month')}>This Month</Button>
        <Button variant={range === 'fiscal' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('fiscal')}>Fiscal Year</Button>
        <Button variant={range === 'custom' ? 'default' : 'outline'} size="sm" onClick={() => onRangeChange('custom')}>Custom</Button>
      </div>
      <div className="space-y-1.5">
        <Label>From</Label>
        <NepaliDateInput value={from} onChange={value => { onFromChange(value); onRangeChange('custom') }} className="w-40" />
      </div>
      <div className="space-y-1.5">
        <Label>To</Label>
        <NepaliDateInput value={to} onChange={value => { onToChange(value); onRangeChange('custom') }} className="w-40" />
      </div>
    </div>
  )
}
