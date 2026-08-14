import { useCallback, useEffect } from 'react'

export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Are you sure you want to leave?'

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
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const next = `${destination.pathname}${destination.search}${destination.hash}`
      if (current === next || window.confirm(UNSAVED_CHANGES_MESSAGE)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', captureNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', captureNavigation, true)
    }
  }, [active, dirty])

  return useCallback(() => !active || !dirty || window.confirm(UNSAVED_CHANGES_MESSAGE), [active, dirty])
}
