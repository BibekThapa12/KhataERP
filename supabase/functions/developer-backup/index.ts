import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AUTOMATION_SECRET = Deno.env.get('BACKUP_AUTOMATION_SECRET')!
const BUCKET = 'developer-company-backups'
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const sensitiveKey = /(^|_)(password|secret|token|service_role|api_key|refresh_token|access_token|encryption_key)($|_)/i
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !sensitiveKey.test(key)).map(([key, entry]) => [key, stripSecrets(entry)]))
}
function safeName(value: string, fallback: string) {
  const printable = Array.from(value.normalize('NFKC'), character => character.charCodeAt(0) < 32 ? ' ' : character).join('')
  let result = printable.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '')
  if (!result || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `${fallback} Folder`
  return result.slice(0, 100).replace(/[. ]+$/g, '') || fallback
}
function uniqueNames(entries: { id: string; name: string }[], fallback: string) {
  const rows = entries.map(entry => ({ ...entry, safe: safeName(entry.name, fallback) })); const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.safe.toLowerCase(), (counts.get(row.safe.toLowerCase()) || 0) + 1)
  return new Map(rows.map(row => [row.id, (counts.get(row.safe.toLowerCase()) || 0) > 1 ? `${row.safe} (${row.id.slice(0, 8)})` : row.safe]))
}
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
function counts(snapshot: Record<string, unknown>) {
  const array = (key: string) => Array.isArray(snapshot[key]) ? snapshot[key] as Record<string, unknown>[] : []
  const vouchers = array('vouchers')
  return {
    account_categories: array('accountCategories').length, item_categories: array('itemCategories').length,
    accounts: array('accounts').length, parties: array('parties').length, items: array('items').length, vouchers: vouchers.length,
    voucher_lines: vouchers.reduce((sum, voucher) => sum + (Array.isArray(voucher.lines) ? voucher.lines.length : 0), 0),
    stock_lines: vouchers.reduce((sum, voucher) => sum + (Array.isArray(voucher.stock_lines) ? voucher.stock_lines.length : 0), 0),
    invoice_items: vouchers.reduce((sum, voucher) => sum + (Array.isArray(voucher.invoice_items) ? voucher.invoice_items.length : 0), 0),
    settlements: vouchers.reduce((sum, voucher) => sum + (Array.isArray(voucher.settlements) ? voucher.settlements.length : 0), 0),
    cheque_banks: array('chequeBanks').length, cheques: array('cheques').length, cheque_events: array('chequeEvents').length,
    company_modules: array('companyModules').length, master_change_logs: array('masterChangeLogs').length, app_events: array('appEvents').length,
  }
}

type ManifestEntry = { path: string; company_id: string; user_name: string; company_name: string; sha256: string; size: number; exported_at: string }

async function runBackup() {
  const { data: companies, error: companyError } = await admin.from('companies').select('id,user_id,name').order('created_at')
  if (companyError) throw companyError
  const companyRows = companies || []
  const { data: run, error: runError } = await admin.from('developer_backup_runs').insert({ initiated_by: null, initiator_type: 'automated', total_companies: companyRows.length }).select('*').single()
  if (runError) throw runError
  const userIds = [...new Set(companyRows.map(company => company.user_id as string))]
  const userLabels = new Map<string, string>()
  let page = 1
  while (userLabels.size < userIds.length) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 }); if (error) throw error
    for (const user of data.users) if (userIds.includes(user.id)) userLabels.set(user.id, user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || user.id.slice(0, 8))
    if (data.users.length < 1000) break; page += 1
  }
  const userNames = uniqueNames(userIds.map(id => ({ id, name: userLabels.get(id) || id.slice(0, 8) })), 'User')
  const companyNamesByUser = new Map<string, Map<string, string>>()
  for (const userId of userIds) companyNamesByUser.set(userId, uniqueNames(companyRows.filter(company => company.user_id === userId).map(company => ({ id: company.id, name: company.name })), 'Company'))
  const previousEntries = new Map<string, ManifestEntry>()
  const { data: previousManifest } = await admin.storage.from(BUCKET).download('_manifest.json')
  if (previousManifest) try { for (const entry of (JSON.parse(await previousManifest.text()).entries || []) as ManifestEntry[]) previousEntries.set(entry.company_id, entry) } catch { /* first or legacy manifest */ }
  const manifest: ManifestEntry[] = []; let successful = 0; let failed = 0
  for (const company of companyRows) {
    try {
      const { data: raw, error } = await admin.rpc('system_export_company_backup', { target_company: company.id }); if (error) throw error
      const snapshot = stripSecrets(raw) as Record<string, unknown>; const exportedAt = new Date().toISOString()
      const backup = { format: 'khataerp-portable-company-v1', format_version: 1, schema_version: 'current', original_company_id: company.id, company_name: company.name, exported_at: exportedAt, exported_by: 'automated', record_counts: counts(snapshot), ...snapshot }
      const content = JSON.stringify(backup, null, 2)
      const userName = userNames.get(company.user_id) || `User (${String(company.user_id).slice(0, 8)})`
      const companyName = companyNamesByUser.get(company.user_id)?.get(company.id) || `Company (${String(company.id).slice(0, 8)})`
      const path = `${userName}/${companyName}/company-backup.json`
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, content, { contentType: 'application/json', upsert: true }); if (uploadError) throw uploadError
      manifest.push({ path, company_id: company.id, user_name: userName, company_name: company.name, sha256: await sha256(content), size: new TextEncoder().encode(content).length, exported_at: exportedAt })
      const { data: existing } = await admin.from('developer_company_backup_status').select('company_id').eq('company_id', company.id).maybeSingle()
      const status = { company_id: company.id, last_exported_at: exportedAt, last_attempted_at: exportedAt, last_export_status: 'successful', last_exported_by: null, last_error: null }
      const statusError = existing ? (await admin.from('developer_company_backup_status').update(status).eq('company_id', company.id)).error : (await admin.from('developer_company_backup_status').insert(status)).error
      if (statusError) throw statusError
      successful += 1
    } catch (error) {
      failed += 1; const attemptedAt = new Date().toISOString(); const message = error instanceof Error ? error.message.slice(0, 1000) : 'Automated export failed'
      const previous = previousEntries.get(company.id); if (previous) manifest.push(previous)
      const { data: existing } = await admin.from('developer_company_backup_status').select('company_id').eq('company_id', company.id).maybeSingle()
      const failure = { last_attempted_at: attemptedAt, last_export_status: 'failed', last_error: message }
      if (existing) await admin.from('developer_company_backup_status').update(failure).eq('company_id', company.id)
      else await admin.from('developer_company_backup_status').insert({ company_id: company.id, ...failure })
    }
  }
  const completedAt = new Date().toISOString(); const status = failed === 0 ? 'successful' : successful === 0 ? 'failed' : 'partial'
  const manifestText = JSON.stringify({ format: 'khataerp-backup-manifest-v1', generated_at: completedAt, run_id: run.id, entries: manifest }, null, 2)
  const { error: manifestError } = await admin.storage.from(BUCKET).upload('_manifest.json', manifestText, { contentType: 'application/json', upsert: true }); if (manifestError) throw manifestError
  await admin.from('developer_backup_runs').update({ completed_at: completedAt, successful_companies: successful, failed_companies: failed, status }).eq('id', run.id)
  return { run_id: run.id, total: companyRows.length, successful, failed, status }
}

async function agentManifest(request: Request) {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  const [id, secret] = bearer.split('.', 2); if (!id || !secret) return json({ error: 'Invalid backup agent token' }, 401)
  const { data: agent } = await admin.from('developer_backup_agents').select('id,token_hash,revoked_at').eq('id', id).maybeSingle()
  if (!agent || agent.revoked_at || await sha256(secret) !== agent.token_hash) return json({ error: 'Invalid or revoked backup agent token' }, 401)
  const { data: manifestDownload, error: manifestError } = await admin.storage.from(BUCKET).download('_manifest.json')
  if (manifestError) return json({ error: 'No automated backup manifest is available yet' }, 404)
  const manifest = JSON.parse(await manifestDownload.text()) as { entries: ManifestEntry[] }
  const entries = []
  for (const entry of manifest.entries || []) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(entry.path, 900); if (error) throw error
    entries.push({ ...entry, download_url: data.signedUrl })
  }
  await admin.from('developer_backup_agents').update({ last_seen_at: new Date().toISOString() }).eq('id', agent.id)
  return json({ ...manifest, entries })
}

Deno.serve(async request => {
  try {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.searchParams.get('mode') === 'manifest') return await agentManifest(request)
    if (request.method !== 'POST' || request.headers.get('x-automation-secret') !== AUTOMATION_SECRET) return json({ error: 'Unauthorized' }, 401)
    return json(await runBackup())
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Backup operation failed' }, 500)
  }
})
