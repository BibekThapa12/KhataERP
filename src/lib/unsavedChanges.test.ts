import { describe, expect, it } from 'vitest'
import { requestUnsavedChangesConfirmation, resolveUnsavedChangesConfirmation, shouldInitializeForm, stableFormSnapshot, subscribeUnsavedChangesConfirmation, UNSAVED_CHANGES_MESSAGE } from './unsavedChanges'

describe('voucher form edit protection', () => {
  it('initializes only for the first load or a different voucher', () => {
    expect(shouldInitializeForm(null, 'Sales:voucher-1', true)).toBe(true)
    expect(shouldInitializeForm('Sales:voucher-1', 'Sales:voucher-1', true)).toBe(false)
    expect(shouldInitializeForm('Sales:voucher-1', 'Sales:voucher-2', true)).toBe(true)
    expect(shouldInitializeForm(null, 'Sales:voucher-1', false)).toBe(false)
  })

  it('detects changes in every nested editable value without mutating the baseline', () => {
    const baseline = { party: 'party-1', discount: 0, narration: '', lines: [{ item: 'item-1', quantity: 1, rate: 10 }] }
    const baselineSnapshot = stableFormSnapshot(baseline)
    const edited = { ...baseline, lines: [{ ...baseline.lines[0], rate: 12.5 }] }
    expect(stableFormSnapshot(edited)).not.toBe(baselineSnapshot)
    expect(stableFormSnapshot(baseline)).toBe(baselineSnapshot)
  })

  it('uses the required warning text', () => {
    expect(UNSAVED_CHANGES_MESSAGE).toBe('You have unsaved changes. Are you sure you want to leave?')
  })

  it('resolves the app confirmation only after the user chooses', async () => {
    const states: boolean[] = []
    const unsubscribe = subscribeUnsavedChangesConfirmation(open => states.push(open))
    const confirmation = requestUnsavedChangesConfirmation()
    expect(states.at(-1)).toBe(true)
    resolveUnsavedChangesConfirmation(true)
    await expect(confirmation).resolves.toBe(true)
    expect(states.at(-1)).toBe(false)
    unsubscribe()
  })
})
