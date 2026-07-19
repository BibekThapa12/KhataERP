export function escapeCsvCell(value: unknown): string {
    let text = value == null ? '' : String(value)
    // Spreadsheet applications may execute cells beginning with formula
    // control characters. Treat all exported application data as text, even
    // when an attacker adds leading whitespace/control characters first.
    let firstMeaningful = 0
    while (firstMeaningful < text.length && text.charCodeAt(firstMeaningful) <= 0x20) firstMeaningful += 1
    if ('=+-@'.includes(text[firstMeaningful] || '')) text = `'${text}`
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function downloadCsv(filename: string, headers: string[], rows: readonly (readonly unknown[])[]) {
  const csv = [headers, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
