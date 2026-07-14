import { Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ReportActionsProps {
  onExport: () => void
}

export function ReportActions({ onExport }: ReportActionsProps) {
  return <div className="report-actions flex flex-wrap items-center justify-end gap-2">
    <Button variant="outline" onClick={onExport}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
    <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>
  </div>
}
