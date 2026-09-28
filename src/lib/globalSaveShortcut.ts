import { useEffect, useRef, type RefObject } from 'react'

type SaveShortcutOptions = {
  active: boolean
  disabled?: boolean
  onSave: () => void
  scopeRef?: RefObject<HTMLElement | null>
}

type SaveShortcutRegistration = {
  id: symbol
  order: number
  disabled: () => boolean
  save: () => void
  scope: () => HTMLElement | null
}

const registrations: SaveShortcutRegistration[] = []
let nextOrder = 0
let listening = false

export function isGlobalSaveShortcut(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat'>) {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat && event.key.toLowerCase() === 's'
}

function handleGlobalSave(event: KeyboardEvent) {
  if (!isGlobalSaveShortcut(event) || event.defaultPrevented) return
  const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]:not([data-khata-select-content])'))
  const openDialog = openDialogs[openDialogs.length - 1] || null
  const eligible = registrations.filter(registration => {
    const scope = registration.scope()
    return openDialog ? scope === openDialog : !scope
  })
  const registration = eligible.reduce<SaveShortcutRegistration | undefined>((latest, candidate) => (
    !latest || candidate.order > latest.order ? candidate : latest
  ), undefined)

  // Never let an editor behind a nested dialog receive Alt+S. Registration
  // order can change after a parent rerender, but visual dialog ownership must
  // remain deterministic.
  if (!registration) {
    if (openDialog) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    return
  }

  // Alt+S belongs to the active editor even while its save is disabled. This
  // also prevents the browser's native "Save page" action during submission.
  event.preventDefault()
  event.stopImmediatePropagation()
  if (!registration.disabled()) registration.save()
}

function startListening() {
  if (listening || typeof window === 'undefined') return
  window.addEventListener('keydown', handleGlobalSave, true)
  listening = true
}

function stopListening() {
  if (!listening || registrations.length || typeof window === 'undefined') return
  window.removeEventListener('keydown', handleGlobalSave, true)
  listening = false
}

/** Registers an editor for Alt+S. The topmost dialog owns the shortcut. */
export function useGlobalSaveShortcut({ active, disabled = false, onSave, scopeRef }: SaveShortcutOptions) {
  const saveRef = useRef(onSave)
  const disabledRef = useRef(disabled)
  const scopeRefValue = useRef(scopeRef)
  saveRef.current = onSave
  disabledRef.current = disabled
  scopeRefValue.current = scopeRef

  useEffect(() => {
    if (!active) return
    const id = Symbol('global-save-shortcut')
    registrations.push({
      id,
      order: ++nextOrder,
      disabled: () => disabledRef.current,
      save: () => saveRef.current(),
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
