import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Pool } from 'pg'
// Side-effect import: registers pg's DATE type parser override before any caller of
// migrate() runs a query. Every entrypoint (index.ts, the eval tests) calls migrate()
// first, so piggybacking here guarantees it's registered ahead of any DATE column read.
import './date-type-parser.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function migrate(pool: Pool): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
}
