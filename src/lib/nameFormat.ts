export function formatMasterName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word)
    .join(' ')
}

export function masterNameKey(value: string) {
  return formatMasterName(value).toLowerCase()
}
