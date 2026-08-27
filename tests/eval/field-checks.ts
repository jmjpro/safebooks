import type { ExtractedItem } from '../../src/extraction/field-extractor.js'
import { normalizeFreeText } from './normalize-free-text.js'

// Shared pass/fail primitives for comparing an extracted (or persisted) value against a
// hand-verified expected value. Used by both the extraction-only model-comparison eval and
// the DB-backed end-to-end accuracy eval so the two can't silently diverge on what "correct"
// means for a given field.
export interface FieldCheck {
  field: string
  pass: boolean
  expected: string
  actual: string
}

function display(value: unknown): string {
  return value === undefined ? 'null' : JSON.stringify(value)
}

export function checkExact(field: string, expected: unknown, actual: unknown): FieldCheck {
  return { field, pass: actual === expected, expected: display(expected), actual: display(actual) }
}

export function checkFreeText(
  field: string,
  expected: string,
  actual: string | undefined,
): FieldCheck {
  const check = checkExact(field, normalizeFreeText(expected), normalizeFreeText(actual))
  return { ...check, expected: display(expected), actual: display(actual) }
}

export function checkPattern(
  field: string,
  pattern: RegExp | null,
  actual: string | undefined,
): FieldCheck {
  const pass =
    pattern === null ? actual === undefined : actual !== undefined && pattern.test(actual)
  return {
    field,
    pass,
    expected: pattern === null ? 'null' : pattern.source,
    actual: display(actual),
  }
}

export function checkItems(expected: ExtractedItem[], actual: ExtractedItem[]): FieldCheck[] {
  const checks: FieldCheck[] = [
    {
      field: 'items.length',
      pass: actual.length === expected.length,
      expected: String(expected.length),
      actual: String(actual.length),
    },
  ]
  const rows = Math.max(expected.length, actual.length)
  for (let i = 0; i < rows; i++) {
    const exp = expected[i]
    const act = actual[i]
    for (const key of ['productName', 'quantity', 'price', 'totalAmount'] as const) {
      checks.push(checkExact(`items[${i}].${key}`, exp?.[key], act?.[key]))
    }
  }
  return checks
}
