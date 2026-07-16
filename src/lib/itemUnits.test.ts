import { describe, expect, it } from 'vitest'
import { canonicalItemUnit, isKnownItemUnit, isValidCustomItemUnit, validateItemUnits } from '@/lib/itemUnits'

describe('ERP item units', () => {
  it('recognizes common units case-insensitively and returns canonical values', () => {
    expect(isKnownItemUnit('BOX')).toBe(true)
    expect(canonicalItemUnit('box')).toBe('Box')
    expect(canonicalItemUnit('KG')).toBe('kg')
  })

  it('requires a valid main unit', () => {
    expect(validateItemUnits('', null)).toBe('Select a main unit.')
    expect(validateItemUnits('bad<script>', null)).toContain('1–20 characters')
  })

  it('rejects duplicate main and alternative units', () => {
    expect(validateItemUnits('Box', 'box')).toBe('Main and alternative units must be different.')
  })

  it('accepts safe custom units and rejects reserved or unsafe values', () => {
    expect(isValidCustomItemUnit('Ropani')).toBe(true)
    expect(isValidCustomItemUnit('Sheet / Pack')).toBe(true)
    expect(validateItemUnits('Custom UOM', null)).toBeNull()
    expect(isValidCustomItemUnit('__create_custom_unit__')).toBe(false)
    expect(isValidCustomItemUnit('<script>')).toBe(false)
  })
})
