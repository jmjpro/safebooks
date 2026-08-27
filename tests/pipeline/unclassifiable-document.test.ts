import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Pool } from 'pg'
import { migrate } from '../../src/db/migrate.js'
import type { FieldExtractionResult } from '../../src/extraction/field-extractor.js'
import { runPipeline } from '../../src/pipeline/run.js'
import { ScriptedFieldExtractor } from '../support/scripted-field-extractor.js'

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

function stageDummyDocument(dir: string, filename = 'document.pdf'): void {
  writeFileSync(join(dir, filename), 'dummy pdf content')
}

function unclassified(): FieldExtractionResult {
  return {
    documentType: 'Unclassified',
    fields: { customer: 'Some Company' },
    items: [],
    fieldErrors: {},
  }
}

function extractionFailed(): FieldExtractionResult {
  return {
    documentType: 'ExtractionFailed',
    fields: {},
    items: [],
    fieldErrors: {
      customer: 'rate limited',
      startDate: 'rate limited',
      endDate: 'rate limited',
      amount: 'rate limited',
      paymentTerms: 'rate limited',
      billingAddress: 'rate limited',
      customerSignature: 'rate limited',
      burst: 'rate limited',
      technicalAccountManager: 'rate limited',
    },
  }
}

test('an unclassifiable document is persisted with needs_review status, not dropped', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-unclassified-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageDummyDocument(inputDir, 'mystery.pdf')

  const extractor = new ScriptedFieldExtractor([unclassified(), unclassified(), unclassified()])

  const { results, failures } = await runPipeline(inputDir, extractor, pool)

  assert.deepEqual(failures, [])
  assert.equal(results.length, 1)
  assert.equal(results[0]?.table, 'unclassified_documents')
  assert.equal(results[0]?.status, 'needs_review')

  const { rows } = await pool.query('SELECT * FROM unclassified_documents')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'needs_review')
  assert.equal(rows[0].source_filename, 'mystery.pdf')
  assert.equal(rows[0].customer, 'Some Company')
  assert.equal(rows[0].document_type, 'Unclassified')
})

test('a document where every retry attempt fails outright is distinguished from a genuinely unclassified one', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-extraction-failed-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageDummyDocument(inputDir, 'unreadable.pdf')

  const extractor = new ScriptedFieldExtractor([
    extractionFailed(),
    extractionFailed(),
    extractionFailed(),
  ])

  const { results, failures } = await runPipeline(inputDir, extractor, pool)

  assert.deepEqual(failures, [])
  assert.equal(results.length, 1)
  assert.equal(results[0]?.table, 'unclassified_documents')
  assert.equal(results[0]?.status, 'needs_review')
  assert.equal(results[0]?.documentType, 'ExtractionFailed')

  const { rows } = await pool.query('SELECT * FROM unclassified_documents')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'needs_review')
  assert.equal(rows[0].source_filename, 'unreadable.pdf')
  assert.equal(rows[0].document_type, 'ExtractionFailed')
  assert.equal(rows[0].customer, null)
})

test('an unclassifiable document is not written to so or po', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-unclassified-no-so-po-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageDummyDocument(inputDir)

  const extractor = new ScriptedFieldExtractor([unclassified(), unclassified(), unclassified()])

  await runPipeline(inputDir, extractor, pool)

  const so = await pool.query('SELECT * FROM so')
  const po = await pool.query('SELECT * FROM po')
  assert.equal(so.rows.length, 0)
  assert.equal(po.rows.length, 0)
})

after(async () => {
  await pool.end()
})
