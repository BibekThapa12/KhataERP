import type { Company } from '@/types'
import type { CompanySnapshot } from './companySnapshot'

const DATABASE_NAME = 'khataerp-client-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'company-snapshots'
const CACHE_FORMAT_VERSION = 1
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000

interface CachedCompanySnapshot {
  key: string
  formatVersion: number
  userId: string
  companyId: string
  dataVersion: string
  savedAt: number
  snapshot: CompanySnapshot
}

interface SnapshotCacheAdapter {
  read: (userId: string, companyId: string) => Promise<CachedCompanySnapshot | null>
  write: (entry: CachedCompanySnapshot) => Promise<void>
}

interface LoadCompanySnapshotOptions {
  userId: string
  company: Company
  dataVersion: string | null
  fetchSnapshot: () => Promise<CompanySnapshot>
  adapter?: SnapshotCacheAdapter
  now?: number
}

const memoryCache = new Map<string, CachedCompanySnapshot>()

function cacheKey(userId: string, companyId: string) {
  return `${userId}:${companyId}`
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Browser cache request failed.'))
  })
}

function openSnapshotDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Browser cache is unavailable.'))
  })
}

async function readPersistentEntry(userId: string, companyId: string) {
  const key = cacheKey(userId, companyId)
  if (typeof indexedDB === 'undefined') return memoryCache.get(key) || null
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    return await requestResult(transaction.objectStore(STORE_NAME).get(key)) as CachedCompanySnapshot | undefined || null
  } finally { database.close() }
}

async function writePersistentEntry(entry: CachedCompanySnapshot) {
  memoryCache.set(entry.key, entry)
  if (typeof indexedDB === 'undefined') return
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    await requestResult(transaction.objectStore(STORE_NAME).put(entry))
  } finally { database.close() }
}

const persistentAdapter: SnapshotCacheAdapter = { read: readPersistentEntry, write: writePersistentEntry }

function snapshotBelongsToCompany(snapshot: CompanySnapshot, companyId: string) {
  const scopedCollections = [
    snapshot.rawAccounts,
    snapshot.accountCategories,
    snapshot.parties,
    snapshot.items,
    snapshot.itemCategories,
    snapshot.pricingRules,
    snapshot.vouchers,
  ]
  return scopedCollections.every(rows => Array.isArray(rows) && rows.every(row => row.company_id === companyId))
    && Array.isArray(snapshot.accounts)
    && Array.isArray(snapshot.stock)
}

export function isReusableCompanySnapshot(
  entry: CachedCompanySnapshot | null,
  userId: string,
  companyId: string,
  dataVersion: string | null,
  now = Date.now(),
) {
  return !!entry
    && !!dataVersion
    && entry.formatVersion === CACHE_FORMAT_VERSION
    && entry.userId === userId
    && entry.companyId === companyId
    && entry.dataVersion === dataVersion
    && now - entry.savedAt <= MAX_CACHE_AGE_MS
    && snapshotBelongsToCompany(entry.snapshot, companyId)
}

async function withCrossTabSnapshotLock<T>(userId: string, companyId: string, task: () => Promise<T>) {
  const lockManager = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: { request: <R>(name: string, callback: () => Promise<R>) => Promise<R> } }).locks
  if (!lockManager) return task()
  return lockManager.request(`khataerp:snapshot:${userId}:${companyId}`, task)
}

/** Reuses a complete snapshot only when its authenticated company revision matches. */
export async function loadCompanySnapshotCached({
  userId,
  company,
  dataVersion,
  fetchSnapshot,
  adapter = persistentAdapter,
  now = Date.now(),
}: LoadCompanySnapshotOptions): Promise<{ snapshot: CompanySnapshot; source: 'cache' | 'network' }> {
  return withCrossTabSnapshotLock(userId, company.id, async () => {
    if (dataVersion) {
      const cached = await adapter.read(userId, company.id).catch(() => null)
      if (isReusableCompanySnapshot(cached, userId, company.id, dataVersion, now)) return { snapshot: cached.snapshot, source: 'cache' }
    }

    const snapshot = await fetchSnapshot()
    if (dataVersion && snapshotBelongsToCompany(snapshot, company.id)) {
      await Promise.resolve(adapter.write({
        key: cacheKey(userId, company.id),
        formatVersion: CACHE_FORMAT_VERSION,
        userId,
        companyId: company.id,
        dataVersion,
        savedAt: now,
        snapshot,
      })).catch(() => undefined)
    }
    return { snapshot, source: 'network' }
  })
}

export async function writeCompanySnapshotCache(userId: string, companyId: string, dataVersion: string, snapshot: CompanySnapshot) {
  if (!snapshotBelongsToCompany(snapshot, companyId)) return
  await persistentAdapter.write({
    key: cacheKey(userId, companyId),
    formatVersion: CACHE_FORMAT_VERSION,
    userId,
    companyId,
    dataVersion,
    savedAt: Date.now(),
    snapshot,
  })
}

export async function clearCompanySnapshotCache() {
  memoryCache.clear()
  if (typeof indexedDB === 'undefined') return
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    await requestResult(transaction.objectStore(STORE_NAME).clear())
  } finally { database.close() }
}
