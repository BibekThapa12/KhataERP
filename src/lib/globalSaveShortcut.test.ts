import { describe, expect, it } from 'vitest'
import { isGlobalSaveShortcut } from './globalSaveShortcut'

const keyEvent = (overrides: Partial<Parameters<typeof isGlobalSaveShortcut>[0]> = {}) => ({
  key: 's', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...overrides,
})

describe('global save shortcut', () => {
  it('accepts Alt+S case-insensitively', () => {
    expect(isGlobalSaveShortcut(keyEvent())).toBe(true)
    expect(isGlobalSaveShortcut(keyEvent({ key: 'S' }))).toBe(true)
  })

  it('rejects repeats and additional modifiers', () => {
    expect(isGlobalSaveShortcut(keyEvent({ repeat: true }))).toBe(false)
    expect(isGlobalSaveShortcut(keyEvent({ ctrlKey: true }))).toBe(false)
    expect(isGlobalSaveShortcut(keyEvent({ metaKey: true }))).toBe(false)
    expect(isGlobalSaveShortcut(keyEvent({ shiftKey: true }))).toBe(false)
    expect(isGlobalSaveShortcut(keyEvent({ key: 'p' }))).toBe(false)
  })
})
