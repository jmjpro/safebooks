# 08: Distinguish total extraction failure from a genuinely unclassified document

**What to build:** A document where every retry attempt fails outright (API error / unparsable response) is currently indistinguishable, once persisted, from a document the extractor genuinely determined is neither an Order Form nor a Purchase Order — both end up as an `unclassified_documents` row with `documentType: 'Unclassified'` and every field null.

**Status:** ready-for-human

## Background

Filed from the issue-05 code review. `AnthropicFieldExtractor`'s `totallyFailedResult()` (`src/extraction/anthropic-field-extractor.ts`) returns `documentType: 'Unclassified'` whenever the API call throws or the response is unparsable — this predates issue 05. Before issue 05, `runPipeline`'s handling of a non-OrderForm/PurchaseOrder `documentType` was to `throw`, which routed the document into the `failures` array (visible in CLI output, not persisted). Issue 05 replaced that `throw` with persisting the document into the new `unclassified_documents` table with `needs_review` status — correct per spec (a document should never be silently dropped), but it removed the only signal that separated "the extractor looked at this and decided it's neither type" from "the extractor never got a usable read on this document at all."

- [x] Decide how a total-extraction-failure document should be distinguished from a genuinely-unclassified one in the persisted record (e.g. a distinct reason/status value, or retaining the failure `fieldErrors` message on the row) — a Sales Order that merely failed to extract 3 times in a row shouldn't look identical to a document that was correctly identified as out-of-scope.
- [x] Once decided, a total-extraction-failure document surfaces that distinction somewhere an operator reviewing `needs_review`/`unclassified_documents` records would see it.

## Comments

Chose the "distinct reason value" option: `DocumentType` (`src/extraction/field-extractor.ts`) gains a fourth, pipeline-internal value, `'ExtractionFailed'`, alongside `OrderForm`/`PurchaseOrder`/`Unclassified` — never something the LLM itself returns (its response schema still only allows the original three). `AnthropicFieldExtractor.totallyFailedResult()` now returns `documentType: 'ExtractionFailed'` instead of reusing `'Unclassified'`.

`unclassified_documents` gains a `document_type` column (`'Unclassified'` | `'ExtractionFailed'`), populated by `saveUnclassified` and visible to anyone querying the table — the persisted-record signal the second checkbox asked for. The CLI (`src/index.ts`) also prints it per unclassified result line, e.g. `mystery.pdf -> unclassified_documents#3 (needs_review: ExtractionFailed)`.

While fixing this, code review caught a real bug in unrelated-but-adjacent code: `retry-extraction.ts`'s `mergeRetry()` decided whether to keep a previous attempt's `documentType`/`items` using "did the previous attempt extract zero fields," which — now that `'ExtractionFailed'` is a distinct value — let a later total-failure retry silently overwrite an earlier attempt's *real* classification whenever that earlier attempt happened to extract zero individual fields (e.g. a real but sparse/garbled document). Fixed by keying the decision on `previous.documentType === 'ExtractionFailed'` directly instead of on field count; covered by a new regression test (`tests/unit/retry-extraction.test.ts`).

Tests: `tests/pipeline/unclassifiable-document.test.ts` covers the new `document_type` column for both cases end-to-end against a real test database; `tests/unit/anthropic-field-extractor.test.ts` and `tests/unit/retry-extraction.test.ts` cover the extractor/merge-level behavior. Full suite (unit + pipeline + eval, including the real end-to-end accuracy eval against all 4 sample documents) passes at 100% field-level accuracy, unaffected by this change.
