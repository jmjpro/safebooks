// Manual dev tool — NOT part of the automated test suite (no *.test.ts, not run by `npm test`).
// Runs the real pipeline (concurrency, live per-file grid, DB writes) against a handful of
// throwaway dummy files and a stubbed extractor with artificial per-file delays, so the CLI
// grid (src/cli/live-progress-view.ts) can be watched end-to-end — spinners, retry counters,
// queued/running/success/warn/failure/unreached states — without a real (costly) Anthropic API
// run. Writes to (and truncates) TEST_DATABASE_URL, never the dev DB. Usage:
//   node --import dotenv/config --import tsx tests/support/preview-live-progress.ts
import 'dotenv/config'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { createLiveProgressView } from '../../src/cli/live-progress-view.js'
import { migrate } from '../../src/db/migrate.js'
import type {
  Document,
  FieldExtractionResult,
  FieldExtractor,
} from '../../src/extraction/field-extractor.js'
import { runPipeline } from '../../src/pipeline/run.js'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// One scripted outcome per file, exercising every visual state the grid supports: a clean
// processed pass, a needs_review pass (retried twice before giving up on one field), a
// genuinely unclassified document, a total extraction failure, and an unreadable file (never
// reaches the LLM/DB columns at all).
class PreviewExtractor implements FieldExtractor {
  async extract(document: Document): Promise<FieldExtractionResult> {
    await delay(400 + Math.random() * 800)

    if (document.filename === 'needs-review.pdf') {
      return {
        documentType: 'OrderForm',
        fields: { customer: 'Appsoft Inc.' },
        items: [],
        fieldErrors: { amount: 'not found in document' },
      }
    }
    if (document.filename === 'unclassified.pdf') {
      return { documentType: 'Unclassified', fields: {}, items: [], fieldErrors: {} }
    }
    if (document.filename === 'extraction-failed.pdf') {
      return {
        documentType: 'ExtractionFailed',
        fields: {},
        items: [],
        fieldErrors: { customer: 'rate limited', amount: 'rate limited' },
      }
    }
    return {
      documentType: 'OrderForm',
      fields: { customer: `Customer for ${document.filename}` },
      items: [],
      fieldErrors: {},
    }
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-preview-live-progress-'))

  try {
    await migrate(pool)
    await pool.query(
      'TRUNCATE TABLE so_items, so, po_items, po, unclassified_documents RESTART IDENTITY CASCADE',
    )

    for (const filename of [
      'processed-1.pdf',
      'processed-2.pdf',
      'needs-review.pdf',
      'unclassified.pdf',
      'extraction-failed.pdf',
    ]) {
      writeFileSync(join(inputDir, filename), 'dummy pdf content')
    }
    // Directory named *.pdf: passes the extension filter, fails the actual read (EISDIR).
    mkdirSync(join(inputDir, 'unreadable.pdf'))

    const { results, failures } = await runPipeline(inputDir, new PreviewExtractor(), pool, {
      concurrency: 3,
      createProgressView: createLiveProgressView,
    })

    console.log(`\n${results.length} result(s), ${failures.length} failure(s):`)
    for (const result of results)
      console.log(`  ${result.filename} -> ${result.table} (${result.status})`)
    for (const failure of failures) console.log(`  ${failure.filename} -> failed: ${failure.error}`)
  } finally {
    rmSync(inputDir, { recursive: true, force: true })
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
