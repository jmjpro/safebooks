import Anthropic from '@anthropic-ai/sdk'
import { Pool } from 'pg'
import { migrate } from './db/migrate.js'
import { AnthropicFieldExtractor } from './extraction/anthropic-field-extractor.js'
import { runPipeline } from './pipeline/run.js'

async function main(): Promise<void> {
  const inputDir = process.argv[2] ?? 'sample-input'
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await migrate(pool)

    const extractor = new AnthropicFieldExtractor(new Anthropic())
    const { results, failures } = await runPipeline(inputDir, extractor, pool)

    for (const result of results) {
      console.log(`${result.filename} -> ${result.table}#${result.id} (${result.status})`)
    }
    for (const failure of failures) {
      console.error(`${failure.filename} -> failed: ${failure.error}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
