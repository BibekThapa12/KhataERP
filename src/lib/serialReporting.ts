import type { InventorySerialRegisterResult, InventorySerialRegisterRow } from '@/types'

export async function collectInventorySerialRegisterRows(
  fetchPage: (page: number, pageSize: number) => Promise<InventorySerialRegisterResult>,
  pageSize = 200,
): Promise<InventorySerialRegisterRow[]> {
  const first = await fetchPage(1, pageSize)
  const rows = [...first.rows]
  const pages = Math.ceil(first.total_count / pageSize)
  for (let page = 2; page <= pages; page += 1) rows.push(...(await fetchPage(page, pageSize)).rows)
  const unique = new Map(rows.map(row => [row.serial_id, row]))
  if (unique.size !== first.total_count) throw new Error('Serial records changed while preparing the report. Please try again.')
  return [...unique.values()]
}
