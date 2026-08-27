const MM_DD_YYYY = /^(\d{2})-(\d{2})-(\d{4})$/

// Rejects both malformed strings and shape-valid-but-impossible calendar dates (e.g.
// "02-30-2025", "13-01-2025") that a format-only regex would let through. See ADR 0005.
export function isValidMmDdYyyyDate(value: string): boolean {
  const match = MM_DD_YYYY.exec(value)
  if (!match) {
    return false
  }

  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

// Converts an already-validated "mm-dd-yyyy" string to the ISO "yyyy-mm-dd" form Postgres
// accepts for a DATE column.
export function mmDdYyyyToIso(value: string): string {
  const [month, day, year] = value.split('-')
  return `${year}-${month}-${day}`
}
