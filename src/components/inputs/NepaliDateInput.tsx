import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CalendarDays } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { normalizeBsDateInput, parseBsDate } from '@/lib/nepaliDate'
import { cn } from '@/lib/utils'
import { NepaliCalendar } from '@/components/inputs/NepaliCalendar'

export interface NepaliDateInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
  min?: string
  max?: string
  disabled?: boolean
  required?: boolean
  allowClear?: boolean
  placeholder?: string
  id?: string
}

export function NepaliDateInput({
  value, onChange, className, min, max, disabled, required, allowClear = false,
  placeholder = '2083-03-21', id,
}: NepaliDateInputProps) {
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const invalid = useMemo(() => {
    if (focused || !value.length) return false
    const parsed = parseBsDate(value)
    if (!parsed) return true
    if (min && parseBsDate(min) && value < min) return true
    if (max && parseBsDate(max) && value > max) return true
    return false
  }, [focused, max, min, value])
  const handleChange = (nextValue: string) => onChange(normalizeBsDateInput(nextValue) || nextValue)

  const handleBlur = () => {
    setFocused(false)
    const normalized = normalizeBsDateInput(value)
    if (normalized && normalized !== value) onChange(normalized)
  }

  return (
    <div className={className}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Anchor asChild>
          <div className="relative">
            <Input
              id={id}
              value={value}
              onChange={e => handleChange(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={handleBlur}
              placeholder={placeholder}
              inputMode="numeric"
              autoComplete="off"
              disabled={disabled}
              required={required}
              aria-invalid={invalid}
              className={cn('pr-9', invalid && 'border-destructive focus-visible:ring-destructive')}
            />
            <Popover.Trigger asChild>
              <button type="button" disabled={disabled} aria-label="Open Nepali date calendar" className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
                <CalendarDays className="h-4 w-4" />
              </button>
            </Popover.Trigger>
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={event => event.preventDefault()}
            className="compact-workspace-surface z-[90] max-w-[calc(100vw-1rem)] rounded-md border bg-popover text-popover-foreground shadow-lg"
          >
            <NepaliCalendar value={value} onSelect={onChange} min={min} max={max} allowClear={allowClear} onClose={() => setOpen(false)} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {invalid && <p className="mt-1 text-xs text-destructive">Enter a valid BS date{min || max ? ' within the allowed range' : ''}.</p>}
    </div>
  )
}
