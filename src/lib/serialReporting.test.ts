import { describe, expect, it, vi } from 'vitest'
import { collectInventorySerialRegisterRows } from '@/lib/serialReporting'
import type { InventorySerialRegisterResult, InventorySerialRegisterRow } from '@/types'

const row = (id: string): InventorySerialRegisterRow => ({ serial_id: id, serial_number: `SN-${id}`, item_id: 'item', item_name: 'Phone', status: 'available', stock_condition: 'saleable' })
const result = (rows: InventorySerialRegisterRow[], total: number): InventorySerialRegisterResult => ({ company_id: 'company', generated_at: '2026-10-17T00:00:00Z', total_count: total, summary: { total, available: total, saleable: total, damaged: 0, expired: 0, sold: 0, returned_to_supplier: 0, adjusted_out: 0, unavailable: 0 }, rows })

describe('collectInventorySerialRegisterRows', () => {
  it('fetches every page before returning an export', async () => {
    const fetchPage = vi.fn(async (page: number) => page === 1 ? result([row('1'), row('2')], 3) : result([row('3')], 3))
    await expect(collectInventorySerialRegisterRows(fetchPage, 2)).resolves.toEqual([row('1'), row('2'), row('3')])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('rejects silently truncated or changing page results', async () => {
    const fetchPage = vi.fn(async () => result([row('1')], 2))
    await expect(collectInventorySerialRegisterRows(fetchPage, 1)).rejects.toThrow('Serial records changed')
  })

  it('propagates a failed page instead of producing a partial export', async () => {
    const fetchPage = vi.fn(async (page: number) => { if (page === 2) throw new Error('page failed'); return result([row('1')], 2) })
    await expect(collectInventorySerialRegisterRows(fetchPage, 1)).rejects.toThrow('page failed')
  })
})
