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
  await pool.query('TRUNCATE TABLE so_items, so, po_items, po RESTART IDENTITY CASCADE')
}

function stageDummyDocument(dir: string, filename = 'document.pdf'): void {
  writeFileSync(join(dir, filename), 'dummy pdf content')
}

const FULL_FIELDS = {
  customer: 'Appsoft Inc.',
  startDate: '01-01-2025',
  endDate: '12-31-2026',
  amount: 100000,
  paymentTerms: 'Net 30',
  billingAddress: '123 Main Street, New York, NY, USA',
  customerSignature: true,
}

// A fully successful OrderForm extraction result, for scripting individual attempts.
function fullSuccess(): FieldExtractionResult {
  return { documentType: 'OrderForm', fields: { ...FULL_FIELDS }, items: [], fieldErrors: {} }
}

// The same result but with `amount` missing and flagged as a fieldError, as if the LLM
// failed to find/validate that one field on this attempt.
function missingAmount(): FieldExtractionResult {
  const result = fullSuccess()
  delete result.fields.amount
  result.fieldErrors = { amount: 'not found in document' }
  return result
}

test('a field that fails on the first attempt and succeeds on retry: record is "processed" with the field populated', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-retry-succeed-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageDummyDocument(inputDir)

  const extractor = new ScriptedFieldExtractor([missingAmount(), fullSuccess()])

  await runPipeline(inputDir, extractor, pool)

  assert.equal(extractor.calls, 2)

  const { rows } = await pool.query('SELECT * FROM so')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'processed')
  assert.equal(Number(rows[0].amount), FULL_FIELDS.amount)
  assert.equal(rows[0].customer, FULL_FIELDS.customer)
})

test('a field that fails on every attempt: record is "needs_review" with that field null and other fields populated', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-retry-exhausted-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageDummyDocument(inputDir)

  const extractor = new ScriptedFieldExtractor([missingAmount(), missingAmount(), missingAmount()])

  await runPipeline(inputDir, extractor, pool)

  assert.equal(extractor.calls, 3)

  const { rows } = await pool.query('SELECT * FROM so')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'needs_review')
  assert.equal(rows[0].amount, null)
  assert.equal(rows[0].customer, FULL_FIELDS.customer)
  assert.equal(rows[0].payment_terms, FULL_FIELDS.paymentTerms)
  assert.equal(rows[0].billing_address, FULL_FIELDS.billingAddress)
  assert.equal(rows[0].customer_signature, FULL_FIELDS.customerSignature)
})

test('a failing field is retried up to 2 additional times (3 attempts total) before being treated as failed', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-retry-count-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageDummyDocument(inputDir)

  // Exactly 3 responses scripted, all failing. If the pipeline retried a 4th time,
  // ScriptedFieldExtractor would replay this same failing response and calls would be 4,
  // not 3 — so calls === 3 is what pins the retry ceiling at 3 attempts total.
  const extractor = new ScriptedFieldExtractor([missingAmount(), missingAmount(), missingAmount()])

  await runPipeline(inputDir, extractor, pool)

  assert.equal(extractor.calls, 3)
})

test('a document that extracts and validates every field on the first attempt is unaffected: "processed" after a single call', async (t) => {
  await resetTables()
  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-first-attempt-success-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageDummyDocument(inputDir)

  const extractor = new ScriptedFieldExtractor([fullSuccess()])

  await runPipeline(inputDir, extractor, pool)

  assert.equal(extractor.calls, 1)
  const { rows } = await pool.query('SELECT * FROM so')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'processed')
  assert.equal(rows[0].customer, FULL_FIELDS.customer)
})

after(async () => {
  await pool.end()
})
