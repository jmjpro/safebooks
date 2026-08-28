import type {
  Document,
  ExtractedFields,
  FieldExtractionResult,
  FieldExtractor,
  FieldName,
} from '../extraction/field-extractor.js'

// A field that fails extraction/validation is retried up to this many additional times
// (3 attempts total) before it's treated as failed for that document. See ADR-less spec
// note in .scratch/document-extraction-pipeline/spec.md ("Retry policy") and issue 04.
export const MAX_EXTRACTION_ATTEMPTS = 3

function copyField<K extends FieldName>(
  fields: Partial<ExtractedFields>,
  retryFields: Partial<ExtractedFields>,
  name: K,
): void {
  fields[name] = retryFields[name] as ExtractedFields[K]
}

// Re-issues the whole extraction call (per spec: "the initial implementation may re-issue
// the whole extraction call and keep only the fields that newly succeed") and keeps, from
// each retry, only the fields that were previously failing — a field that already succeeded
// is never overwritten by a later attempt.
//
// documentType/items aren't tracked per-field, so the same "don't clobber a good result"
// rule is applied at the whole-result level: once an attempt has actually classified the
// document, its documentType/items are trusted and kept across further retries — an
// unrelated field still failing shouldn't let a later attempt's classification/item-list
// variance (LLM non-determinism) overwrite already-good data. Only when an attempt is a total
// 'ExtractionFailed' (the API call threw, or the response was unparsable — see
// AnthropicFieldExtractor.totallyFailedResult) is there nothing worth protecting, so the next
// attempt's documentType/items are taken instead.
//
// This must check documentType itself, not "previous.fields is empty": a genuine attempt can
// legitimately classify the document while every individual field fails to extract (e.g. a
// real but sparse/garbled document) — that classification is still real signal and must
// survive a later attempt's total failure, not be silently overwritten by 'ExtractionFailed'.
// See issue 08 (.scratch/document-extraction-pipeline/issues).
function mergeRetry(
  previous: FieldExtractionResult,
  retry: FieldExtractionResult,
): FieldExtractionResult {
  const fields = { ...previous.fields }
  const fieldErrors = { ...previous.fieldErrors }

  for (const name of Object.keys(previous.fieldErrors) as FieldName[]) {
    if (name in retry.fields) {
      copyField(fields, retry.fields, name)
      delete fieldErrors[name]
    } else {
      fieldErrors[name] = retry.fieldErrors[name] ?? fieldErrors[name]
    }
  }

  const previousWasTotalExtractionFailure = previous.documentType === 'ExtractionFailed'

  return {
    documentType: previousWasTotalExtractionFailure ? retry.documentType : previous.documentType,
    fields,
    items: previousWasTotalExtractionFailure ? retry.items : previous.items,
    fieldErrors,
  }
}

export async function extractWithRetries(
  extractor: FieldExtractor,
  document: Document,
  maxAttempts: number = MAX_EXTRACTION_ATTEMPTS,
  onAttempt?: (attempt: number, maxAttempts: number) => void,
): Promise<FieldExtractionResult> {
  onAttempt?.(1, maxAttempts)
  let result = await extractor.extract(document)

  for (
    let attempt = 2;
    attempt <= maxAttempts && Object.keys(result.fieldErrors).length > 0;
    attempt++
  ) {
    onAttempt?.(attempt, maxAttempts)
    const retry = await extractor.extract(document)
    result = mergeRetry(result, retry)
  }

  return result
}
