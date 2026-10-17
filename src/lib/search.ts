import type { SearchableSelectOption } from '@/components/inputs/SearchableSelect'

export const normalizeSearch = (value: string) => value.toLocaleLowerCase().replace(/[›>]/g, ' ').trim().replace(/\s+/g, ' ')

export function filterSearchableOptions(options: SearchableSelectOption[], query: string) {
  const needle = normalizeSearch(query)
  if (!needle) return options
  return options.filter(option => normalizeSearch([
    option.label,
    option.secondaryText,
    option.trailingText,
    option.group,
    option.searchText,
  ].filter(Boolean).join(' ')).includes(needle))
}

export function groupSearchableOptions(options: SearchableSelectOption[]) {
  if (!options.some(option => option.group)) return options
  const ungrouped: SearchableSelectOption[] = []
  const grouped = new Map<string, SearchableSelectOption[]>()
  options.forEach(option => {
    if (!option.group) { ungrouped.push(option); return }
    const entries = grouped.get(option.group)
    if (entries) entries.push(option)
    else grouped.set(option.group, [option])
  })
  return [...ungrouped, ...grouped.values()].flat()
}
