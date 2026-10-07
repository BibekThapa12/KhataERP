export const RESUME_RECONCILIATION_COOLDOWN_MS = 120_000

export interface ResumeReconciliationState {
  userId: string | null
  companyId: string | null
  lastKnownDataVersion: string | null
  dataReady: boolean
  dataStale: boolean
  reconcileCompany: (companyId: string) => Promise<void>
}

interface ResumeReconciliationOptions {
  expectedUserId: string
  expectedCompanyId: string
  lastCheckAt: number
  now?: number
  cooldownMs?: number
  getState: () => ResumeReconciliationState
  markChecked: (checkedAt: number) => void
  fetchDataVersion: (companyId: string) => Promise<string>
  publishDataVersion: (dataVersion: string) => void
}

export type ResumeReconciliationResult = 'cooldown' | 'obsolete' | 'unchanged' | 'reconciled'

/**
 * Cheap focus/reconnect safety net. Realtime remains the primary sync path;
 * the complete company snapshot runs only when the server revision is newer.
 */
export async function reconcileCompanyOnResume({
  expectedUserId,
  expectedCompanyId,
  lastCheckAt,
  now = Date.now(),
  cooldownMs = RESUME_RECONCILIATION_COOLDOWN_MS,
  getState,
  markChecked,
  fetchDataVersion,
  publishDataVersion,
}: ResumeReconciliationOptions): Promise<ResumeReconciliationResult> {
  if (now - lastCheckAt < cooldownMs) return 'cooldown'

  // Claim this window before the network request so focus + visibility events
  // cannot start duplicate checks while the first one is still pending.
  markChecked(now)
  const matches = (state: ResumeReconciliationState) =>
    state.userId === expectedUserId && state.companyId === expectedCompanyId

  const before = getState()
  if (!matches(before) || !before.dataReady) return 'obsolete'

  const serverVersion = await fetchDataVersion(expectedCompanyId)
  const checked = getState()
  if (!matches(checked)) return 'obsolete'
  if (checked.lastKnownDataVersion === serverVersion && !checked.dataStale) return 'unchanged'

  const versionBeforeReconcile = checked.lastKnownDataVersion
  await checked.reconcileCompany(expectedCompanyId)
  const reconciled = getState()
  if (!matches(reconciled) || reconciled.dataStale) return 'obsolete'
  // A realtime refresh may have published a newer marker while the recovery
  // snapshot was running. Never overwrite that newer knowledge with this
  // check's older observed revision.
  if (reconciled.lastKnownDataVersion === versionBeforeReconcile) publishDataVersion(serverVersion)
  return 'reconciled'
}
