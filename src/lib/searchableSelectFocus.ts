export function focusLastSearchableSelect(placeholder: string) {
  const triggers = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="combobox"]'))
    .filter(trigger => trigger.textContent?.trim() === placeholder)
  triggers.at(-1)?.focus()
}
