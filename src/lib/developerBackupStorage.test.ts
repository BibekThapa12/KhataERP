import { describe, expect, it } from 'vitest'
import { writeCompanyBackup, type DirectoryHandleLike } from './developerBackupStorage'

class FakeFile {
  content = ''
  failWrites = 0
  async getFile() { return { text: async () => this.content } as File }
  async createWritable() {
    return {
      write: async (data: string | Blob | Uint8Array) => {
        if (this.failWrites-- > 0) throw new Error('simulated write failure')
        this.content = typeof data === 'string' ? data : String(data)
      },
      close: async () => undefined,
      abort: async () => undefined,
    }
  }
}

class FakeDirectory implements DirectoryHandleLike {
  kind = 'directory' as const
  files = new Map<string, FakeFile>()
  directories = new Map<string, FakeDirectory>()
  constructor(public name: string) {}
  async queryPermission() { return 'granted' as PermissionState }
  async requestPermission() { return 'granted' as PermissionState }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name)
    if (existing) return existing
    if (!options?.create) throw new Error('missing directory')
    const created = new FakeDirectory(name); this.directories.set(name, created); return created
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name)
    if (existing) return existing
    if (!options?.create) throw new Error('missing file')
    const created = new FakeFile(); this.files.set(name, created); return created
  }
  async removeEntry(name: string) { this.files.delete(name) }
}

describe('developer backup directory writes', () => {
  it('reuses folders and overwrites the one current-state JSON file', async () => {
    const root = new FakeDirectory('KhataERP Backup')
    await writeCompanyBackup(root, 'Bibek Thapa', 'Admin Company', '{"version":1}')
    await writeCompanyBackup(root, 'Bibek Thapa', 'Admin Company', '{"version":2}')
    const company = root.directories.get('Bibek Thapa')?.directories.get('Admin Company')
    expect(company?.files.get('company-backup.json')?.content).toBe('{"version":2}')
    expect(company?.files.has('company-backup.tmp')).toBe(false)
    expect(root.directories.size).toBe(1)
  })

  it('restores the previous valid file when final replacement fails', async () => {
    const root = new FakeDirectory('KhataERP Backup')
    await writeCompanyBackup(root, 'User', 'Company', 'valid-old')
    const company = root.directories.get('User')!.directories.get('Company')!
    company.files.get('company-backup.json')!.failWrites = 1
    await expect(writeCompanyBackup(root, 'User', 'Company', 'new-data')).rejects.toThrow('simulated write failure')
    expect(company.files.get('company-backup.json')?.content).toBe('valid-old')
  })
})
