import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { normalizeBsDateInput, parseBsDate } from '@/lib/nepaliDate'
import { cn } from '@/lib/utils'

interface NepaliDateInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export function NepaliDateInput({ value, onChange, className }: NepaliDateInputProps) {
  const [focused, setFocused] = useState(false)
  const invalid = useMemo(() => !focused && value.length > 0 && !parseBsDate(value), [focused, value])
  const handleChange = (nextValue: string) => onChange(normalizeBsDateInput(nextValue) || nextValue)

  return (
    <div className={className}>
      <Input
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="2083-03-21"
        inputMode="numeric"
        className={cn(invalid && 'border-destructive focus-visible:ring-destructive')}
      />
      {invalid && <p className="mt-1 text-xs text-destructive">Use YYYY-MM-DD BS format.</p>}
    </div>
  )
}
