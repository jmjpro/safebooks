import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import {
  AnthropicFieldExtractor,
  DEFAULT_MODEL,
} from '../../src/extraction/anthropic-field-extractor.js'
import type { FieldExtractionResult } from '../../src/extraction/field-extractor.js'
import { EXPECTED_DOCUMENTS, type ExpectedDocument } from './expected-documents.js'
import {
  checkExact,
  checkFreeText,
  checkItems,
  checkPattern,
  type FieldCheck,
} from './field-checks.js'

/**
 * Extraction-only model comparison for issue 01.5: runs FieldExtractor.extract()
 * (no pipeline persistence — this suite only exercises extraction, not SO/PO routing)
 * against all 4 sample documents and reports latency + field-level accuracy against
 * hand-verified expected values, for whichever model ANTHROPIC_MODEL selects.
 *
 * Usage: run once per model via `npm run compare-models` with ANTHROPIC_MODEL set
 * in the environment (or `.env`) — no code changes needed to switch models.
 */

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

  for (const expected of EXPECTED_DOCUMENTS) {
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
