import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ReportPaperFormat = 'A4' | 'A5'

interface ReportActionsProps {
  onExport: () => void
  defaultFormat?: ReportPaperFormat
  orientation?: 'portrait' | 'landscape'
}

function printReport(format: ReportPaperFormat, orientation: 'portrait' | 'landscape') {
  const style = document.createElement('style')
  style.dataset.reportPrint = 'true'
  const compact = format === 'A5'
  const summaryColumns = orientation === 'landscape' ? 4 : compact ? 2 : 3
  style.textContent = `@media print {
    @page { size: ${format} ${orientation}; margin: ${compact ? '7mm' : '10mm'}; }
    .report-content { font-size: ${compact ? '8px' : '10px'} !important; }
    .report-print-header h1 { font-size: ${compact ? '16px' : '20px'} !important; }
    .report-print-header p { font-size: ${compact ? '8px' : '10px'} !important; }
    .report-th { padding: ${compact ? '3px 4px' : '5px 6px'} !important; font-size: ${compact ? '6px' : '8px'} !important; }
    .report-td { padding: ${compact ? '3px 4px' : '5px 6px'} !important; }
    .report-table-card th, .report-table-card td { padding: ${compact ? '3px 4px' : '5px 6px'} !important; }
    .report-print-columns { grid-template-columns: ${compact && orientation === 'portrait' ? '1fr' : 'repeat(2, minmax(0, 1fr))'} !important; gap: ${compact ? '5px' : '10px'} !important; }
    .report-summary { grid-template-columns: repeat(${summaryColumns}, minmax(0, 1fr)) !important; gap: ${compact ? '4px' : '8px'} !important; }
    .report-summary > div > div { padding: ${compact ? '5px' : '8px'} !important; }
    .report-summary svg { display: none !important; }
    .report-summary p { margin-top: ${compact ? '2px' : '4px'} !important; font-size: ${compact ? '7px' : '9px'} !important; }
  }`
  document.head.appendChild(style)
  const cleanup = () => style.remove()
  window.addEventListener('afterprint', cleanup, { once: true })
  window.setTimeout(() => { window.print(); window.setTimeout(cleanup, 1000) }, 0)
}

export function ReportActions({ onExport, defaultFormat = 'A4', orientation = 'portrait' }: ReportActionsProps) {
  const [format, setFormat] = useState<ReportPaperFormat>(defaultFormat)
  return <div className="report-actions flex flex-wrap items-center justify-end gap-2">
    <div className="inline-flex rounded-md border bg-background p-0.5" role="group" aria-label="Print paper size">
      {(['A4', 'A5'] as const).map(value => <Button key={value} type="button" size="sm" variant={format === value ? 'default' : 'ghost'} className="h-7 px-2.5" onClick={() => setFormat(value)}>{value}</Button>)}
    </div>
    <Button variant="outline" onClick={onExport}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
    <Button variant="outline" onClick={() => printReport(format, orientation)}><Printer className="mr-2 h-4 w-4" />Print</Button>
  </div>
}
