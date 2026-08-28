import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { Pool } from 'pg'
import { printPersistedRows } from './cli/print-persisted-rows.js'
import { migrate } from './db/migrate.js'
import { AnthropicFieldExtractor } from './extraction/anthropic-field-extractor.js'
import { runPipeline } from './pipeline/run.js'
import { fetchPersistedRows } from './persistence/query-persisted.js'

async function main(): Promise<void> {
  const inputDir = process.argv[2] ?? 'sample-input'
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  console.log(`Starting pipeline (input: ${inputDir})`)

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await migrate(pool)

    const extractor = new AnthropicFieldExtractor(new Anthropic())
    const { results, failures } = await runPipeline(inputDir, extractor, pool, (message) =>
      console.log(message),
    )

    for (const result of results) {
      const detail = result.documentType
        ? `${result.status}: ${result.documentType}`
        : result.status
      console.log(`${result.filename} -> ${result.table}#${result.id} (${detail})`)
    }
    for (const failure of failures) {
      console.error(`${failure.filename} -> failed: ${failure.error}`)
    }

    if (results.length > 0) {
      printPersistedRows(await fetchPersistedRows(pool, results))
    }
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
