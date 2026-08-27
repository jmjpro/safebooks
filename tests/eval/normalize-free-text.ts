// Collapses whitespace/newlines/commas so "Street\nCity, ST" and "Street, City, ST" compare equal —
// line breaks vs. commas are a formatting choice in free text, not an accuracy signal.
export function normalizeFreeText(value: unknown): unknown {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .replace(/[\s,]+/g, ' ')
        .trim()
    : value
}
