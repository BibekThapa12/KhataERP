import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <div className={cn('sticky top-0 z-10 flex flex-col items-stretch gap-3 border-b border-border bg-background px-4 py-4 pl-16 sm:flex-row sm:items-start sm:justify-between md:px-6 md:py-5', className)}>
      <div>
        <h1 className="font-serif text-xl font-bold text-[#1B2A4A] sm:text-2xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {action && <div className="w-full flex-shrink-0 sm:w-auto">{action}</div>}
    </div>
  )
}

export function PageContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-3 py-4 sm:px-4 md:px-6 md:py-5', className)}>{children}</div>
}
