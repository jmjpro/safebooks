import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import Anthropic from '@anthropic-ai/sdk'
import { Pool } from 'pg'
import { migrate } from '../../src/db/migrate.js'
import { AnthropicFieldExtractor } from '../../src/extraction/anthropic-field-extractor.js'
import type { ExtractedItem } from '../../src/extraction/field-extractor.js'
import { runPipeline } from '../../src/pipeline/run.js'
import { mmDdYyyyToIso } from '../../src/shared/date.js'
import { EXPECTED_DOCUMENTS, type ExpectedDocument } from './expected-documents.js'
import {
  checkExact,
  checkFreeText,
  checkItems,
  checkPattern,
  type FieldCheck,
} from './field-checks.js'

/**
 * Issue 06: the primary end-to-end eval. Runs the real pipeline (real Anthropic API, real
 * Postgres) against sample-input/ — which contains exactly the 4 real sample documents (2
 * Order Form customers, 2 Purchase Order customers) — with no FieldExtractor stubbing, and
 * compares every persisted field, item row, and Special Term against hand-verified expected
 * values. This single suite demonstrates all three KPIs: Coverage (both document types),
 * Adaptability (2 customer variants per type, all "processed"), and Accuracy (>=95%
 * field-level match rate across the sample set).
 */

const MINIMUM_FIELD_ACCURACY = 0.95

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set')
}

const pool = new Pool({ connectionString: databaseUrl })

interface DocumentRow {
  id: number
  customer: string | null
  start_date: string | null
  end_date: string | null
  amount: string | null
  payment_terms: string | null
  billing_address: string | null
  customer_signature: boolean | null
  burst: string | null
  technical_account_manager: string | null
}

interface ItemRow {
  product_name: string | null
  quantity: string | null
  price: string | null
  total_amount: string | null
}

function toExtractedItems(rows: ItemRow[]): ExtractedItem[] {
  return rows.map((row) => ({
    productName: row.product_name ?? '',
    quantity: Number(row.quantity),
    price: Number(row.price),
    totalAmount: Number(row.total_amount),
  }))
}

function checkPersistedDocument(
  expected: ExpectedDocument,
  doc: DocumentRow,
  items: ExtractedItem[],
): FieldCheck[] {
  return [
    checkExact('customer', expected.customer, doc.customer ?? undefined),
    checkExact('startDate', mmDdYyyyToIso(expected.startDate), doc.start_date ?? undefined),
    checkExact('endDate', mmDdYyyyToIso(expected.endDate), doc.end_date ?? undefined),
    checkExact('amount', expected.amount, doc.amount != null ? Number(doc.amount) : undefined),
    checkExact('paymentTerms', expected.paymentTerms, doc.payment_terms ?? undefined),
    checkFreeText('billingAddress', expected.billingAddress, doc.billing_address ?? undefined),
    checkExact(
      'customerSignature',
      expected.customerSignature,
      doc.customer_signature ?? undefined,
    ),
    checkPattern('burst', expected.burstPattern, doc.burst ?? undefined),
    checkPattern(
      'technicalAccountManager',
      expected.tamPattern,
      doc.technical_account_manager ?? undefined,
    ),
    ...checkItems(expected.items, items),
  ]
}

test('end-to-end accuracy: all 4 sample documents through the real pipeline', async (t) => {
  await migrate(pool)
  await pool.query(
    'TRUNCATE TABLE so_items, so, po_items, po, unclassified_documents RESTART IDENTITY CASCADE',
  )

  const extractor = new AnthropicFieldExtractor(new Anthropic())
  const { results, failures } = await runPipeline('sample-input', extractor, pool)

  assert.deepEqual(failures, [], 'no document should throw during extraction/persistence')
  assert.equal(results.length, EXPECTED_DOCUMENTS.length)

  // Coverage + Adaptability KPIs: both document types, 2 customer variants per type, all
  // landing as "processed" (not needs_review).
  for (const result of results) {
    assert.equal(
      result.status,
      'processed',
      `${result.filename} should be "processed", was "${result.status}"`,
    )
  }
  assert.equal(results.filter((r) => r.table === 'so').length, 2)
  assert.equal(results.filter((r) => r.table === 'po').length, 2)

  let totalMatched = 0
  let totalFields = 0

  for (const expected of EXPECTED_DOCUMENTS) {
    const table = expected.documentType === 'OrderForm' ? 'so' : 'po'
    const itemsTable = expected.documentType === 'OrderForm' ? 'so_items' : 'po_items'
    const idColumn = expected.documentType === 'OrderForm' ? 'so_id' : 'po_id'

    const { rows: docRows } = await pool.query<DocumentRow>(
      `SELECT * FROM ${table} WHERE source_filename = $1`,
      [expected.filename],
    )
    assert.equal(docRows.length, 1, `expected exactly one ${table} row for ${expected.filename}`)
    const doc = docRows[0]

    const { rows: itemRows } = await pool.query<ItemRow>(
      `SELECT * FROM ${itemsTable} WHERE ${idColumn} = $1 ORDER BY id`,
      [doc.id],
    )

    const checks = checkPersistedDocument(expected, doc, toExtractedItems(itemRows))
    const matched = checks.filter((c) => c.pass).length
    totalMatched += matched
    totalFields += checks.length

    t.diagnostic(`${expected.filename}: ${matched}/${checks.length} fields matched`)
    for (const c of checks) {
      if (!c.pass) {
        t.diagnostic(`  FAIL ${c.field}: expected=${c.expected} actual=${c.actual}`)
      }
    }
  }

  const accuracy = totalMatched / totalFields
  t.diagnostic(
    `Overall field-level accuracy: ${totalMatched}/${totalFields} (${(accuracy * 100).toFixed(1)}%)`,
  )
  assert.ok(
    accuracy >= MINIMUM_FIELD_ACCURACY,
    `field-level accuracy ${(accuracy * 100).toFixed(1)}% is below the ${MINIMUM_FIELD_ACCURACY * 100}% KPI threshold`,
  )
})

after(async () => {
  await pool.end()
})
