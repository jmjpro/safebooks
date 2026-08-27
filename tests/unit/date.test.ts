import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isValidMmDdYyyyDate, mmDdYyyyToIso } from '../../src/shared/date.js'

test('isValidMmDdYyyyDate accepts real calendar dates in mm-dd-yyyy shape', () => {
  assert.equal(isValidMmDdYyyyDate('01-01-2025'), true)
  assert.equal(isValidMmDdYyyyDate('12-31-2026'), true)
  assert.equal(isValidMmDdYyyyDate('02-29-2024'), true) // leap year
})

test('isValidMmDdYyyyDate rejects strings that do not match the mm-dd-yyyy shape', () => {
  assert.equal(isValidMmDdYyyyDate('2025-01-01'), false)
  assert.equal(isValidMmDdYyyyDate('1-1-2025'), false)
  assert.equal(isValidMmDdYyyyDate('01/01/2025'), false)
  assert.equal(isValidMmDdYyyyDate(''), false)
})

test('isValidMmDdYyyyDate rejects shape-valid strings that are not real calendar dates', () => {
  assert.equal(isValidMmDdYyyyDate('13-01-2025'), false) // month 13
  assert.equal(isValidMmDdYyyyDate('02-30-2025'), false) // no Feb 30
  assert.equal(isValidMmDdYyyyDate('02-29-2025'), false) // 2025 is not a leap year
  assert.equal(isValidMmDdYyyyDate('04-31-2025'), false) // April has 30 days
  assert.equal(isValidMmDdYyyyDate('00-15-2025'), false) // month 0
  assert.equal(isValidMmDdYyyyDate('01-00-2025'), false) // day 0
})

test('mmDdYyyyToIso converts an already-validated mm-dd-yyyy string to ISO yyyy-mm-dd', () => {
  assert.equal(mmDdYyyyToIso('03-01-2025'), '2025-03-01')
  assert.equal(mmDdYyyyToIso('12-31-2026'), '2026-12-31')
})
