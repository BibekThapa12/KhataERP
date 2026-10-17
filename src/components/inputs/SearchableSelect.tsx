import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, Ref } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { filterSearchableOptions, groupSearchableOptions } from '@/lib/search'
import { CLOSE_SEARCHABLE_SELECTS_EVENT, type CloseSearchableSelectsDetail } from '@/lib/searchableSelectFocus'

export interface SearchableSelectOption {
  value: string
  label: string
  secondaryText?: string
  trailingText?: string
  searchText?: string
  group?: string
  disabled?: boolean
}

interface SearchableSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SearchableSelectOption[]
  mode?: 'typeahead' | 'select'
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  noResultsText?: string
  emptyMessage?: string
  loading?: boolean
  loadingText?: string
  disabled?: boolean
  className?: string
  contentClassName?: string
  id?: string
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  autoFocus?: boolean
  openOnFocus?: boolean
  tabIndex?: number
  triggerRef?: Ref<HTMLElement>
  onTriggerFocus?: () => void
}

function assignRef(ref: Ref<HTMLElement> | undefined, element: HTMLElement | null) {
  if (typeof ref === 'function') ref(element)
  else if (ref) ref.current = element
}

export function SearchableSelect({
  value, onValueChange, options, mode = 'select', placeholder = 'Select…', searchPlaceholder = 'Search…',
  emptyText = 'No options available', noResultsText, emptyMessage, loading = false, loadingText = 'Loading options…',
  disabled, className, contentClassName, id, ariaLabel, ariaLabelledBy, ariaDescribedBy, autoFocus,
  openOnFocus = false, tabIndex, triggerRef, onTriggerFocus,
}: SearchableSelectProps) {
  const generatedId = useId()
  const controlId = id || `searchable-select-${generatedId}`
  const listboxId = `${controlId}-listbox`
  const statusId = `${controlId}-status`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [queryStarted, setQueryStarted] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const internalTriggerRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())
  const suppressNextFocus = useRef(false)
  const focusCameFromPointer = useRef(false)
  const scrollFrame = useRef<number | null>(null)
  const scrollTarget = useRef(0)
  const uniqueOptions = useMemo(() => [...new Map(options.map(option => [option.value, option])).values()], [options])
  const filtered = useMemo(() => groupSearchableOptions(filterSearchableOptions(uniqueOptions, queryStarted ? query : '')), [uniqueOptions, query, queryStarted])
  const enabled = filtered.filter(option => !option.disabled)
  const activeValue = enabled[activeIndex]?.value
  const selected = uniqueOptions.find(option => option.value === value)
  const visibleInputValue = open && queryStarted ? query : selected?.label || ''
  const resolvedNoResultsText = noResultsText || emptyMessage || 'No matching options'
  const hasQuery = queryStarted && query.trim().length > 0

  const resetSearch = () => { setQuery(''); setQueryStarted(false); setActiveIndex(0) }
  const closeAndReset = () => { suppressNextFocus.current = true; resetSearch(); setOpen(false) }
  const handleOpenChange = (nextOpen: boolean) => { setOpen(nextOpen); if (!nextOpen) resetSearch() }

  useEffect(() => {
    if (!open) return
    const selectedIndex = enabled.findIndex(option => option.value === value)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    const timer = window.setTimeout(() => {
      if (mode === 'typeahead') {
        inputRef.current?.focus({ preventScroll: true })
        if (!queryStarted && selected) inputRef.current?.select()
      }
    }, 0)
    return () => window.clearTimeout(timer)
  // The opening transition owns the initial active option; filtering owns it afterward.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  useEffect(() => {
    if (activeIndex >= enabled.length) setActiveIndex(enabled.length ? enabled.length - 1 : 0)
  }, [activeIndex, enabled.length])

  useEffect(() => {
    const closeForNestedCreator = (event: Event) => {
      if (!open) return
      const detail = (event as CustomEvent<CloseSearchableSelectsDetail>).detail
      if (detail && !detail.returnFocus) detail.returnFocus = internalTriggerRef.current
      suppressNextFocus.current = true
      resetSearch()
      setOpen(false)
    }
    window.addEventListener(CLOSE_SEARCHABLE_SELECTS_EVENT, closeForNestedCreator)
    return () => window.removeEventListener(CLOSE_SEARCHABLE_SELECTS_EVENT, closeForNestedCreator)
  }, [open])

  useEffect(() => {
    if (!open || !activeValue) return
    const list = listRef.current
    const option = optionRefs.current.get(activeValue)
    if (!list || !option) return
    const listBounds = list.getBoundingClientRect()
    const optionBounds = option.getBoundingClientRect()
    if (optionBounds.top < listBounds.top) list.scrollTop -= listBounds.top - optionBounds.top
    else if (optionBounds.bottom > listBounds.bottom) list.scrollTop += optionBounds.bottom - listBounds.bottom
  }, [open, activeValue])

  useEffect(() => () => { if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current) }, [])

  const scrollList = (element: HTMLDivElement, delta: number) => {
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
    if (scrollFrame.current === null) scrollTarget.current = element.scrollTop
    scrollTarget.current = Math.max(0, Math.min(maximum, scrollTarget.current + delta))
    if (scrollFrame.current !== null) return
    const step = () => {
      const distance = scrollTarget.current - element.scrollTop
      if (Math.abs(distance) < 0.5) { element.scrollTop = scrollTarget.current; scrollFrame.current = null; return }
      element.scrollTop += distance * 0.24
      scrollFrame.current = window.requestAnimationFrame(step)
    }
    scrollFrame.current = window.requestAnimationFrame(step)
  }

  const select = (option: SearchableSelectOption) => {
    if (option.disabled) return
    suppressNextFocus.current = true
    onValueChange(option.value)
    resetSearch()
    setOpen(false)
  }
  const moveActive = (direction: 1 | -1) => {
    if (enabled.length) setActiveIndex(index => (index + direction + enabled.length) % enabled.length)
  }
  const handleListKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) setOpen(true); else moveActive(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (!open) setOpen(true); else moveActive(-1) }
    else if (event.key === 'Home' && open) { event.preventDefault(); setActiveIndex(0) }
    else if (event.key === 'End' && open) { event.preventDefault(); setActiveIndex(Math.max(0, enabled.length - 1)) }
    else if (event.key === 'Enter') { event.preventDefault(); if (!open) setOpen(true); else if (enabled[activeIndex]) select(enabled[activeIndex]) }
    else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); closeAndReset() }
    else if (event.key === 'Tab' && open) { resetSearch(); setOpen(false) }
  }

  const handleTriggerFocus = (event: FocusEvent<HTMLElement>) => {
    onTriggerFocus?.()
    if (mode === 'typeahead' && selected && !focusCameFromPointer.current) {
      window.setTimeout(() => inputRef.current?.select(), 0)
    }
    const focusOpens = openOnFocus || !!event.currentTarget.closest('[data-selectors-open-on-focus="true"]')
    if (!focusOpens) return
    if (event.currentTarget.dataset.suppressAutoOpenOnce === 'true') { delete event.currentTarget.dataset.suppressAutoOpenOnce; return }
    if (suppressNextFocus.current) { suppressNextFocus.current = false; return }
    if (focusCameFromPointer.current) { focusCameFromPointer.current = false; return }
    window.setTimeout(() => setOpen(true), 0)
  }
  const setTriggerRef = (element: HTMLElement | null) => { internalTriggerRef.current = element; assignRef(triggerRef, element) }
  const commonControlProps = {
    id: controlId,
    role: 'combobox',
    'aria-expanded': open,
    'aria-controls': listboxId,
    'aria-activedescendant': open && activeValue ? `${controlId}-option-${activeValue}` : undefined,
    'aria-label': ariaLabel || (!ariaLabelledBy ? placeholder : undefined),
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': [ariaDescribedBy, statusId].filter(Boolean).join(' ') || undefined,
    disabled,
    tabIndex,
    autoFocus,
    onPointerDown: () => { focusCameFromPointer.current = true },
    onFocus: handleTriggerFocus,
  }

  return <Popover.Root open={open} onOpenChange={handleOpenChange}>
    <Popover.Trigger asChild>
      {mode === 'typeahead' ? <div className={cn('relative min-w-0 w-full', className)}>
        <input
          {...commonControlProps}
          ref={element => { inputRef.current = element; setTriggerRef(element) }}
          type="text"
          aria-autocomplete="list"
          autoComplete="off"
          value={visibleInputValue}
          placeholder={selected ? undefined : searchPlaceholder || placeholder}
          onClick={event => { focusCameFromPointer.current = false; if (!queryStarted && selected) event.currentTarget.select() }}
          onChange={event => { setQueryStarted(true); setQuery(event.target.value); setActiveIndex(0); if (!open) setOpen(true) }}
          onKeyDown={handleListKeys}
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background py-1 pl-2.5 pr-8 text-left text-[12px] shadow-sm ring-offset-background outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div> : <button
        {...commonControlProps}
        ref={setTriggerRef}
        type="button"
        onClick={() => { focusCameFromPointer.current = false }}
        onKeyDown={handleListKeys}
        className={cn('flex h-9 min-w-0 w-full max-w-full items-center justify-between overflow-hidden rounded-md border border-input bg-background px-2.5 py-1 text-left text-[12px] shadow-sm ring-offset-background outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50', className)}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')} title={selected?.label}>{selected?.label || placeholder}</span>
        <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        data-khata-select-content=""
        collisionPadding={8}
        sideOffset={4}
        align="start"
        sticky="always"
        onOpenAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); closeAndReset() }}
        className={cn('compact-workspace-surface z-[80] w-[var(--radix-popover-trigger-width)] min-w-[min(18rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg', contentClassName)}
      >
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-busy={loading || undefined}
          onKeyDown={handleListKeys}
          onWheelCapture={event => { event.preventDefault(); event.stopPropagation(); scrollList(event.currentTarget, event.deltaY) }}
          style={{ maxHeight: 'min(22rem, calc(var(--radix-popover-content-available-height) - 0.5rem))' }}
          className="overscroll-contain overflow-y-auto p-1 outline-none"
        >
          {loading && <p className="px-3 py-7 text-center text-sm text-muted-foreground">{loadingText}</p>}
          {!loading && !filtered.length && <p className="px-3 py-7 text-center text-sm text-muted-foreground">{hasQuery ? resolvedNoResultsText : emptyText}</p>}
          {!loading && filtered.map((option, index) => {
            const previousGroup = index > 0 ? filtered[index - 1].group : undefined
            const enabledIndex = enabled.findIndex(entry => entry.value === option.value)
            return <div key={option.value}>
              {option.group && option.group !== previousGroup && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground first:pt-1">{option.group}</p>}
              <button
                ref={element => { if (element) optionRefs.current.set(option.value, element); else optionRefs.current.delete(option.value) }}
                id={`${controlId}-option-${option.value}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                disabled={option.disabled}
                onMouseEnter={() => enabledIndex >= 0 && setActiveIndex(enabledIndex)}
                onClick={() => select(option)}
                className={cn('relative flex min-h-[1.875rem] w-full min-w-0 items-center gap-2 rounded-sm py-1 pl-7 pr-2 text-left text-[12px] outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', enabledIndex === activeIndex && 'bg-accent text-accent-foreground')}
              >
                {option.value === value && <Check className="absolute left-2 h-3.5 w-3.5" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" title={option.label}>{option.label}</span>
                </span>
                {option.trailingText && <span className="max-w-[9rem] shrink-0 truncate text-right text-[10px] text-muted-foreground" title={option.trailingText}>{option.trailingText}</span>}
              </button>
            </div>
          })}
        </div>
        <p id={statusId} className="sr-only" aria-live="polite">{loading ? loadingText : `${filtered.length} option${filtered.length === 1 ? '' : 's'} available`}</p>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
