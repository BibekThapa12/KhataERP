import type { SearchableSelectOption } from '@/components/inputs/SearchableSelect'

export const normalizeSearch = (value: string) => value.toLocaleLowerCase().replace(/[›>]/g, ' ').trim().replace(/\s+/g, ' ')

export function filterSearchableOptions(options: SearchableSelectOption[], query: string) {
  const needle = normalizeSearch(query)
  if (!needle) return options
  return options.filter(option => normalizeSearch(`${option.label} ${option.searchText || ''}`).includes(needle))
}

export function groupSearchableOptions(options: SearchableSelectOption[]) {
  if (!options.some(option => option.group)) return options
  const ungrouped = options.filter(option => !option.group)
  const groupOrder = [...new Set(options.map(option => option.group).filter((group): group is string => !!group))]
  return [...ungrouped, ...groupOrder.flatMap(group => options.filter(option => option.group === group))]
}
