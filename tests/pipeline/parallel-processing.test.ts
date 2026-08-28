import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Pool } from 'pg'
import type { Stage, StageState } from '../../src/cli/live-progress-view.js'
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

const pool = new Pool({ connectionString: databaseUrl })

async function resetTables(): Promise<void> {
  await migrate(pool)
  await pool.query(
    'TRUNCATE TABLE so_items, so, po_items, po, unclassified_documents RESTART IDENTITY CASCADE',
  )
}

function stageFiles(dir: string, filenames: string[]): void {
  for (const filename of filenames) {
    writeFileSync(join(dir, filename), 'dummy pdf content')
  }
}

// Records how many extract() calls are in flight at once, so a test can assert the pipeline
// actually overlaps file processing (and stays within the configured bound).
class ConcurrencyTrackingExtractor implements FieldExtractor {
  inFlight = 0
  maxInFlight = 0

  async extract(): Promise<FieldExtractionResult> {
    this.inFlight++
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    await new Promise((resolve) => setTimeout(resolve, 25))
    this.inFlight--
    return {
      documentType: 'OrderForm',
      fields: { customer: 'Appsoft Inc.' },
      items: [],
      fieldErrors: {},
    }
  }
}

test('files are processed concurrently, up to the configured limit', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-parallel-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageFiles(inputDir, ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'])

  const extractor = new ConcurrencyTrackingExtractor()
  const { results, failures } = await runPipeline(inputDir, extractor, pool, { concurrency: 4 })

  assert.deepEqual(failures, [])
  assert.equal(results.length, 4)
  assert.ok(
    extractor.maxInFlight > 1,
    `expected overlapping extract() calls, saw max ${extractor.maxInFlight} in flight`,
  )
  assert.ok(
    extractor.maxInFlight <= 4,
    `expected at most 4 in flight, saw ${extractor.maxInFlight}`,
  )
})

test('concurrency of 1 processes files strictly one at a time', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-parallel-serial-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageFiles(inputDir, ['a.pdf', 'b.pdf', 'c.pdf'])

  const extractor = new ConcurrencyTrackingExtractor()
  await runPipeline(inputDir, extractor, pool, { concurrency: 1 })

  assert.equal(extractor.maxInFlight, 1)
})

test('one file failing outright does not stop the others from completing', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-parallel-failure-isolation-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageFiles(inputDir, ['good.pdf', 'bad.pdf'])

  class MixedExtractor implements FieldExtractor {
    async extract(document: Document): Promise<FieldExtractionResult> {
      if (document.filename === 'bad.pdf') throw new Error('unexpected extractor bug')
      return {
        documentType: 'OrderForm',
        fields: { customer: 'Appsoft Inc.' },
        items: [],
        fieldErrors: {},
      }
    }
  }

  const { results, failures } = await runPipeline(inputDir, new MixedExtractor(), pool, {
    concurrency: 2,
  })

  assert.equal(results.length, 1)
  assert.equal(results[0]?.filename, 'good.pdf')
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.filename, 'bad.pdf')
  assert.match(failures[0]?.error ?? '', /unexpected extractor bug/)
})

test('a file that cannot be read never reaches the LLM or DB stage, and other files are unaffected', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-parallel-read-failure-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageFiles(inputDir, ['good.pdf'])
  // A directory named *.pdf passes the extension filter but fails a file read (EISDIR).
  mkdirSync(join(inputDir, 'unreadable.pdf'))

  const events: Array<{ filename: string; stage: Stage; state: StageState }> = []
  class OkExtractor implements FieldExtractor {
    async extract(): Promise<FieldExtractionResult> {
      return {
        documentType: 'OrderForm',
        fields: { customer: 'Appsoft Inc.' },
        items: [],
        fieldErrors: {},
      }
    }
  }

  const { results, failures } = await runPipeline(inputDir, new OkExtractor(), pool, {
    concurrency: 2,
    createProgressView: () => ({
      onProgress: (filename, stage, state) => events.push({ filename, stage, state }),
      stop: () => {},
    }),
  })

  assert.equal(results.length, 1)
  assert.equal(results[0]?.filename, 'good.pdf')
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.filename, 'unreadable.pdf')

  const unreadableEvents = events.filter((e) => e.filename === 'unreadable.pdf')
  assert.deepEqual(
    unreadableEvents.map((e) => [e.stage, e.state.kind]),
    [
      ['read', 'running'],
      ['read', 'failure'],
      ['llm', 'unreached'],
      ['db', 'unreached'],
    ],
  )
})

test('progress view is created with the full filename list upfront, and receives every stage transition', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-parallel-progress-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageFiles(inputDir, ['solo.pdf'])

  let discoveredFilenames: string[] | undefined
  const events: Array<{ stage: Stage; state: StageState }> = []
  let stopped = false

  class OkExtractor implements FieldExtractor {
    async extract(): Promise<FieldExtractionResult> {
      return {
        documentType: 'OrderForm',
        fields: { customer: 'Appsoft Inc.' },
        items: [],
        fieldErrors: {},
      }
    }
  }

  await runPipeline(inputDir, new OkExtractor(), pool, {
    createProgressView: (filenames) => {
      discoveredFilenames = filenames
      return {
        onProgress: (_filename, stage, state) => events.push({ stage, state }),
        stop: () => {
          stopped = true
        },
      }
    },
  })

  assert.deepEqual(discoveredFilenames, ['solo.pdf'])
  assert.ok(stopped, 'expected the progress view to be stopped once the run finished')
  assert.deepEqual(
    events.map((e) => [e.stage, e.state.kind]),
    [
      ['read', 'running'],
      ['read', 'success'],
      ['llm', 'running'],
      ['llm', 'success'],
      ['db', 'running'],
      ['db', 'success'],
    ],
  )
})

after(async () => {
  await pool.end()
})
