import { useCallback, useEffect } from 'react'

export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Are you sure you want to leave?'

type ConfirmationListener = (open: boolean) => void
const confirmationListeners = new Set<ConfirmationListener>()
let pendingConfirmation: ((confirmed: boolean) => void) | null = null
let bypassNavigationHref: string | null = null

function publishConfirmation(open: boolean) {
  confirmationListeners.forEach(listener => listener(open))
}

export function subscribeUnsavedChangesConfirmation(listener: ConfirmationListener) {
  confirmationListeners.add(listener)
  listener(!!pendingConfirmation)
  return () => { confirmationListeners.delete(listener) }
}

export function requestUnsavedChangesConfirmation(): Promise<boolean> {
  pendingConfirmation?.(false)
  return new Promise(resolve => {
    pendingConfirmation = resolve
    publishConfirmation(true)
  })
}

export function resolveUnsavedChangesConfirmation(confirmed: boolean) {
  const resolve = pendingConfirmation
  pendingConfirmation = null
  publishConfirmation(false)
  resolve?.(confirmed)
}

export function stableFormSnapshot(value: unknown) {
  return JSON.stringify(value)
}

export function shouldInitializeForm(previousIdentity: string | null, nextIdentity: string, open: boolean) {
  return open && previousIdentity !== nextIdentity
}

export function useUnsavedChangesGuard(active: boolean, dirty: boolean) {
  useEffect(() => {
    if (!active || !dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = UNSAVED_CHANGES_MESSAGE
    }
    const captureNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null
      if (!target || target.target === '_blank' || target.hasAttribute('download')) return
      const destination = new URL(target.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      if (bypassNavigationHref === destination.href) return
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const next = `${destination.pathname}${destination.search}${destination.hash}`
      if (current === next) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void requestUnsavedChangesConfirmation().then(confirmed => {
        if (!confirmed) return
        bypassNavigationHref = destination.href
        if (target.isConnected) target.click()
        else window.location.assign(destination.href)
        queueMicrotask(() => { bypassNavigationHref = null })
      })
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', captureNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', captureNavigation, true)
    }
  }, [active, dirty])

  return useCallback(() => !active || !dirty ? Promise.resolve(true) : requestUnsavedChangesConfirmation(), [active, dirty])
}
