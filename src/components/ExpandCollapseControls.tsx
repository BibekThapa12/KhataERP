import { ChevronsDown, ChevronsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ExpandCollapseControls({ expanded, onToggle, className }: { expanded: boolean; onToggle: () => void; className?: string }) {
  const Icon = expanded ? ChevronsUp : ChevronsDown
  const label = expanded ? 'Collapse All' : 'Expand All'
  return <div className={cn('flex items-center justify-end print:hidden', className)}>
    <Button type="button" size="sm" variant="outline" className="h-8 border-primary/35 px-3 font-semibold text-primary shadow-sm hover:border-primary/60 hover:bg-primary/5" onClick={onToggle} aria-label={`${label} sections`} aria-pressed={expanded}><Icon className="mr-1.5 h-3.5 w-3.5" />{label}</Button>
  </div>
}
