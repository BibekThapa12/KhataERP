type SidebarSearchableDestination = {
  label: string
  parent: string
  keywords?: readonly string[]
}

export function normalizeSidebarQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function phrasePosition(value: string, query: string) {
  const normalized = normalizeSidebarQuery(value)
  return { normalized, index: normalized.indexOf(query) }
}

export function rankSidebarDestinations<T extends SidebarSearchableDestination>(destinations: T[], query: string) {
  const normalizedQuery = normalizeSidebarQuery(query)
  if (!normalizedQuery) return [...destinations]

  return destinations.map((item, originalIndex) => {
    const title = phrasePosition(item.label, normalizedQuery)
    const aliases = (item.keywords || []).map(keyword => phrasePosition(keyword, normalizedQuery)).filter(match => match.index >= 0)
    const parent = phrasePosition(item.parent, normalizedQuery)

    let tier = Number.POSITIVE_INFINITY
    let position = Number.POSITIVE_INFINITY
    if (title.normalized === normalizedQuery) { tier = 0; position = 0 }
    else if (title.normalized.startsWith(normalizedQuery)) { tier = 1; position = 0 }
    else if (title.index >= 0) { tier = 2; position = title.index }
    else if (aliases.length) { tier = 3; position = Math.min(...aliases.map(match => match.index)) }
    else if (parent.index >= 0) { tier = 4; position = parent.index }

    return { item, originalIndex, tier, position, titleLength: title.normalized.length }
  }).filter(match => Number.isFinite(match.tier)).sort((left, right) =>
    left.tier - right.tier
    || left.position - right.position
    || (left.tier <= 2 ? left.titleLength - right.titleLength : 0)
    || left.originalIndex - right.originalIndex
  ).map(match => match.item)
}

export function filterSidebarDestinations<T extends SidebarSearchableDestination>(destinations: T[], query: string, limit = 10) {
  return rankSidebarDestinations(destinations, query).slice(0, limit)
}

export function sidebarPreferenceKeys(userId: string) {
  return {
    collapsed: `khataerp:sidebar-collapsed:${userId}`,
    sections: `khataerp:sidebar-sections:${userId}`,
    groups: `khataerp:sidebar-groups:${userId}`,
  }
}
