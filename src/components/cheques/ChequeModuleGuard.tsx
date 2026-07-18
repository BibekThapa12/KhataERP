import { useAppStore } from '@/store/useAppStore'
import { chequeEntitlement } from '@/lib/cheques'
import type { ChequePermission } from '@/types'

export function ChequeModuleGuard({ children, permission = 'cheque.view', write = false }: { children: React.ReactNode; permission?: ChequePermission; write?: boolean }) {
  const loading = useAppStore(s => s.loading)
  const companyModules = useAppStore(s => s.companyModules)
  const permissions = useAppStore(s => s.chequePermissions)
  if (loading) return <div className="p-4 text-sm text-muted-foreground">Checking module access…</div>
  const entitlement = companyModules.find(entry => entry.module?.key === 'cheque_management')
  const access = chequeEntitlement(entitlement)
  if (!access.canRead || (write && !access.canWrite) || !permissions.includes(permission)) {
    return <div className="flex min-h-[55vh] items-center justify-center p-4"><div className="max-w-md rounded-md border bg-card p-5 text-center"><h1 className="font-serif text-lg font-bold">Cheque Management unavailable</h1><p className="mt-1 text-xs text-muted-foreground">{access.reason || 'Your account does not have permission for this action.'}</p></div></div>
  }
  return <>{children}</>
}
