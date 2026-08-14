import { strToU8, zipSync } from 'fflate'

export interface DirectoryHandleLike {
  kind: 'directory'; name: string
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  removeEntry?(name: string): Promise<void>
}
interface FileHandleLike { getFile(): Promise<File>; createWritable(): Promise<{ write(data: string | Blob | Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }> }

declare global { interface Window { showDirectoryPicker?: () => Promise<DirectoryHandleLike> } }

const DB_NAME = 'khataerp-developer-backup'
const STORE = 'handles'
const HANDLE_KEY = 'root'

function openHandleDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveBackupDirectoryHandle(handle: DirectoryHandleLike) {
  const db = await openHandleDb()
  await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, HANDLE_KEY); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
  db.close()
}

export async function loadBackupDirectoryHandle(): Promise<DirectoryHandleLike | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openHandleDb()
    const value = await new Promise<DirectoryHandleLike | null>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get(HANDLE_KEY); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error) })
    db.close(); return value
  } catch { return null }
}

export function supportsDirectoryBackup() { return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' }

export async function ensureDirectoryPermission(handle: DirectoryHandleLike, request = true) {
  if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true
  return request && await handle.requestPermission({ mode: 'readwrite' }) === 'granted'
}

async function writeFile(handle: FileHandleLike, content: string) {
  const writable = await handle.createWritable()
  try { await writable.write(content); await writable.close() } catch (error) { await writable.abort?.(); throw error }
}

export async function writeCompanyBackup(root: DirectoryHandleLike, userFolder: string, companyFolder: string, content: string) {
  const user = await root.getDirectoryHandle(userFolder, { create: true })
  const company = await user.getDirectoryHandle(companyFolder, { create: true })
  const temporary = await company.getFileHandle('company-backup.tmp', { create: true })
  await writeFile(temporary, content)
  const verified = await (await temporary.getFile()).text()
  if (verified !== content) throw new Error('Temporary backup verification failed.')
  let previous: string | null = null
  try { previous = await (await company.getFileHandle('company-backup.json')).getFile().then(file => file.text()) } catch { previous = null }
  const target = await company.getFileHandle('company-backup.json', { create: true })
  try {
    await writeFile(target, verified)
    if (await (await target.getFile()).text() !== content) throw new Error('Final backup verification failed.')
  } catch (error) {
    if (previous !== null) await writeFile(target, previous)
    throw error
  } finally { try { await company.removeEntry?.('company-backup.tmp') } catch { /* best effort */ } }
}

export function downloadBackupZip(files: { path: string; content: string }[]) {
  const archive = zipSync(Object.fromEntries(files.map(file => [file.path, strToU8(file.content)])), { level: 6 })
  const url = URL.createObjectURL(new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'khataerp-all-company-backups.zip'; anchor.click(); URL.revokeObjectURL(url)
}
