import { useEffect, useRef, type RefObject } from 'react'

type CreateShortcutOptions = {
  active: boolean
  disabled?: boolean
  onCreate: () => void
  scopeRef?: RefObject<HTMLElement | null>
}

type CreateShortcutRegistration = {
  id: symbol
  order: number
  disabled: () => boolean
  create: () => void
  scope: () => HTMLElement | null
}

const registrations: CreateShortcutRegistration[] = []
let nextOrder = 0
let listening = false

export function isGlobalCreateShortcut(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat'>) {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat && event.key.toLowerCase() === 'n'
}

function handleGlobalCreate(event: KeyboardEvent) {
  if (!isGlobalCreateShortcut(event) || event.defaultPrevented) return
  const activeElement = document.activeElement
  const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]'))
  const openDialog = openDialogs.at(-1) || null
  const activeInSelectPortal = !!activeElement?.closest('[data-khata-select-content], [data-radix-popper-content-wrapper]')
  const eligible = registrations.filter(registration => {
    const scope = registration.scope()
    if (!scope) return !openDialog
    if (openDialog && scope !== openDialog) return false
    return (!!activeElement && scope.contains(activeElement)) || activeInSelectPortal
  })
  const registration = eligible.reduce<CreateShortcutRegistration | undefined>((latest, candidate) => (
    !latest || candidate.order > latest.order ? candidate : latest
  ), undefined)

  // Never let a page-level creator fire behind an unrelated open dialog.
  if (!registration && !openDialog) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (registration && !registration.disabled()) registration.create()
}

function startListening() {
  if (listening || typeof window === 'undefined') return
  window.addEventListener('keydown', handleGlobalCreate, true)
  listening = true
}

function stopListening() {
  if (!listening || registrations.length || typeof window === 'undefined') return
  window.removeEventListener('keydown', handleGlobalCreate, true)
  listening = false
}

/** Registers a context-aware Alt+N creator. Scoped editors override page creators. */
export function useGlobalCreateShortcut({ active, disabled = false, onCreate, scopeRef }: CreateShortcutOptions) {
  const createRef = useRef(onCreate)
  const disabledRef = useRef(disabled)
  const scopeRefValue = useRef(scopeRef)
  createRef.current = onCreate
  disabledRef.current = disabled
  scopeRefValue.current = scopeRef

  useEffect(() => {
    if (!active) return
    const id = Symbol('global-create-shortcut')
    registrations.push({
      id,
      order: ++nextOrder,
      disabled: () => disabledRef.current,
      create: () => createRef.current(),
      scope: () => scopeRefValue.current?.current || null,
    })
    startListening()
    return () => {
      const index = registrations.findIndex(registration => registration.id === id)
      if (index >= 0) registrations.splice(index, 1)
      stopListening()
    }
  }, [active])
}
