import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import Anthropic from '@anthropic-ai/sdk'
import { Pool } from 'pg'
import { migrate } from '../../src/db/migrate.js'
import { AnthropicFieldExtractor } from '../../src/extraction/anthropic-field-extractor.js'
import { runPipeline } from '../../src/pipeline/run.js'
import { ACME_ORDER_FORM } from './fixtures/acme-order-form.js'
import { BRIGHTOPS_PURCHASE_ORDER } from './fixtures/brightops-purchase-order.js'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set')
}

const pool = new Pool({ connectionString: databaseUrl })

async function resetTables(): Promise<void> {
  await migrate(pool)
  await pool.query('TRUNCATE TABLE so_items, so, po_items, po RESTART IDENTITY CASCADE')
}

function stageSample(dir: string, sourceFilename: string, stagedFilename = sourceFilename): void {
  copyFileSync(join(process.cwd(), 'sample-input', sourceFilename), join(dir, stagedFilename))
}

// BrightOps' source document wraps its billing address across lines ("42 King George
// Street" / "London, UK"); collapsing whitespace/commas before comparing treats that line
// break the same as a comma, since free text formatting isn't part of what's being checked.
function normalizeFreeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s,]+/g, ' ')
    .trim()
}

test('Purchase Order happy path: BrightOps sample document -> po + po_items', async (t) => {
  await resetTables()

  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-purchase-order-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageSample(inputDir, BRIGHTOPS_PURCHASE_ORDER.filename)

  const extractor = new AnthropicFieldExtractor(new Anthropic())
  await runPipeline(inputDir, extractor, pool)

  const { rows: soRows } = await pool.query('SELECT * FROM so')
  assert.equal(soRows.length, 0)

  const { rows: poRows } = await pool.query('SELECT * FROM po')
  assert.equal(poRows.length, 1)
  const po = poRows[0]

  assert.equal(po.status, 'processed')
  assert.equal(po.source_filename, BRIGHTOPS_PURCHASE_ORDER.filename)
  assert.ok(po.processed_at)

  assert.equal(po.customer, BRIGHTOPS_PURCHASE_ORDER.customer)
  assert.equal(po.start_date, BRIGHTOPS_PURCHASE_ORDER.startDate)
  assert.equal(po.end_date, BRIGHTOPS_PURCHASE_ORDER.endDate)
  assert.equal(Number(po.amount), BRIGHTOPS_PURCHASE_ORDER.amount)
  assert.equal(po.payment_terms, BRIGHTOPS_PURCHASE_ORDER.paymentTerms)
  assert.equal(
    normalizeFreeText(po.billing_address),
    normalizeFreeText(BRIGHTOPS_PURCHASE_ORDER.billingAddress),
  )
  assert.equal(po.customer_signature, BRIGHTOPS_PURCHASE_ORDER.customerSignature)
  assert.match(po.burst, BRIGHTOPS_PURCHASE_ORDER.burstPattern)
  assert.match(po.technical_account_manager, BRIGHTOPS_PURCHASE_ORDER.tamPattern)

  const { rows: itemRows } = await pool.query(
    'SELECT * FROM po_items WHERE po_id = $1 ORDER BY id',
    [po.id],
  )
  assert.equal(itemRows.length, BRIGHTOPS_PURCHASE_ORDER.items.length)

  itemRows.forEach((row, i) => {
    const expectedItem = BRIGHTOPS_PURCHASE_ORDER.items[i]
    assert.equal(row.product_name, expectedItem.productName)
    assert.equal(Number(row.quantity), expectedItem.quantity)
    assert.equal(Number(row.price), expectedItem.price)
    assert.equal(Number(row.total_amount), expectedItem.totalAmount)
  })
})

test('mixed folder: one Order Form and one Purchase Order route to so and po respectively', async (t) => {
  await resetTables()

  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-mixed-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageSample(inputDir, ACME_ORDER_FORM.filename)
  stageSample(inputDir, BRIGHTOPS_PURCHASE_ORDER.filename)

  const extractor = new AnthropicFieldExtractor(new Anthropic())
  await runPipeline(inputDir, extractor, pool)

  const { rows: soRows } = await pool.query('SELECT * FROM so')
  assert.equal(soRows.length, 1)
  assert.equal(soRows[0].source_filename, ACME_ORDER_FORM.filename)

  const { rows: poRows } = await pool.query('SELECT * FROM po')
  assert.equal(poRows.length, 1)
  assert.equal(poRows[0].source_filename, BRIGHTOPS_PURCHASE_ORDER.filename)
})

test('classification is by content, not filename: a renamed Purchase Order still routes to po', async (t) => {
  await resetTables()

  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-renamed-po-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  stageSample(inputDir, BRIGHTOPS_PURCHASE_ORDER.filename, 'document1.pdf')

  const extractor = new AnthropicFieldExtractor(new Anthropic())
  await runPipeline(inputDir, extractor, pool)

  const { rows: soRows } = await pool.query('SELECT * FROM so')
  assert.equal(soRows.length, 0)

  const { rows: poRows } = await pool.query('SELECT * FROM po')
  assert.equal(poRows.length, 1)
  assert.equal(poRows[0].source_filename, 'document1.pdf')
})

after(async () => {
  await pool.end()
})
