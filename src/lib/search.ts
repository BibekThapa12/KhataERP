import type { SearchableSelectOption } from '@/components/inputs/SearchableSelect'

export const normalizeSearch = (value: string) => value.toLocaleLowerCase().trim().replace(/\s+/g, ' ')

export function filterSearchableOptions(options: SearchableSelectOption[], query: string) {
  const needle = normalizeSearch(query)
  if (!needle) return options
  return options.filter(option => normalizeSearch(`${option.label} ${option.searchText || ''}`).includes(needle))
}
