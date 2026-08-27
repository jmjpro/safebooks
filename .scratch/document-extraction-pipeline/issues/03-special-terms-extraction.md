# 03: Special Terms extraction (Burst + TAM)

**What to build:** Extract Burst and Technical Account Manager Special Terms as document-level natural language fields, populated on `so` and `po` records for both document types.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [x] Running the CLI against a sample document whose Special Terms section mentions a Burst allowance produces an `so`/`po` row with a populated Burst field reflecting that allowance.
- [x] Running the CLI against a sample document whose Special Terms section names a Technical Account Manager produces an `so`/`po` row with that field populated.
- [x] Burst and TAM are stored as fields on the `so`/`po` row itself, not on `so_items`/`po_items`.
- [x] A document with no Special Terms section leaves Burst/TAM null rather than failing extraction.

## Comments

`burst`/`technicalAccountManager` columns, schema, extractor prompt, and persistence wiring already existed from issues 01/02 (both fields were added to `ExtractedFields` up front). All four real sample documents have a Special Terms section naming both Burst and a TAM, so the first three criteria were already covered by the existing `tests/eval/order-form-happy-path.test.ts` (ACME) and `purchase-order-happy-path.test.ts` (BrightOps) assertions — no sample document exercises the "no Special Terms section" path.

The fourth criterion exposed a real bug: `AnthropicFieldExtractor`'s `assign()` treated *every* null field — including a legitimately-absent Burst/TAM — as a `fieldErrors` entry ("not found in document"), which `runPipeline` treats as an extraction failure and routes the whole document to `needs_review`. That's correct for required Structured Fields (customer, dates, amount, ...) but wrong for Burst/TAM: their own extraction prompt already says "If the document has no such term, use null," i.e. null is an expected, valid outcome, not a failure.

Fix: added `assignOptional()` for `burst`/`technicalAccountManager` — null is left absent from `fields` with no `fieldErrors` entry, so a document with no Special Terms section still gets `processed` status with `burst`/`technical_account_manager` simply `NULL`. Covered by a new `tests/unit/anthropic-field-extractor.test.ts`, mocking the Anthropic client's `messages.parse()` response directly (per spec's pipeline-mechanics seam) since no real sample document lacks Special Terms to exercise this path end-to-end. Required-field-null behavior (still a `fieldErrors` entry) is unchanged and covered by the same test file for regression.

`/code-review` on the diff raised, and this fixed inline: `assignOptional`'s generic was widened over all `FieldName`s instead of just the two Special Terms fields (no compile-time guard against a future call site accidentally using it for a required field — narrowed its type param to `'burst' | 'technicalAccountManager'`); a blank string from the model would've bypassed the null check and been persisted as a non-null empty value (now trimmed and treated as absent, same as null); and the unparsable-response early-return branch still flags burst/TAM as failed, which looked inconsistent with the new "null isn't a failure" rule until a comment clarified why it's actually correct (a totally failed call has no signal either way, unlike a successful call reporting a confirmed null). Added regression tests for the blank-string case and the unparsable-response branch.
