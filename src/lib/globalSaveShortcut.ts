import { useEffect, useRef } from 'react'

type SaveShortcutOptions = {
  active: boolean
  disabled?: boolean
  onSave: () => void
}

type SaveShortcutRegistration = {
  id: symbol
  order: number
  disabled: () => boolean
  save: () => void
}

const registrations: SaveShortcutRegistration[] = []
let nextOrder = 0
let listening = false

export function isGlobalSaveShortcut(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat'>) {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat && event.key.toLowerCase() === 's'
}

function handleGlobalSave(event: KeyboardEvent) {
  if (!isGlobalSaveShortcut(event) || event.defaultPrevented) return
  const registration = registrations.reduce<SaveShortcutRegistration | undefined>((latest, candidate) => (
    !latest || candidate.order > latest.order ? candidate : latest
  ), undefined)
  if (!registration) return

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

/** Registers an editor for Alt+S. The most recently opened editor wins. */
export function useGlobalSaveShortcut({ active, disabled = false, onSave }: SaveShortcutOptions) {
  const saveRef = useRef(onSave)
  const disabledRef = useRef(disabled)
  saveRef.current = onSave
  disabledRef.current = disabled

  useEffect(() => {
    if (!active) return
    const id = Symbol('global-save-shortcut')
    registrations.push({
      id,
      order: ++nextOrder,
      disabled: () => disabledRef.current,
      save: () => saveRef.current(),
    })
    startListening()
    return () => {
      const index = registrations.findIndex(registration => registration.id === id)
      if (index >= 0) registrations.splice(index, 1)
      stopListening()
    }
  }, [active])
}
