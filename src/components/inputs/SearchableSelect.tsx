import { useEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { filterSearchableOptions, groupSearchableOptions } from '@/lib/search'

export interface SearchableSelectOption {
  value: string
  label: string
  searchText?: string
  group?: string
  disabled?: boolean
}

interface SearchableSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  id?: string
}

export function SearchableSelect({
  value, onValueChange, options, placeholder = 'Select…', searchPlaceholder = 'Search…',
  emptyText = 'No matching options', disabled, className, id,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const suppressNextFocus = useRef(false)
  const scrollFrame = useRef<number | null>(null)
  const scrollTarget = useRef(0)
  const uniqueOptions = useMemo(() => [...new Map(options.map(option => [option.value, option])).values()], [options])
  const filtered = useMemo(() => groupSearchableOptions(filterSearchableOptions(uniqueOptions, query)), [uniqueOptions, query])
  const enabled = filtered.filter(option => !option.disabled)
  const selected = uniqueOptions.find(option => option.value === value)

  useEffect(() => {
    if (!open) { setQuery(''); setActiveIndex(0); return }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => () => {
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current)
  }, [])

  const scrollList = (element: HTMLDivElement, delta: number) => {
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
    if (scrollFrame.current === null) scrollTarget.current = element.scrollTop
    scrollTarget.current = Math.max(0, Math.min(maximum, scrollTarget.current + delta))
    if (scrollFrame.current !== null) return

    const step = () => {
      const distance = scrollTarget.current - element.scrollTop
      if (Math.abs(distance) < 0.5) {
        element.scrollTop = scrollTarget.current
        scrollFrame.current = null
        return
      }
      element.scrollTop += distance * 0.24
      scrollFrame.current = window.requestAnimationFrame(step)
    }
    scrollFrame.current = window.requestAnimationFrame(step)
  }

  const select = (option: SearchableSelectOption) => {
    if (option.disabled) return
    suppressNextFocus.current = true
    onValueChange(option.value)
    setOpen(false)
  }

  const openOnFocus = () => {
    if (suppressNextFocus.current) {
      suppressNextFocus.current = false
      return
    }
    // Delay until after the trigger's click handler so mouse focus and
    // keyboard Tab focus both leave the popover open.
    window.setTimeout(() => setOpen(true), 0)
  }

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button id={id} type="button" role="combobox" aria-expanded={open} disabled={disabled} onFocus={openOnFocus} className={cn('flex h-9 min-w-0 w-full max-w-full items-center justify-between overflow-hidden rounded-md border border-input bg-background px-2.5 py-1 text-left text-[12px] shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50', className)}>
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')} title={selected?.label}>{selected?.label || placeholder}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content collisionPadding={8} sideOffset={4} align="start" className="compact-workspace-surface z-[80] w-[var(--radix-popover-trigger-width)] min-w-[min(14rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        <div className="relative border-b p-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input ref={inputRef} value={query} onChange={event => { setQuery(event.target.value); setActiveIndex(0) }} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => enabled.length ? (index + 1) % enabled.length : 0) }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => enabled.length ? (index - 1 + enabled.length) % enabled.length : 0) }
            if (event.key === 'Enter' && enabled[activeIndex]) { event.preventDefault(); select(enabled[activeIndex]) }
            if (event.key === 'Escape') { suppressNextFocus.current = true; setOpen(false) }
          }} placeholder={searchPlaceholder} className="h-7 w-full rounded-sm bg-transparent pl-7 pr-2 text-[12px] outline-none placeholder:text-muted-foreground" />
        </div>
        <div
          role="listbox"
          onWheelCapture={event => {
            event.preventDefault()
            event.stopPropagation()
            scrollList(event.currentTarget, event.deltaY)
          }}
          className="max-h-72 overscroll-contain overflow-y-auto p-1"
        >
          {!filtered.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>}
          {filtered.map((option, index) => {
            const previousGroup = index > 0 ? filtered[index - 1].group : undefined
            const enabledIndex = enabled.findIndex(entry => entry.value === option.value)
            return <div key={option.value}>
              {option.group && option.group !== previousGroup && <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">{option.group}</p>}
              <button type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onMouseEnter={() => enabledIndex >= 0 && setActiveIndex(enabledIndex)} onClick={() => select(option)} className={cn('relative flex w-full items-center rounded-sm py-1 pl-7 pr-2 text-left text-[12px] outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50', enabledIndex === activeIndex && 'bg-accent text-accent-foreground')}>
                {option.value === value && <Check className="absolute left-2 h-4 w-4" />}
                <span className="truncate">{option.label}</span>
              </button>
            </div>
          })}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
