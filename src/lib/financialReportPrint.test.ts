import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const printCss = readFileSync(join(root, 'src', 'index.css'), 'utf8')
const appShell = readFileSync(join(root, 'src', 'components', 'layout', 'AppShell.tsx'), 'utf8')

describe('financial report print layout', () => {
  it('does not force financial reports onto a second named page', () => {
    expect(printCss).not.toMatch(/@page\s+balance-sheet-report/)
    expect(printCss).not.toMatch(/\.balance-sheet-report-page\s*\{[^}]*\bpage\s*:/s)
    expect(printCss).not.toMatch(/\.profit-loss-report-page\s*\{[^}]*\bpage\s*:/s)
    expect(printCss).not.toMatch(/\.trial-balance-report-page\s*\{[^}]*\bpage\s*:/s)
  })

  it('keeps app breadcrumbs out of printed reports', () => {
    expect(appShell).toContain('className="app-breadcrumb ')
    expect(printCss).toMatch(/@media print\s*\{[\s\S]*?\.app-breadcrumb[\s\S]*?display:\s*none\s*!important/)
  })
})
