import { todayBs } from '@/lib/nepaliDate'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
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
  const fiscalStart = selectedFiscalYearStartBs(company)
  const fiscalEnd = selectedFiscalYearEndBs(company)
  const applyPreset = (preset: Exclude<ReportRange, 'custom'>) => {
    onRangeChange(preset)
    if (preset === 'today') {
      const effectiveToday = todayBs() < fiscalStart || todayBs() > fiscalEnd ? fiscalEnd : todayBs()
      onFromChange(effectiveToday)
      onToChange(effectiveToday)
    } else if (preset === 'month') {
      const effectiveEnd = todayBs() < fiscalStart || todayBs() > fiscalEnd ? fiscalEnd : todayBs()
      const monthStart = `${effectiveEnd.slice(0, 7)}-01`
      onFromChange(monthStart < fiscalStart ? fiscalStart : monthStart)
      onToChange(effectiveEnd)
    } else {
      onFromChange(selectedFiscalYearStartBs(company))
      onToChange(selectedFiscalYearEndBs(company))
    }
  }

  return (
    <div className="report-filters flex w-full flex-wrap items-end gap-3">
      <div className="flex w-full flex-wrap gap-2 lg:w-auto">
        <Button variant={range === 'today' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('today')}>Today</Button>
        <Button variant={range === 'month' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('month')}>This Month</Button>
        <Button variant={range === 'fiscal' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('fiscal')}>Fiscal Year</Button>
        <Button variant={range === 'custom' ? 'default' : 'outline'} size="sm" onClick={() => onRangeChange('custom')}>Custom</Button>
      </div>
      <div className="min-w-[8.5rem] flex-1 space-y-1.5 sm:flex-none">
        <Label>From</Label>
        <NepaliDateInput value={from} min={fiscalStart} max={to < fiscalEnd ? to : fiscalEnd} onChange={value => { onFromChange(value); onRangeChange('custom') }} className="w-full sm:w-40" />
      </div>
      <div className="min-w-[8.5rem] flex-1 space-y-1.5 sm:flex-none">
        <Label>To</Label>
        <NepaliDateInput value={to} min={from > fiscalStart ? from : fiscalStart} max={fiscalEnd} onChange={value => { onToChange(value); onRangeChange('custom') }} className="w-full sm:w-40" />
      </div>
    </div>
  )
}
