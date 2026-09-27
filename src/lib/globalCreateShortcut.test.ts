import { afterEach, describe, expect, it, vi } from 'vitest'
import { isGlobalCreateShortcut } from './globalCreateShortcut'

const event = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: 'n', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...overrides,
}) as KeyboardEvent

afterEach(() => vi.restoreAllMocks())

describe('global create shortcut', () => {
  it('accepts Alt+N case-insensitively', () => {
    expect(isGlobalCreateShortcut(event())).toBe(true)
    expect(isGlobalCreateShortcut(event({ key: 'N' }))).toBe(true)
  })

  it('rejects repeats and additional modifiers', () => {
    expect(isGlobalCreateShortcut(event({ repeat: true }))).toBe(false)
    expect(isGlobalCreateShortcut(event({ ctrlKey: true }))).toBe(false)
    expect(isGlobalCreateShortcut(event({ metaKey: true }))).toBe(false)
    expect(isGlobalCreateShortcut(event({ shiftKey: true }))).toBe(false)
    expect(isGlobalCreateShortcut(event({ key: 's' }))).toBe(false)
  })
})
