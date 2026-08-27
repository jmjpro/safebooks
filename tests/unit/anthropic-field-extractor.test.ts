import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { AnthropicFieldExtractor } from '../../src/extraction/anthropic-field-extractor.js'
import type { Document } from '../../src/extraction/field-extractor.js'

const BASE_PARSED_FIELDS = {
  documentType: 'OrderForm' as const,
  customer: 'Appsoft Inc.',
  startDate: '01-01-2025',
  endDate: '12-31-2026',
  amount: 100000,
  paymentTerms: 'Net 30',
  billingAddress: '123 Main Street, New York, NY, USA',
  customerSignature: true,
  items: [],
}

function fakeClient(parsedOutput: unknown): Anthropic {
  return {
    messages: {
      parse: async () => ({ parsed_output: parsedOutput }),
    },
  } as unknown as Anthropic
}

const document: Document = { filename: 'doc.pdf', content: Buffer.from('') }

test('extract() populates burst and technicalAccountManager when the Special Terms section names them', async () => {
  const extractor = new AnthropicFieldExtractor(
    fakeClient({
      ...BASE_PARSED_FIELDS,
      burst: 'Customer may exceed usage by 5% at no additional cost.',
      technicalAccountManager: 'A dedicated Technical Account Manager will be assigned.',
    }),
  )

  const result = await extractor.extract(document)

  assert.equal(result.fields.burst, 'Customer may exceed usage by 5% at no additional cost.')
  assert.equal(
    result.fields.technicalAccountManager,
    'A dedicated Technical Account Manager will be assigned.',
  )
  assert.deepEqual(result.fieldErrors, {})
})

test('extract() leaves burst and technicalAccountManager null, without a fieldError, when the document has no Special Terms section', async () => {
  const extractor = new AnthropicFieldExtractor(
    fakeClient({
      ...BASE_PARSED_FIELDS,
      burst: null,
      technicalAccountManager: null,
    }),
  )

  const result = await extractor.extract(document)

  assert.equal('burst' in result.fields, false)
  assert.equal('technicalAccountManager' in result.fields, false)
  assert.deepEqual(result.fieldErrors, {})
})

test('extract() still flags a required field (e.g. customer) missing as a fieldError', async () => {
  const extractor = new AnthropicFieldExtractor(
    fakeClient({
      ...BASE_PARSED_FIELDS,
      customer: null,
      burst: null,
      technicalAccountManager: null,
    }),
  )

  const result = await extractor.extract(document)

  assert.equal(result.fieldErrors.customer, 'not found in document')
  assert.equal('burst' in result.fieldErrors, false)
  assert.equal('technicalAccountManager' in result.fieldErrors, false)
})

test('extract() treats a blank string burst/technicalAccountManager the same as null', async () => {
  const extractor = new AnthropicFieldExtractor(
    fakeClient({
      ...BASE_PARSED_FIELDS,
      burst: '   ',
      technicalAccountManager: '',
    }),
  )

  const result = await extractor.extract(document)

  assert.equal('burst' in result.fields, false)
  assert.equal('technicalAccountManager' in result.fields, false)
  assert.deepEqual(result.fieldErrors, {})
})

test('extract() flags every field, including burst and technicalAccountManager, when the response is unparsable', async () => {
  const extractor = new AnthropicFieldExtractor(fakeClient(undefined))

  const result = await extractor.extract(document)

  assert.deepEqual(result.fields, {})
  assert.equal(result.documentType, 'Unclassified')
  assert.equal(result.fieldErrors.burst, 'extraction did not return parsable output')
  assert.equal(
    result.fieldErrors.technicalAccountManager,
    'extraction did not return parsable output',
  )
})

test('extract() resolves with every field flagged, rather than throwing, when the API call itself throws', async () => {
  const client = {
    messages: {
      parse: async () => {
        throw new Error('rate limited')
      },
    },
  } as unknown as Anthropic

  const result = await new AnthropicFieldExtractor(client).extract(document)

  assert.deepEqual(result.fields, {})
  assert.equal(result.documentType, 'Unclassified')
  assert.equal(result.fieldErrors.customer, 'rate limited')
  assert.equal(result.fieldErrors.burst, 'rate limited')
})
