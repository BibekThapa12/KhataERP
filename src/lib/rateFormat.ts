export function formatRateInput(value: string | number | null | undefined) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const numeric = Number(text)
  return Number.isFinite(numeric) ? numeric.toFixed(2) : text
}

export function rateInputNumber(value: string | number | null | undefined) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0
}
