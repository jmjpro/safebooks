import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Document, FieldExtractionResult } from '../../src/extraction/field-extractor.js'
import { extractWithRetries, MAX_EXTRACTION_ATTEMPTS } from '../../src/pipeline/retry-extraction.js'
import { ScriptedFieldExtractor } from '../support/scripted-field-extractor.js'

const document: Document = { filename: 'doc.pdf', content: Buffer.from('') }

function result(
  overrides: Partial<FieldExtractionResult> & Pick<FieldExtractionResult, 'fields' | 'fieldErrors'>,
): FieldExtractionResult {
  return {
    documentType: 'OrderForm',
    items: [],
    ...overrides,
  }
}

test('a field that succeeds on the first attempt is not retried', async () => {
  const extractor = new ScriptedFieldExtractor([
    result({ fields: { customer: 'Appsoft Inc.' }, fieldErrors: {} }),
    result({ fields: { customer: 'someone else' }, fieldErrors: {} }),
  ])

  const extraction = await extractWithRetries(extractor, document)

  assert.equal(extractor.calls, 1)
  assert.equal(extraction.fields.customer, 'Appsoft Inc.')
  assert.deepEqual(extraction.fieldErrors, {})
})

test('a field that fails once and succeeds on retry is populated correctly, and other fields are untouched', async () => {
  const extractor = new ScriptedFieldExtractor([
    result({
      fields: { customer: 'Appsoft Inc.' },
      fieldErrors: { amount: 'not found in document' },
    }),
    result({ fields: { amount: 42, customer: 'a different value' }, fieldErrors: {} }),
  ])

  const extraction = await extractWithRetries(extractor, document)

  assert.equal(extractor.calls, 2)
  assert.equal(extraction.fields.amount, 42)
  assert.equal(extraction.fields.customer, 'Appsoft Inc.')
  assert.deepEqual(extraction.fieldErrors, {})
})

test('a field that fails on every attempt is retried up to 2 additional times (3 total) then left failed', async () => {
  const extractor = new ScriptedFieldExtractor([
    result({ fields: {}, fieldErrors: { amount: 'attempt 1' } }),
    result({ fields: {}, fieldErrors: { amount: 'attempt 2' } }),
    result({ fields: {}, fieldErrors: { amount: 'attempt 3' } }),
    result({ fields: { amount: 42 }, fieldErrors: {} }),
  ])

  const extraction = await extractWithRetries(extractor, document)

  assert.equal(extractor.calls, MAX_EXTRACTION_ATTEMPTS)
  assert.equal(extractor.calls, 3)
  assert.equal('amount' in extraction.fields, false)
  assert.equal(extraction.fieldErrors.amount, 'attempt 3')
})

test('other successfully-extracted fields remain populated when one field is exhausted', async () => {
  const extractor = new ScriptedFieldExtractor([
    result({
      fields: { customer: 'Appsoft Inc.', paymentTerms: 'Net 30' },
      fieldErrors: { amount: 'not found in document' },
    }),
    result({ fields: {}, fieldErrors: { amount: 'still missing' } }),
    result({ fields: {}, fieldErrors: { amount: 'still missing' } }),
  ])

  const extraction = await extractWithRetries(extractor, document)

  assert.equal(extractor.calls, 3)
  assert.equal(extraction.fields.customer, 'Appsoft Inc.')
  assert.equal(extraction.fields.paymentTerms, 'Net 30')
  assert.equal('amount' in extraction.fields, false)
  assert.deepEqual(Object.keys(extraction.fieldErrors), ['amount'])
})

test('a document with no field errors at all is unaffected: single call, all fields kept', async () => {
  const extractor = new ScriptedFieldExtractor([
    result({
      fields: { customer: 'Appsoft Inc.', amount: 100, paymentTerms: 'Net 30' },
      fieldErrors: {},
    }),
  ])

  const extraction = await extractWithRetries(extractor, document)

  assert.equal(extractor.calls, 1)
  assert.deepEqual(extraction.fields, {
    customer: 'Appsoft Inc.',
    amount: 100,
    paymentTerms: 'Net 30',
  })
})

test('documentType and items from a successful first attempt are kept even when a retry (for an unrelated field) reports something different', async () => {
  const items = [{ productName: 'Widget', quantity: 1, price: 10, totalAmount: 10 }]
  const extractor = new ScriptedFieldExtractor([
    result({
      documentType: 'OrderForm',
      items,
      fields: { customer: 'Appsoft Inc.' },
      fieldErrors: { amount: 'not found in document' },
    }),
    result({
      documentType: 'Unclassified',
      items: [],
      fields: { amount: 42 },
      fieldErrors: {},
    }),
  ])

  const extraction = await extractWithRetries(extractor, document)

  assert.equal(extraction.documentType, 'OrderForm')
  assert.deepEqual(extraction.items, items)
  assert.equal(extraction.fields.amount, 42)
})

test('documentType and items are taken from a later attempt when the first attempt was a total extraction failure', async () => {
  const items = [{ productName: 'Widget', quantity: 1, price: 10, totalAmount: 10 }]
  const totallyFailed = result({
    documentType: 'ExtractionFailed',
    items: [],
    fields: {},
    fieldErrors: { customer: 'unparsable', amount: 'unparsable' },
  })
  const extractor = new ScriptedFieldExtractor([
    totallyFailed,
    result({
      documentType: 'OrderForm',
      items,
      fields: { customer: 'Appsoft Inc.', amount: 42 },
      fieldErrors: {},
    }),
  ])

  const extraction = await extractWithRetries(extractor, document)

  assert.equal(extraction.documentType, 'OrderForm')
  assert.deepEqual(extraction.items, items)
})

test('a genuine classification with zero successfully-extracted fields is not overwritten by a later total extraction failure', async () => {
  const extractor = new ScriptedFieldExtractor([
    result({
      documentType: 'OrderForm',
      items: [],
      fields: {},
      fieldErrors: { customer: 'not found in document', amount: 'not found in document' },
    }),
    result({
      documentType: 'ExtractionFailed',
      items: [],
      fields: {},
      fieldErrors: { customer: 'rate limited', amount: 'rate limited' },
    }),
  ])

  const extraction = await extractWithRetries(extractor, document)

  assert.equal(extraction.documentType, 'OrderForm')
})
