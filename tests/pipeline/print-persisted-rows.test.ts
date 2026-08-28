import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Pool } from 'pg'
import { migrate } from '../../src/db/migrate.js'
import type { FieldExtractionResult } from '../../src/extraction/field-extractor.js'
import { fetchPersistedRows } from '../../src/persistence/query-persisted.js'
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

function orderFormWithItem(): FieldExtractionResult {
  return {
    documentType: 'OrderForm',
    fields: { customer: 'Appsoft Inc.' },
    items: [{ productName: 'Widget', quantity: 2, price: 10, totalAmount: 20 }],
    fieldErrors: {},
  }
}

function purchaseOrder(): FieldExtractionResult {
  return {
    documentType: 'PurchaseOrder',
    fields: { customer: 'BrightOps Analytics' },
    items: [],
    fieldErrors: {},
  }
}

function unclassified(): FieldExtractionResult {
  return { documentType: 'Unclassified', fields: {}, items: [], fieldErrors: {} }
}

test('fetchPersistedRows re-fetches exactly the rows a pipeline run just wrote', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-print-persisted-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageDummyDocument(inputDir, 'so.pdf')

  const extractor = new ScriptedFieldExtractor([orderFormWithItem()])
  const { results } = await runPipeline(inputDir, extractor, pool)

  const persisted = await fetchPersistedRows(pool, results)

  assert.equal(persisted.so.length, 1)
  assert.equal(persisted.so[0]?.customer, 'Appsoft Inc.')
  assert.equal(persisted.soItems.length, 1)
  assert.equal(persisted.soItems[0]?.product_name, 'Widget')
  assert.equal(persisted.po.length, 0)
  assert.equal(persisted.poItems.length, 0)
  assert.equal(persisted.unclassifiedDocuments.length, 0)
})

test('fetchPersistedRows only returns rows for the ids passed in, not the whole table', async (t) => {
  await resetTables()
  const firstDir = mkdtempSync(join(tmpdir(), 'safebooks-print-persisted-first-'))
  t.after(() => rmSync(firstDir, { recursive: true, force: true }))
  stageDummyDocument(firstDir, 'po.pdf')
  await runPipeline(firstDir, new ScriptedFieldExtractor([purchaseOrder()]), pool)

  const secondDir = mkdtempSync(join(tmpdir(), 'safebooks-print-persisted-second-'))
  t.after(() => rmSync(secondDir, { recursive: true, force: true }))
  stageDummyDocument(secondDir, 'mystery.pdf')
  const { results: secondResults } = await runPipeline(
    secondDir,
    new ScriptedFieldExtractor([unclassified()]),
    pool,
  )

  const persisted = await fetchPersistedRows(pool, secondResults)

  assert.equal(persisted.po.length, 0)
  assert.equal(persisted.unclassifiedDocuments.length, 1)
  assert.equal(persisted.unclassifiedDocuments[0]?.source_filename, 'mystery.pdf')
})

after(async () => {
  await pool.end()
})
