# 06: End-to-end accuracy eval across all 4 sample documents

**What to build:** The end-to-end accuracy eval: run the real pipeline (real Anthropic API, real Postgres) against all 4 real sample documents and assert extracted values against hand-verified expected data, demonstrating the Coverage, Adaptability, and Accuracy KPIs.

**Blocked by:** 02, 03

**Status:** ready-for-human

- [x] The eval suite runs the CLI against `sample-input/` containing all 4 sample documents (ACME and CloudShield Order Forms; BrightOps and NovaFleet Purchase Orders) using the real Anthropic API and a real test Postgres database, with no `FieldExtractor` stubbing.
- [x] For each of the 4 sample documents, every extracted structured field, item row, and applicable Special Term is compared against a hand-verified expected value, and the suite reports the field-level match rate.
- [x] The reported field-level accuracy across the 4 sample documents is ≥95%.
- [x] The suite demonstrates both document types (Order Form and Purchase Order) and at least 2 customer variants per document type all producing "processed" (not `needs_review`) records.

## Comments

Implemented as `tests/eval/end-to-end-accuracy.test.ts`: runs `runPipeline` (the same
pipeline `src/index.ts` calls) against the real `sample-input/` directory with a real
`AnthropicFieldExtractor` and the real test Postgres database, then compares every
persisted `so`/`po` field, `so_items`/`po_items` row, and Special Term against
hand-verified expected values, tallying a field-level match rate and asserting it's
≥95%, plus asserting all 4 documents land `status = "processed"` split 2 Order Form /
2 Purchase Order.

The hand-verified expected values and the field-comparison primitives were pulled out
of `tests/eval/model-comparison.ts` (previously private to that extraction-only suite)
into shared `tests/eval/expected-documents.ts` and `tests/eval/field-checks.ts`, so this
suite and `model-comparison.ts` share one source of truth for "correct" instead of two
that could drift. Added `tests/eval/fixtures/cloudshield-order-form.ts`, previously only
inline in `model-comparison.ts`, to match the fixture pattern already used for the other
3 sample documents.

Latest real run: 116/116 fields matched (100%) across all 4 documents, all `processed`.
