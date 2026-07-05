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
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground/50" />}
        </div>
        <p className={cn('font-serif text-2xl font-bold mt-2 num', colorClass)}>{valueStr}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}
