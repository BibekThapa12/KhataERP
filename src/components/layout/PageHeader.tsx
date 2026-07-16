import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <div className={cn('sticky top-0 z-10 flex flex-col items-stretch gap-2 border-b border-border bg-background px-3 py-2.5 pl-16 sm:flex-row sm:items-start sm:justify-between md:px-4 md:py-3', className)}>
      <div>
        <h1 className="font-serif text-[18px] font-bold leading-tight text-[#1B2A4A]">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="w-full flex-shrink-0 sm:w-auto">{action}</div>}
    </div>
  )
}

export function PageContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-2.5 py-3 sm:px-3 md:px-4 md:py-3', className)}>{children}</div>
}
