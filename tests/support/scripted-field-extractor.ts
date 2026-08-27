import type { FieldExtractionResult, FieldExtractor } from '../../src/extraction/field-extractor.js'

// Test double for the FieldExtractor port (spec: "a stub, canned-response implementation").
// Returns one scripted result per call, in order, then repeats the last one for any further
// calls — lets a test script "fails, fails, succeeds" across retry attempts.
export class ScriptedFieldExtractor implements FieldExtractor {
  calls = 0

  constructor(private readonly responses: FieldExtractionResult[]) {}

  async extract(): Promise<FieldExtractionResult> {
    const response = this.responses[Math.min(this.calls, this.responses.length - 1)]
    this.calls++
    return response
  }
}
