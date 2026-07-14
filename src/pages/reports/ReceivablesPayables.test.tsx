import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ReceivablesPayablesPage } from '@/pages/reports/ReceivablesPayables'

function renderPage(entry: string) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/reports/receivables-payables" element={<ReceivablesPayablesPage />} /></Routes></MemoryRouter>)
}

describe('ReceivablesPayablesPage', () => {
  it('keeps the parameter-free route on the summary view', () => {
    const html = renderPage('/reports/receivables-payables')
    expect(html).toContain('Gross Outstanding Sales Invoices')
    expect(html).toContain('Summary')
    expect(html).not.toContain('Expand All')
  })

  it('treats the legacy outstanding view as the detailed report', () => {
    const html = renderPage('/reports/receivables-payables?view=outstanding&asOf=2083-04-20')
    expect(html).toContain('Expand All')
    expect(html).toContain('Net Ledger')
  })

  it('reflects bucket, search, and as-of query parameters', () => {
    const html = renderPage('/reports/receivables-payables?view=aging&asOf=2083-04-20&bucket=1-30&search=INV-0001')
    expect(html).toContain('value="INV-0001"')
    expect(html).toContain('value="2083-04-20"')
    expect(html).toContain('Bucket: 1-30 Days')
    expect(html).toContain('aria-pressed="true"')
  })
})
