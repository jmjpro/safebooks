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
import { mmDdYyyyToIso } from '../../src/shared/date.js'
import { ACME_ORDER_FORM } from './fixtures/acme-order-form.js'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set')
}

const pool = new Pool({ connectionString: databaseUrl })

test('Order Form happy path: ACME sample document -> so + so_items', async (t) => {
  await migrate(pool)
  await pool.query('TRUNCATE TABLE so_items, so RESTART IDENTITY CASCADE')

  const inputDir = mkdtempSync(join(tmpdir(), 'safebooks-order-form-'))
  t.after(() => rmSync(inputDir, { recursive: true, force: true }))
  copyFileSync(
    join(process.cwd(), 'sample-input', ACME_ORDER_FORM.filename),
    join(inputDir, ACME_ORDER_FORM.filename),
  )

  const extractor = new AnthropicFieldExtractor(new Anthropic())
  await runPipeline(inputDir, extractor, pool)

  const { rows: soRows } = await pool.query('SELECT * FROM so')
  assert.equal(soRows.length, 1)
  const so = soRows[0]

  assert.equal(so.status, 'processed')
  assert.equal(so.source_filename, ACME_ORDER_FORM.filename)
  assert.ok(so.processed_at)

  assert.equal(so.customer, ACME_ORDER_FORM.customer)
  assert.equal(so.start_date, mmDdYyyyToIso(ACME_ORDER_FORM.startDate))
  assert.equal(so.end_date, mmDdYyyyToIso(ACME_ORDER_FORM.endDate))
  assert.equal(Number(so.amount), ACME_ORDER_FORM.amount)
  assert.equal(so.payment_terms, ACME_ORDER_FORM.paymentTerms)
  assert.equal(so.billing_address, ACME_ORDER_FORM.billingAddress)
  assert.equal(so.customer_signature, ACME_ORDER_FORM.customerSignature)
  assert.match(so.burst, ACME_ORDER_FORM.burstPattern)
  assert.match(so.technical_account_manager, ACME_ORDER_FORM.tamPattern)

  const { rows: itemRows } = await pool.query(
    'SELECT * FROM so_items WHERE so_id = $1 ORDER BY id',
    [so.id],
  )
  assert.equal(itemRows.length, ACME_ORDER_FORM.items.length)

  itemRows.forEach((row, i) => {
    const expectedItem = ACME_ORDER_FORM.items[i]
    assert.equal(row.product_name, expectedItem.productName)
    assert.equal(Number(row.quantity), expectedItem.quantity)
    assert.equal(Number(row.price), expectedItem.price)
    assert.equal(Number(row.total_amount), expectedItem.totalAmount)
  })
})

after(async () => {
  await pool.end()
})
