import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const migration = '202609200001_accounting_integrity_manifest.sql'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim()
const sql = read(`supabase/migrations/${migration}`)
for (const file of ['db migration files/supabase-schema.sql', 'supabase-complete-staging-bootstrap.sql']) {
  const full = read(file)
  const start = `-- BEGIN SYNCED MIGRATION: ${migration}`
  const end = `-- END SYNCED MIGRATION: ${migration}`
  assert.equal(full.split(start).length, 2, `${file}: expected one synchronized section`)
  assert.equal(full.split(start)[1].split(end)[0].trim(), sql, `${file}: migration differs`)
}
assert.match(sql, /language plpgsql stable security definer/)
assert.match(sql, /auth\.uid\(\) is null/)
assert.match(sql, /is_company_admin\(target_company\)/)
assert.match(sql, /revoke all[^;]+from public, anon/)
assert.doesNotMatch(sql, /\b(insert into|delete from|update public\.)\b/i)
console.log('Accounting migration copies and static read-only guard checks passed. SQL was NOT executed.')
