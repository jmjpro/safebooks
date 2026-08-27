import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function migrate(pool: Pool): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
}
