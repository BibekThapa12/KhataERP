import { fmtDate } from '@/lib/utils'
import { todayBs } from '@/lib/nepaliDate'
import type { Company } from '@/types'

interface FormalReportPrintHeaderProps {
  company?: Company | null
  title: string
  periodLabel?: string
  detailLabel?: string
}

export function FormalReportPrintHeader({ company, title, periodLabel, detailLabel }: FormalReportPrintHeaderProps) {
  return <section className="formal-report-print-header hidden" aria-hidden="true">
    <header className="formal-report-heading">
      <h1>{title}</h1>
      <h2>{company?.name || 'Company'}</h2>
      {company?.address && <p>{company.address}</p>}
      {company?.pan_vat && <p>PAN/VAT No: {company.pan_vat}</p>}
    </header>
    <div className="formal-report-meta">
      <div>
        <p><strong>Report</strong><span>:</span><b>{title}</b></p>
        {detailLabel && <p><strong>Selection</strong><span>:</span><b>{detailLabel}</b></p>}
      </div>
      <div>
        {periodLabel && <p><strong>Period</strong><span>:</span><b>{periodLabel}</b></p>}
        <p><strong>Print Date (BS)</strong><span>:</span><b>{fmtDate(todayBs())}</b></p>
      </div>
    </div>
  </section>
}

export function FormalReportPrintFooter() {
  return <footer className="formal-report-print-footer hidden" aria-hidden="true">
    <div><p>Prepared By: ____________________</p><p>Date: ____________________</p></div>
    <div><p>Checked By: ____________________</p><p>Authorized By: _________________</p></div>
    <p className="formal-report-generated-note">This is a computer-generated report.</p>
  </footer>
}
