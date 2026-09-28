export function focusLastSearchableSelect(placeholder: string) {
  const triggers = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="combobox"]'))
    .filter(trigger => trigger.textContent?.trim() === placeholder)
  triggers.at(-1)?.focus()
}

export const CLOSE_SEARCHABLE_SELECTS_EVENT = 'khata:close-searchable-selects'

export type CloseSearchableSelectsDetail = {
  returnFocus: HTMLElement | null
}

/** Close controlled selector popovers before opening a nested creator dialog. */
export function closeOpenSearchableSelects() {
  const detail: CloseSearchableSelectsDetail = { returnFocus: null }
  window.dispatchEvent(new CustomEvent<CloseSearchableSelectsDetail>(CLOSE_SEARCHABLE_SELECTS_EVENT, { detail }))
  return detail.returnFocus
}

/**
 * Radix restores focus to the control that opened a nested dialog after the
 * dialog has unmounted. Wait until that restoration has finished, then place
 * focus on the requested post-create control so its normal Tab order resumes.
 */
export function focusAfterNestedDialogCloses(getTarget: () => HTMLElement | null | undefined, suppressSelectorAutoOpen = false) {
  const focusTarget = () => {
    const target = getTarget()
    if (target && target.isConnected && !target.matches(':disabled')) {
      if (suppressSelectorAutoOpen && target.matches('[role="combobox"]')) target.dataset.suppressAutoOpenOnce = 'true'
      target.focus({ preventScroll: true })
    }
  }

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(focusTarget))
  } else {
    window.setTimeout(focusTarget, 0)
  }
}
