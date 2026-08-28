// Manual dev tool — NOT part of the automated test suite (no *.test.ts, not run by `npm test`).
// Prints whatever so/po/unclassified_documents rows already exist in the dev DB, exactly as
// `npm run pipeline` would, so the CLI table formatting (src/cli/print-persisted-rows.ts) can be
// iterated on in milliseconds instead of waiting on a real Anthropic API run. Doesn't write
// anything — run `npm run pipeline` at least once first if the dev DB is empty. Usage:
//   node --import tsx tests/support/preview-persisted-rows.ts [--wide]
// --wide renders the alternate one-wide-table-per-section layout (printPersistedRowsAsWideTable)
// instead of the real pipeline's 2-column expanded display — for comparison only.
import 'dotenv/config'
import { Pool } from 'pg'
import {
  printPersistedRows,
  printPersistedRowsAsWideTable,
} from '../../src/cli/print-persisted-rows.js'
import { migrate } from '../../src/db/migrate.js'
import type { PersistedRows } from '../../src/persistence/query-persisted.js'

const useWideTable = process.argv.includes('--wide')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}

async function fetchAll(pool: Pool, table: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id`)
  return rows
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await migrate(pool)

    const [so, soItems, po, poItems, unclassifiedDocuments] = await Promise.all([
      fetchAll(pool, 'so'),
      fetchAll(pool, 'so_items'),
      fetchAll(pool, 'po'),
      fetchAll(pool, 'po_items'),
      fetchAll(pool, 'unclassified_documents'),
    ])
    const rows: PersistedRows = { so, soItems, po, poItems, unclassifiedDocuments }

    if (Object.values(rows).every((table) => table.length === 0)) {
      console.log('Dev DB is empty — run `npm run pipeline` once first.')
      return
    }

    if (useWideTable) {
      printPersistedRowsAsWideTable(rows)
    } else {
      printPersistedRows(rows)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
