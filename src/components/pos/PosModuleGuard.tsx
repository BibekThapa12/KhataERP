import { useAppStore } from '@/store/useAppStore'
import { POS_MODULE_KEY, posModuleAccess } from '@/lib/pos'

export function usePosModuleAccess() {
  const companyModules = useAppStore(s => s.companyModules)
  return posModuleAccess(companyModules.find(entry => entry.module?.key === POS_MODULE_KEY))
}

export function PosModuleGuard({ children }: { children: React.ReactNode }) {
  const loading = useAppStore(s => s.loading)
  const access = usePosModuleAccess()
  if (loading) return <div className="p-4 text-sm text-muted-foreground">Checking module access…</div>
  if (!access.enabled) {
    return <div className="flex min-h-screen items-center justify-center p-4"><div className="max-w-md rounded-md border bg-card p-5 text-center"><h1 className="font-serif text-lg font-bold">POS Counter unavailable</h1><p className="mt-1 text-xs text-muted-foreground">{access.reason}</p><a href="/" className="mt-3 inline-block text-xs text-primary hover:underline">Back to KhataERP</a></div></div>
  }
  return <>{children}</>
}
