export function formatRateInput(value: string | number | null | undefined) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const numeric = Number(text)
  if (!Number.isFinite(numeric)) return text
  return text
}

export function hasAtMostSixDecimalPlaces(value: string | number | null | undefined) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text || !Number.isFinite(Number(text))) return false
  const [coefficient, exponentText] = text.split('e')
  const decimalPlaces = coefficient.includes('.') ? coefficient.length - coefficient.indexOf('.') - 1 : 0
  const exponent = exponentText ? Number(exponentText) : 0
  return Math.max(0, decimalPlaces - exponent) <= 6
}

export function rateInputNumber(value: string | number | null | undefined) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}
