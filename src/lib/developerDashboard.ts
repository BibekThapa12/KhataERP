export function dedupeModules<T extends { id: string; key: string }>(modules: T[]) {
  const seen = new Set<string>()
  return modules.filter(module => {
    const key = module.key.trim().toLowerCase() || module.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function canonicalizeModuleEntitlements<
  M extends { id: string; key: string },
  E extends { company_id: string; module_id: string; is_enabled: boolean },
>(modules: M[], entitlements: E[]) {
  const canonicalByKey = new Map<string, string>()
  const canonicalById = new Map<string, string>()
  for (const module of modules) {
    const key = module.key.trim().toLowerCase() || module.id
    const canonicalId = canonicalByKey.get(key) || module.id
    canonicalByKey.set(key, canonicalId)
    canonicalById.set(module.id, canonicalId)
  }

  const result = new Map<string, E>()
  for (const entitlement of entitlements) {
    const moduleId = canonicalById.get(entitlement.module_id) || entitlement.module_id
    const key = `${entitlement.company_id}:${moduleId}`
    const normalized = moduleId === entitlement.module_id ? entitlement : { ...entitlement, module_id: moduleId }
    const existing = result.get(key)
    if (!existing || (!existing.is_enabled && normalized.is_enabled)) result.set(key, normalized)
  }
  return [...result.values()]
}

export function getBackupLocationLabel(directory: { name?: string | null } | null, supported: boolean) {
  const name = directory?.name?.trim()
  if (name && name !== '/' && name !== '\\') return name
  if (directory) return 'Folder selected (name unavailable)'
  return supported ? 'Not configured' : 'Folder access unavailable — ZIP only'
}
