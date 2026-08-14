import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migration = readFileSync(join(root, 'db migration files', 'supabase-automated-backup-agent-migration.sql'), 'utf8')
const agent = readFileSync(join(root, 'windows-backup-agent', 'KhataERPBackupAgent.ps1'), 'utf8')
const installer = readFileSync(join(root, 'windows-backup-agent', 'Install-KhataERPBackupAgent.ps1'), 'utf8')

describe('automated backup security and scheduling', () => {
  it('schedules the cloud exporter every two hours and limits the system RPC to service_role', () => {
    expect(migration).toContain("'0 */2 * * *'")
    expect(migration).toContain('grant execute on function public.system_export_company_backup(uuid) to service_role')
    expect(migration).toContain('revoke all on function public.system_export_company_backup(uuid) from public,anon,authenticated')
  })

  it('stores only hashed agent tokens and supports revocation', () => {
    expect(migration).toContain("encode(digest(secret,'sha256'),'hex')")
    expect(migration).toContain('revoked_at timestamptz')
    expect(migration).not.toMatch(/insert into public\.developer_backup_agents[^;]+service_role/i)
  })

  it('protects the local token with DPAPI and verifies every downloaded checksum', () => {
    expect(installer).toContain('ConvertFrom-SecureString')
    expect(agent).toContain('ConvertTo-SecureString')
    expect(agent).toContain('Get-FileHash')
    expect(agent).toContain("$target.previous")
    expect(agent).not.toMatch(/service.?role/i)
  })
})
