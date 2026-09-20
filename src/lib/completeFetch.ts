import { withReadDeadline } from './readDeadline'

export interface CountedPage<T> {
  data: T[] | null
  count?: number | null
  error: unknown
}

/** Read all rows visible to the authenticated caller, never treating a full page as EOF.
 * The query must have a stable unique-ID ordering. We deliberately do not
 * request exact counts: PostgreSQL has to repeat those count scans for every
 * page and they can exceed the hosted statement timeout under RLS.
 */
export async function completeFetch<T extends { id: string }>(
  label: string,
  page: (from: number, to: number, signal: AbortSignal) => PromiseLike<CountedPage<T>>,
  pageSize = 500,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid page size')
  const rows = new Map<string, T>()
  let offset = 0
  for (;;) {
    const result = await withReadDeadline(label, signal => page(offset, offset + pageSize - 1, signal))
    if (result.error) throw result.error
    if (!result.data) throw new Error(`${label}: data was unavailable. Please refresh.`)
    if (!result.data.length) break
    for (const row of result.data) {
      if (!row.id || rows.has(row.id)) throw new Error(`${label}: unstable pagination. Please refresh.`)
      rows.set(row.id, row)
    }
    // Always request the next range—even after a short page. This supports a
    // server cap lower than pageSize and proves EOF only with an empty page.
    offset += result.data.length
  }
  return [...rows.values()]
}
