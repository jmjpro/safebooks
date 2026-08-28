import { createTable } from '@visulima/tabular'
import type { PersistedRows } from '../persistence/query-persisted.js'

const VALUE_MAX_WIDTH = 70

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZoneName: 'longOffset',
})

// so/po/unclassified_documents (13-14 columns, two of them verbatim prose) use the 2-column
// expanded layout — see the rationale below `printSection`. so_items/po_items only have 6
// narrow columns (id, so_id/po_id, product_name, quantity, price, total_amount), none of them
// free text, so the wide-table layout has no column-budget fight to lose and reads as an
// actual item table (product/qty/price side by side) rather than 6 separate blocks per item.
export function printPersistedRows(rows: PersistedRows): void {
  printSection('so', rows.so)
  printWideSection('so_items', rows.soItems)
  printSection('po', rows.po)
  printWideSection('po_items', rows.poItems)
  printSection('unclassified_documents', rows.unclassifiedDocuments)
}

// Alternate renderer kept for comparison, NOT used by the real `npm run pipeline` output —
// everything in the wide-table layout, including so/po, to see why they were moved to the
// 2-column layout above. One wide table per section, one row per record; long free-text
// columns are capped+wrapped so they don't dominate, but with 12+ columns the table's
// terminal-width auto-fit still squeezes short columns (even `id`) to make room once the long
// ones claim their share.
export function printPersistedRowsAsWideTable(rows: PersistedRows): void {
  printWideSection('so', rows.so)
  printWideSection('so_items', rows.soItems)
  printWideSection('po', rows.po)
  printWideSection('po_items', rows.poItems)
  printWideSection('unclassified_documents', rows.unclassifiedDocuments)
}

// One expanded "field: value" block per row (psql's `\x` display) rather than a single wide
// table: so/po/unclassified_documents have 13-14 columns, two of them (burst,
// technical_account_manager) verbatim prose per ADR-0002/spec, and no fixed-width table shape
// stayed readable across 12+ columns regardless of library — tried console-table-printer and
// cli-table3/@visulima/tabular's horizontal-table mode, all either overflow the terminal or
// squeeze unrelated short columns (e.g. `id`) to fit. A 2-column key/value layout wraps long
// values cleanly at any terminal width without that column-budget fight. See issue 09
// (.scratch/document-extraction-pipeline/issues).
function printSection(label: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return
  console.log(`\n${label}:`)
  for (const row of rows) {
    const id = 'id' in row ? `#${String(row.id)}` : ''
    console.log(`-[ ${label}${id} ]-`)
    // An explicit `width` (unlike `maxWidth`) is never shrunk by the table's terminal-width
    // auto-fit, so a field name is never itself truncated even on a narrow terminal — only the
    // value column, via wordWrap+maxWidth below, gives up space. `width` counts padding
    // (default 1 char each side) toward the total, so pad the raw key length by 2 to leave
    // room for the longest key's text itself.
    const keyWidth = Math.max(...Object.keys(row).map((key) => key.length)) + 2
    const table = createTable({ showHeader: false, wordWrap: true })
    for (const [key, value] of Object.entries(row)) {
      table.addRow([
        { content: key, width: keyWidth },
        { content: formatValue(value), maxWidth: VALUE_MAX_WIDTH },
      ])
    }
    console.log(table.toString())
  }
}

// @visulima/tabular undercounts these "smart" typographic characters' display width by 1
// column (verified directly: en/em dash and all four curly quotes misalign a row's border by
// exactly 1 char relative to a same-length plain-ASCII row; ellipsis is unaffected). LLM
// extraction routinely produces them (e.g. "Analytics Platform – Enterprise", source
// filenames like "Purchase Order – BrightOps..."), so normalize to the ASCII equivalent for
// display only — the stored value is untouched, this only affects what's printed.
const DISPLAY_WIDTH_WORKAROUND: Record<string, string> = {
  '–': '-', // – en dash
  '—': '--', // — em dash
  '‘': "'", // ‘ left single quote
  '’': "'", // ’ right single quote
  '“': '"', // “ left double quote
  '”': '"', // ” right double quote
}
const DISPLAY_WIDTH_WORKAROUND_PATTERN = new RegExp(
  Object.keys(DISPLAY_WIDTH_WORKAROUND).join('|'),
  'g',
)

function formatValue(value: unknown): string {
  const text =
    value instanceof Date
      ? TIMESTAMP_FORMATTER.format(value).replace(', ', ' ')
      : String(value ?? '')
  return text.replace(
    DISPLAY_WIDTH_WORKAROUND_PATTERN,
    (char) => DISPLAY_WIDTH_WORKAROUND[char] ?? char,
  )
}

// Natural Language Fields (burst, technical_account_manager) are extracted as verbatim prose
// per ADR-0002/spec, and billing_address/source_filename also run long — capped and wrapped so
// these columns don't blow out the whole table's width. Columns not listed here keep their
// natural (auto-fit) width.
const WRAPPED_COLUMN_WIDTHS: Record<string, number> = {
  billing_address: 24,
  burst: 24,
  technical_account_manager: 24,
  source_filename: 28,
}

function printWideSection(label: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return
  console.log(`\n${label}:`)
  const columns = Object.keys(rows[0] ?? {})
  const table = createTable({ wordWrap: true })
  table.setHeaders(columns.map((column) => wideCell(column, column)))
  for (const row of rows) {
    table.addRow(columns.map((column) => wideCell(column, formatValue(row[column]))))
  }
  console.log(table.toString())
}

function wideCell(column: string, content: string): string | { content: string; maxWidth: number } {
  const maxWidth = WRAPPED_COLUMN_WIDTHS[column]
  return maxWidth ? { content, maxWidth } : content
}
