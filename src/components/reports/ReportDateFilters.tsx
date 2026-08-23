import { todayBs } from '@/lib/nepaliDate'
import { selectedFiscalYearEndBs, selectedFiscalYearStartBs } from '@/lib/reports'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NepaliDateInput } from '@/components/inputs/NepaliDateInput'
import type { Company } from '@/types'
import type { ReactNode } from 'react'

export type ReportRange = 'today' | 'month' | 'fiscal' | 'custom'

interface ReportDateFiltersProps {
  company: Company | null
  range: ReportRange
  from: string
  to: string
  onRangeChange: (range: ReportRange) => void
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  endActions?: ReactNode
}

export function ReportDateFilters({ company, range, from, to, onRangeChange, onFromChange, onToChange, endActions }: ReportDateFiltersProps) {
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
    <div className="report-filters flex w-full flex-nowrap items-start gap-3 overflow-x-auto pb-1">
      <div className="flex shrink-0 gap-2 pt-[1.375rem]">
        <Button variant={range === 'today' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('today')}>Today</Button>
        <Button variant={range === 'month' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('month')}>This Month</Button>
        <Button variant={range === 'fiscal' ? 'default' : 'outline'} size="sm" onClick={() => applyPreset('fiscal')}>Fiscal Year</Button>
        <Button variant={range === 'custom' ? 'default' : 'outline'} size="sm" onClick={() => onRangeChange('custom')}>Custom</Button>
      </div>
      <div className="w-40 shrink-0 space-y-1.5">
        <Label>From</Label>
        <NepaliDateInput value={from} min={fiscalStart} max={to < fiscalEnd ? to : fiscalEnd} onChange={value => { onFromChange(value); onRangeChange('custom') }} className="w-full sm:w-40" />
      </div>
      <div className="w-40 shrink-0 space-y-1.5">
        <Label>To</Label>
        <NepaliDateInput value={to} min={from > fiscalStart ? from : fiscalStart} max={fiscalEnd} onChange={value => { onToChange(value); onRangeChange('custom') }} className="w-full sm:w-40" />
      </div>
      {endActions ? <div className="shrink-0 pt-[1.375rem]">{endActions}</div> : null}
    </div>
  )
}
