import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { parseBsDate } from '@/lib/nepaliDate'
import { cn } from '@/lib/utils'

interface NepaliDateInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export function NepaliDateInput({ value, onChange, className }: NepaliDateInputProps) {
  const invalid = useMemo(() => value.length > 0 && !parseBsDate(value), [value])

  return (
    <div className={className}>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="2083-03-21"
        inputMode="numeric"
        className={cn(invalid && 'border-destructive focus-visible:ring-destructive')}
      />
      {invalid && <p className="mt-1 text-xs text-destructive">Use YYYY-MM-DD BS format.</p>}
    </div>
  )
}
