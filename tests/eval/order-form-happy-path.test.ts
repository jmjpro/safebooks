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
    join(process.cwd(), 'sample-input', 'ACME Order From.pdf'),
    join(inputDir, 'ACME Order From.pdf'),
  )

  const extractor = new AnthropicFieldExtractor(new Anthropic())
  await runPipeline(inputDir, extractor, pool)

  const { rows: soRows } = await pool.query('SELECT * FROM so')
  assert.equal(soRows.length, 1)
  const so = soRows[0]

  assert.equal(so.status, 'processed')
  assert.equal(so.source_filename, 'ACME Order From.pdf')
  assert.ok(so.processed_at)

  assert.equal(so.customer, 'Appsoft Inc.')
  assert.equal(so.start_date, '01-01-2025')
  assert.equal(so.end_date, '12-31-2026')
  assert.equal(Number(so.amount), 152500)
  assert.equal(so.payment_terms, 'Net 30')
  assert.equal(so.billing_address, '123 Main Street, New York, NY, USA')
  assert.equal(so.customer_signature, true)
  assert.match(so.burst, /5%/)
  assert.match(so.technical_account_manager, /Support Manager|Architect/)

  const { rows: itemRows } = await pool.query(
    'SELECT * FROM so_items WHERE so_id = $1 ORDER BY id',
    [so.id],
  )
  assert.equal(itemRows.length, 5)

  const expectedItems = [
    { product_name: 'SaaS Subscription', quantity: 1, price: 50000, total_amount: 50000 },
    { product_name: 'SaaS Subscription', quantity: 1, price: 60000, total_amount: 60000 },
    { product_name: 'Premium Support', quantity: 100, price: 250, total_amount: 25000 },
    { product_name: 'Premium Support', quantity: 50, price: 250, total_amount: 12500 },
    { product_name: 'Training Package', quantity: 50, price: 100, total_amount: 5000 },
  ]

  itemRows.forEach((row, i) => {
    assert.equal(row.product_name, expectedItems[i].product_name)
    assert.equal(Number(row.quantity), expectedItems[i].quantity)
    assert.equal(Number(row.price), expectedItems[i].price)
    assert.equal(Number(row.total_amount), expectedItems[i].total_amount)
  })
})

after(async () => {
  await pool.end()
})
