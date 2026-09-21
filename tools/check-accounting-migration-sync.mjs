import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim()
const migrations = [
  '202609200001_accounting_integrity_manifest.sql',
  '202609210001_company_accounting_snapshot.sql',
  '202609210002_fix_voucher_number_double_increment.sql',
]
for (const migration of migrations) {
  const sql = read(`supabase/migrations/${migration}`)
  for (const file of ['db migration files/supabase-schema.sql', 'supabase-complete-staging-bootstrap.sql']) {
    const full = read(file)
    const start = `-- BEGIN SYNCED MIGRATION: ${migration}`
    const end = `-- END SYNCED MIGRATION: ${migration}`
    assert.equal(full.split(start).length, 2, `${file}: expected one synchronized section`)
    assert.equal(full.split(start)[1].split(end)[0].trim(), sql, `${file}: migration differs`)
  }
}
const sql = read(`supabase/migrations/${migrations[0]}`)
assert.match(sql, /language plpgsql stable security definer/)
assert.match(sql, /auth\.uid\(\) is null/)
assert.match(sql, /is_company_admin\(target_company\)/)
assert.match(sql, /revoke all[^;]+from public, anon/)
assert.doesNotMatch(sql, /\b(insert into|delete from|update public\.)\b/i)
const snapshotSql = read(`supabase/migrations/${migrations[1]}`)
assert.match(snapshotSql, /get_company_accounting_snapshot/)
assert.match(snapshotSql, /language sql\s+stable\s+security definer/)
assert.match(snapshotSql, /is_company_member\(p_company_id\)/)
assert.match(snapshotSql, /revoke all[^;]+from public, anon/)
assert.doesNotMatch(snapshotSql, /disable row level security/i)
assert.match(snapshotSql, /drop policy if exists vouchers_admin_write/)
assert.match(snapshotSql, /for insert/)
assert.match(snapshotSql, /for update/)
assert.match(snapshotSql, /for delete/)
const numberingSql = read(`supabase/migrations/${migrations[2]}`)
assert.match(numberingSql, /next_voucher_number/)
assert.match(numberingSql, /lpad\(highest_number::text, 4, '0'\)/)
assert.match(numberingSql, /journal_numbering_mode/)
assert.match(numberingSql, /allocator_calls <> 1/)
assert.match(numberingSql, /lpad\(\(highest_number \+ 1\)/)
assert.doesNotMatch(numberingSql, /update public\.voucher_number_counters\s+set last_number\s*=\s*0/i)
console.log('Accounting migration copies and security guard checks passed. SQL was NOT executed.')
