import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { Pool } from 'pg'
import { createLiveProgressView } from './cli/live-progress-view.js'
import { printPersistedRows } from './cli/print-persisted-rows.js'
import { migrate } from './db/migrate.js'
import { AnthropicFieldExtractor } from './extraction/anthropic-field-extractor.js'
import { DEFAULT_CONCURRENCY, runPipeline } from './pipeline/run.js'
import { fetchPersistedRows } from './persistence/query-persisted.js'

const CONCURRENCY_FLAG_PREFIX = '--concurrency='

function parseConcurrency(argv: string[]): number {
  const flag = argv.find((arg) => arg.startsWith(CONCURRENCY_FLAG_PREFIX))
  const raw = flag ? flag.slice(CONCURRENCY_FLAG_PREFIX.length) : process.env.PIPELINE_CONCURRENCY
  const value = Number(raw)
  return raw !== undefined && Number.isInteger(value) && value > 0 ? value : DEFAULT_CONCURRENCY
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const inputDir = argv.find((arg) => !arg.startsWith('--')) ?? 'sample-input'
  const concurrency = parseConcurrency(argv)
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  console.log(`Starting pipeline (input: ${inputDir}, concurrency: ${concurrency})`)

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await migrate(pool)

    const extractor = new AnthropicFieldExtractor(new Anthropic())
    const { results, failures } = await runPipeline(inputDir, extractor, pool, {
      concurrency,
      createProgressView: createLiveProgressView,
    })

    // No per-file success summary here: the live grid already shows each file's filename and
    // final per-stage status, and the recap below (printPersistedRows) shows each row's own
    // #id and source_filename. A failed file gets no recap row at all, so its error message is
    // still only printed here.
    for (const failure of failures) {
      console.error(`${failure.filename} -> failed: ${failure.error}`)
    }
    if (failures.length > 0) {
      process.exitCode = 1
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
