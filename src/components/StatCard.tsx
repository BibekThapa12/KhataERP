import { cn, fmtMoney } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: number | string
  sub?: string
  color?: 'default' | 'positive' | 'negative' | 'warning'
  Icon?: LucideIcon
  className?: string
}

export function StatCard({ label, value, sub, color = 'default', Icon, className }: StatCardProps) {
  const valueStr = typeof value === 'number' ? fmtMoney(value) : value
  const colorClass = {
    default: 'text-[#1B2A4A]',
    positive: 'text-[#2D5F4C]',
    negative: 'text-[#B5482E]',
    warning: 'text-amber-600',
  }[color]

  return (
    <Card className={cn('', className)}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />}
        </div>
        <p className={cn('mt-1 font-serif text-[18px] font-bold leading-tight num', colorClass)}>{valueStr}</p>
        {sub && <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
