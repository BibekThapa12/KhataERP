import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addDaysToBs,
  BS_MONTH_NAMES,
  BS_WEEKDAY_NAMES,
  bsToAd,
  compareBsDates,
  formatBsParts,
  getBsMonthLength,
  getBsWeekday,
  parseBsDate,
  shiftBsMonth,
  todayBs,
} from '@/lib/nepaliDate'
import { cn } from '@/lib/utils'

interface NepaliCalendarProps {
  value: string
  onSelect: (value: string) => void
  min?: string
  max?: string
  allowClear?: boolean
  onClose?: () => void
}

function formatAdDate(bsDate: string) {
  try {
    return new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' })
      .format(new Date(`${bsToAd(bsDate)}T12:00:00+05:45`))
  } catch {
    return ''
  }
}

export function NepaliCalendar({ value, onSelect, min, max, allowClear = false, onClose }: NepaliCalendarProps) {
  const today = todayBs()
  const selected = parseBsDate(value)
  const initial = selected || parseBsDate(today)!
  const [view, setView] = useState({ year: initial.year, month: initial.month })

  useEffect(() => {
    if (selected) setView({ year: selected.year, month: selected.month })
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const monthLength = getBsMonthLength(view.year, view.month)
  const firstDate = formatBsParts({ ...view, day: 1 })
  const firstWeekday = monthLength ? getBsWeekday(firstDate) : 0
  const days = useMemo(() => Array.from({ length: monthLength }, (_, index) => index + 1), [monthLength])

  const isDisabled = (date: string) => Boolean(
    (min && parseBsDate(min) && compareBsDates(date, min) < 0) ||
    (max && parseBsDate(max) && compareBsDates(date, max) > 0)
  )

  const moveMonth = (offset: number) => setView(current => {
    const target = shiftBsMonth(current.year, current.month, offset)
    return getBsMonthLength(target.year, target.month) ? target : current
  })
  const choose = (date: string) => {
    if (isDisabled(date)) return
    onSelect(date)
    onClose?.()
  }

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    let target = date
    if (event.key in offsets) target = addDaysToBs(date, offsets[event.key])
    else if (event.key === 'Home') target = addDaysToBs(date, -getBsWeekday(date))
    else if (event.key === 'End') target = addDaysToBs(date, 6 - getBsWeekday(date))
    else if (event.key === 'PageUp') {
      const previous = shiftBsMonth(view.year, view.month, -1)
      target = formatBsParts({ ...previous, day: Math.min(parseBsDate(date)!.day, getBsMonthLength(previous.year, previous.month)) })
    } else if (event.key === 'PageDown') {
      const next = shiftBsMonth(view.year, view.month, 1)
      target = formatBsParts({ ...next, day: Math.min(parseBsDate(date)!.day, getBsMonthLength(next.year, next.month)) })
    } else return

    event.preventDefault()
    if (isDisabled(target)) return
    const parts = parseBsDate(target)
    if (!parts) return
    setView({ year: parts.year, month: parts.month })
    window.requestAnimationFrame(() => document.getElementById(`bs-day-${target}`)?.focus())
  }

  const selectedAd = selected ? formatAdDate(value) : ''

  return (
    <div className="w-[18rem] max-w-[calc(100vw-1rem)] select-none p-2" aria-label="Nepali date calendar">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous Nepali month" onClick={() => moveMonth(-1)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold">{BS_MONTH_NAMES[view.month - 1]} {view.year}</p>
          <p className="text-[10px] text-muted-foreground">Bikram Sambat</p>
        </div>
        <button type="button" aria-label="Next Nepali month" onClick={() => moveMonth(1)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7" role="row">
        {BS_WEEKDAY_NAMES.map(day => <div key={day} className="py-1 text-center text-[10px] font-semibold text-muted-foreground" role="columnheader">{day}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5" role="grid" aria-label={`${BS_MONTH_NAMES[view.month - 1]} ${view.year}`}>
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} />)}
        {days.map(day => {
          const date = formatBsParts({ ...view, day })
          const active = date === value
          const current = date === today
          const disabled = isDisabled(date)
          return (
            <button
              id={`bs-day-${date}`}
              key={date}
              type="button"
              role="gridcell"
              aria-selected={active}
              aria-current={current ? 'date' : undefined}
              aria-label={`${BS_MONTH_NAMES[view.month - 1]} ${day}, ${view.year}`}
              disabled={disabled}
              tabIndex={active || (!selected && current) ? 0 : -1}
              onClick={() => choose(date)}
              onKeyDown={event => handleDayKeyDown(event, date)}
              className={cn(
                'relative flex h-8 items-center justify-center rounded-md text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30',
                active && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
                current && !active && 'font-bold text-primary after:absolute after:bottom-0.5 after:h-1 after:w-1 after:rounded-full after:bg-primary',
              )}
            >{day}</button>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t pt-2">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground">{selectedAd ? `AD ${selectedAd}` : 'Select a BS date'}</p>
        </div>
        <div className="flex gap-1">
          {allowClear && value && <button type="button" onClick={() => { onSelect(''); onClose?.() }} className="h-7 rounded-md px-2 text-[11px] font-semibold text-muted-foreground hover:bg-accent">Clear</button>}
          <button type="button" disabled={isDisabled(today)} onClick={() => choose(today)} className="h-7 rounded-md border border-input px-2 text-[11px] font-semibold hover:bg-accent disabled:opacity-50">Today</button>
        </div>
      </div>
    </div>
  )
}
