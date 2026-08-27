# 08: Distinguish total extraction failure from a genuinely unclassified document

**What to build:** A document where every retry attempt fails outright (API error / unparsable response) is currently indistinguishable, once persisted, from a document the extractor genuinely determined is neither an Order Form nor a Purchase Order — both end up as an `unclassified_documents` row with `documentType: 'Unclassified'` and every field null.

**Status:** ready-for-triage

## Background

Filed from the issue-05 code review. `AnthropicFieldExtractor`'s `totallyFailedResult()` (`src/extraction/anthropic-field-extractor.ts`) returns `documentType: 'Unclassified'` whenever the API call throws or the response is unparsable — this predates issue 05. Before issue 05, `runPipeline`'s handling of a non-OrderForm/PurchaseOrder `documentType` was to `throw`, which routed the document into the `failures` array (visible in CLI output, not persisted). Issue 05 replaced that `throw` with persisting the document into the new `unclassified_documents` table with `needs_review` status — correct per spec (a document should never be silently dropped), but it removed the only signal that separated "the extractor looked at this and decided it's neither type" from "the extractor never got a usable read on this document at all."

- [ ] Decide how a total-extraction-failure document should be distinguished from a genuinely-unclassified one in the persisted record (e.g. a distinct reason/status value, or retaining the failure `fieldErrors` message on the row) — a Sales Order that merely failed to extract 3 times in a row shouldn't look identical to a document that was correctly identified as out-of-scope.
- [ ] Once decided, a total-extraction-failure document surfaces that distinction somewhere an operator reviewing `needs_review`/`unclassified_documents` records would see it.
