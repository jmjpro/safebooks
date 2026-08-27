import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import {
  AnthropicFieldExtractor,
  DEFAULT_MODEL,
} from '../../src/extraction/anthropic-field-extractor.js'
import type {
  DocumentType,
  ExtractedItem,
  FieldExtractionResult,
} from '../../src/extraction/field-extractor.js'
import { ACME_ORDER_FORM } from './fixtures/acme-order-form.js'
import { BRIGHTOPS_PURCHASE_ORDER } from './fixtures/brightops-purchase-order.js'
import { NOVAFLEET_PURCHASE_ORDER } from './fixtures/novafleet-purchase-order.js'
import { normalizeFreeText } from './normalize-free-text.js'

/**
 * Extraction-only model comparison for issue 01.5: runs FieldExtractor.extract()
 * (no pipeline persistence — this suite only exercises extraction, not SO/PO routing)
 * against all 4 sample documents and reports latency + field-level accuracy against
 * hand-verified expected values, for whichever model ANTHROPIC_MODEL selects.
 *
 * Usage: run once per model via `npm run compare-models` with ANTHROPIC_MODEL set
 * in the environment (or `.env`) — no code changes needed to switch models.
 */

interface ExpectedDocument {
  filename: string
  documentType: DocumentType
  customer: string
  startDate: string
  endDate: string
  amount: number
  paymentTerms: string
  billingAddress: string
  customerSignature: boolean
  burstPattern: RegExp
  tamPattern: RegExp | null
  items: ExtractedItem[]
}

const EXPECTED: ExpectedDocument[] = [
  { documentType: 'OrderForm', ...ACME_ORDER_FORM },
  {
    // Special Terms list no dedicated point-of-contact term — tamPattern is null,
    // testing that the model correctly returns null rather than hallucinating one from
    // the "Premium Support" line item (which is a paid product, not a TAM assignment).
    filename: 'CloudShield Order Form.pdf',
    documentType: 'OrderForm',
    customer: 'TechNova Solutions, Inc.',
    startDate: '03-01-2025',
    endDate: '02-28-2028',
    amount: 23640000,
    paymentTerms: 'Net 45',
    billingAddress: '2500 Tech Park Boulevard, Austin, Texas 78701',
    customerSignature: false,
    burstPattern: /38\.89%/,
    tamPattern: null,
    // price uses the document's literal "Monthly / Unit Price" column (rounded to 2dp
    // per the document's own disclaimer), not a derived annual rate — this matches what
    // every model actually reads off the table's labeled column.
    items: [
      {
        productName: 'CloudShield Enterprise',
        quantity: 180000,
        price: 3.25,
        totalAmount: 7020000,
      },
      { productName: 'Premium Support', quantity: 1, price: 22916.67, totalAmount: 275000 },
      {
        productName: 'CloudShield Enterprise',
        quantity: 195000,
        price: 3.25,
        totalAmount: 7605000,
      },
      { productName: 'Premium Support', quantity: 1, price: 22916.67, totalAmount: 275000 },
      {
        productName: 'CloudShield Enterprise',
        quantity: 210000,
        price: 3.25,
        totalAmount: 8190000,
      },
      { productName: 'Premium Support', quantity: 1, price: 22916.67, totalAmount: 275000 },
    ],
  },
  { documentType: 'PurchaseOrder', ...BRIGHTOPS_PURCHASE_ORDER },
  { documentType: 'PurchaseOrder', ...NOVAFLEET_PURCHASE_ORDER },
]

interface FieldCheck {
  field: string
  pass: boolean
  expected: string
  actual: string
}

function display(value: unknown): string {
  return value === undefined ? 'null' : JSON.stringify(value)
}

function checkExact(field: string, expected: unknown, actual: unknown): FieldCheck {
  return { field, pass: actual === expected, expected: display(expected), actual: display(actual) }
}

function checkFreeText(field: string, expected: string, actual: string | undefined): FieldCheck {
  const check = checkExact(field, normalizeFreeText(expected), normalizeFreeText(actual))
  return { ...check, expected: display(expected), actual: display(actual) }
}

function checkPattern(
  field: string,
  pattern: RegExp | null,
  actual: string | undefined,
): FieldCheck {
  const pass =
    pattern === null ? actual === undefined : actual !== undefined && pattern.test(actual)
  return {
    field,
    pass,
    expected: pattern === null ? 'null' : pattern.source,
    actual: display(actual),
  }
}

function checkItems(expected: ExtractedItem[], actual: ExtractedItem[]): FieldCheck[] {
  const checks: FieldCheck[] = [
    {
      field: 'items.length',
      pass: actual.length === expected.length,
      expected: String(expected.length),
      actual: String(actual.length),
    },
  ]
  const rows = Math.max(expected.length, actual.length)
  for (let i = 0; i < rows; i++) {
    const exp = expected[i]
    const act = actual[i]
    for (const key of ['productName', 'quantity', 'price', 'totalAmount'] as const) {
      checks.push(checkExact(`items[${i}].${key}`, exp?.[key], act?.[key]))
    }
  }
  return checks
}

function checkDocument(expected: ExpectedDocument, result: FieldExtractionResult): FieldCheck[] {
  const f = result.fields
  return [
    checkExact('documentType', expected.documentType, result.documentType),
    checkExact('customer', expected.customer, f.customer),
    checkExact('startDate', expected.startDate, f.startDate),
    checkExact('endDate', expected.endDate, f.endDate),
    checkExact('amount', expected.amount, f.amount),
    checkExact('paymentTerms', expected.paymentTerms, f.paymentTerms),
    checkFreeText('billingAddress', expected.billingAddress, f.billingAddress),
    checkExact('customerSignature', expected.customerSignature, f.customerSignature),
    checkPattern('burst', expected.burstPattern, f.burst),
    checkPattern('technicalAccountManager', expected.tamPattern, f.technicalAccountManager),
    ...checkItems(expected.items, result.items),
  ]
}

async function main(): Promise<void> {
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL
  const extractor = new AnthropicFieldExtractor(new Anthropic())

  const perDocument: { filename: string; latencyMs: number; matched: number; total: number }[] = []

  for (const expected of EXPECTED) {
    const content = readFileSync(join(process.cwd(), 'sample-input', expected.filename))
    const start = performance.now()
    const result = await extractor.extract({ filename: expected.filename, content })
    const latencyMs = performance.now() - start

    const checks = checkDocument(expected, result)
    const matched = checks.filter((c) => c.pass).length

    console.log(
      `\n=== ${expected.filename} — model=${model} — ${latencyMs.toFixed(0)}ms — ${matched}/${checks.length} fields ===`,
    )
    for (const c of checks) {
      if (!c.pass) {
        console.log(`FAIL ${c.field}: expected=${c.expected} actual=${c.actual}`)
      }
    }

    perDocument.push({ filename: expected.filename, latencyMs, matched, total: checks.length })
  }

  const totalLatency = perDocument.reduce((sum, r) => sum + r.latencyMs, 0)
  const totalMatched = perDocument.reduce((sum, r) => sum + r.matched, 0)
  const totalFields = perDocument.reduce((sum, r) => sum + r.total, 0)

  console.log(`\n=== Summary: model=${model} ===`)
  for (const r of perDocument) {
    console.log(`${r.filename}: ${r.latencyMs.toFixed(0)}ms, ${r.matched}/${r.total} fields`)
  }
  console.log(`Total latency: ${totalLatency.toFixed(0)}ms across ${perDocument.length} documents`)
  console.log(
    `Field accuracy: ${totalMatched}/${totalFields} (${((totalMatched / totalFields) * 100).toFixed(1)}%)`,
  )
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
